// The actor succeeds but returns nothing. Which part of OUR input is wrong?
// Run variants asynchronously, since the actor needs ~60s and a sync call
// below that always looks like a timeout.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const TOKEN = env.APIFY_TOKEN;
const ACTOR = 'maximedupre~linkedin-events';

const variants = [
  ['cities + upcoming + any',  { target: 'discover', searchQuery: 'fintech', cities: ['Mumbai'], eventTiming: 'upcoming', eventFormat: 'any' }],
  ['NO cities filter',         { target: 'discover', searchQuery: 'fintech Mumbai', eventTiming: 'upcoming', eventFormat: 'any' }],
  ['no cities, any timing',    { target: 'discover', searchQuery: 'fintech India', eventTiming: 'any', eventFormat: 'any' }],
  ['bare query only',          { target: 'discover', searchQuery: 'fintech' }],
  ['locations not cities',     { target: 'discover', searchQuery: 'fintech', locations: ['India'], eventTiming: 'any' }],
  ['single generic word',      { target: 'discover', searchQuery: 'marketing' }],
];

async function run(label, input) {
  const t0 = Date.now();
  const s = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(TOKEN)}&timeout=240&memory=1024`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
  );
  const j = await s.json();
  if (!s.ok) return { label, error: JSON.stringify(j.error ?? j).slice(0, 140) };

  const { id, defaultDatasetId } = j.data;
  let status = 'RUNNING';
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const rr = await (await fetch(`https://api.apify.com/v2/actor-runs/${id}?token=${encodeURIComponent(TOKEN)}`)).json();
    status = rr.data.status;
    if (!['RUNNING', 'READY'].includes(status)) break;
  }
  const items = await (await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${encodeURIComponent(TOKEN)}&limit=30`
  )).json();
  const log = await (await fetch(`https://api.apify.com/v2/actor-runs/${id}/log?token=${encodeURIComponent(TOKEN)}`)).text();
  const verdict = (log.match(/🔎[^\n]*|No public LinkedIn events[^\n]*/g) ?? []).slice(-1)[0] ?? '';
  return {
    label, status, secs: ((Date.now() - t0) / 1000).toFixed(0),
    count: Array.isArray(items) ? items.length : 0,
    sample: (Array.isArray(items) ? items : []).slice(0, 3).map((x) => x.title ?? '(untitled)'),
    verdict: verdict.trim().slice(0, 90),
  };
}

const results = [];
for (const [label, input] of variants) {
  const r = await run(label, input);
  results.push(r);
  console.log(
    `${label.padEnd(26)} ${String(r.status ?? 'ERR').padEnd(10)} ${String(r.secs ?? '-').padStart(3)}s  items:${String(r.count ?? 0).padStart(3)}  ${r.verdict ?? r.error ?? ''}`
  );
  for (const t of r.sample ?? []) console.log(`     - ${String(t).slice(0, 78)}`);
}
writeFileSync(join(ROOT, 'spike', 'out', 'apify-matrix.json'), JSON.stringify(results, null, 2));
console.log(`\nvariants returning data: ${results.filter((r) => (r.count ?? 0) > 0).length}/${variants.length}`);
