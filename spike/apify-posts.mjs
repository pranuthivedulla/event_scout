// LinkedIn EVENTS return nothing. But the roundtable Vikram missed was
// "posted only on LinkedIn" — a POST, not a LinkedIn Event object. Those are
// different data types and need a different actor.
//
// Run asynchronously: these actors need ~60s+, and a sync call below that
// looks like a timeout.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROOT, 'spike', 'out'), { recursive: true });
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const TOKEN = env.APIFY_TOKEN;

// Cheapest first. Pay-per-result, so an empty run costs nothing.
const CANDIDATES = [
  ['harvestapi~linkedin-post-search', {
    searchQueries: ['BFSI roundtable Mumbai', 'banking technology summit Bengaluru'],
    maxPosts: 20,
  }],
  ['harvestapi~linkedin-post-search', {
    query: 'fintech summit India',
    maxItems: 20,
  }],
  ['thirdwatch~linkedin-post-search-scraper', {
    queries: ['BFSI summit India'],
    maxResults: 20,
  }],
];

const MAX_ITEMS = 20; // hard cap: never let a probe run up a bill

async function tryActor(actor, input) {
  const t0 = Date.now();
  const s = await fetch(
    `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(TOKEN)}&timeout=240&memory=1024&maxItems=${MAX_ITEMS}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
  );
  const j = await s.json();
  if (!s.ok) {
    return { actor, error: JSON.stringify(j.error ?? j).replace(TOKEN, '[token]').slice(0, 160) };
  }
  const { id, defaultDatasetId } = j.data;

  let status = 'RUNNING';
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const rr = await (await fetch(`https://api.apify.com/v2/actor-runs/${id}?token=${encodeURIComponent(TOKEN)}`)).json();
    status = rr.data.status;
    if (!['RUNNING', 'READY'].includes(status)) break;
  }

  const items = await (await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${encodeURIComponent(TOKEN)}&limit=${MAX_ITEMS}`
  )).json();
  const log = await (await fetch(`https://api.apify.com/v2/actor-runs/${id}/log?token=${encodeURIComponent(TOKEN)}`)).text();

  return {
    actor,
    input: Object.keys(input).join(','),
    status,
    secs: ((Date.now() - t0) / 1000).toFixed(0),
    count: Array.isArray(items) ? items.length : 0,
    fields: Array.isArray(items) && items[0] ? Object.keys(items[0]).slice(0, 14) : [],
    items: Array.isArray(items) ? items.slice(0, 6) : [],
    tail: log.split('\n').filter(Boolean).slice(-4).map((l) => l.slice(0, 130)),
  };
}

const out = [];
for (const [actor, input] of CANDIDATES) {
  const r = await tryActor(actor, input);
  out.push(r);
  console.log(`\n=== ${actor}  (${Object.keys(input).join(', ')})`);
  if (r.error) { console.log(`    ERROR ${r.error}`); continue; }
  console.log(`    ${r.status} in ${r.secs}s, ${r.count} items`);
  if (r.fields.length) console.log(`    fields: ${r.fields.join(', ')}`);
  for (const it of r.items) {
    const text = it.content ?? it.text ?? it.postText ?? it.description ?? it.title ?? JSON.stringify(it);
    console.log(`    - ${String(text).replace(/\s+/g, ' ').slice(0, 110)}`);
    if (it.url ?? it.postUrl ?? it.link) console.log(`        ${it.url ?? it.postUrl ?? it.link}`);
  }
  if (!r.count) r.tail.forEach((l) => console.log(`    log: ${l}`));
  if (r.count > 0) break; // stop at the first that works; no point paying twice
}

writeFileSync(join(ROOT, 'spike', 'out', 'apify-posts.json'), JSON.stringify(out, null, 2));
console.log(`\nactors returning data: ${out.filter((r) => (r.count ?? 0) > 0).length}/${out.length}`);
