// Does the LinkedIn actor EVER finish, given room?
//
// run-sync-get-dataset-items forces the actor to answer inside one HTTP
// request. If it genuinely needs minutes, that call can never succeed no
// matter what timeout we pass. Start it, poll it, then read the dataset.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const TOKEN = env.APIFY_TOKEN;
const ACTOR = process.argv[2] ?? 'maximedupre~linkedin-events';

const input = {
  target: 'discover',
  searchQuery: 'banking technology payments fintech bfsi',
  cities: ['Bengaluru', 'Mumbai', 'Hyderabad'],
  eventTiming: 'upcoming',
  eventFormat: 'any',
  searchMarket: 'auto',
};

console.log(`actor: ${ACTOR}`);
const t0 = Date.now();
const started = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(TOKEN)}&timeout=600&memory=1024`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
);
const startJson = await started.json();
if (!started.ok) {
  console.log('could not start:', JSON.stringify(startJson).replace(TOKEN, '[token]').slice(0, 300));
  process.exit(1);
}
const runId = startJson.data.id;
const datasetId = startJson.data.defaultDatasetId;
console.log(`run ${runId} started, dataset ${datasetId}`);

let status = 'READY';
for (let i = 0; i < 60; i++) {          // up to ~5 minutes
  await new Promise((r) => setTimeout(r, 5000));
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(TOKEN)}`);
  const j = await r.json();
  status = j.data.status;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (i % 3 === 0 || status !== 'RUNNING') console.log(`  ${secs}s  ${status}`);
  if (!['RUNNING', 'READY'].includes(status)) break;
}

console.log(`\nfinal status after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${status}`);

const items = await (await fetch(
  `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(TOKEN)}&limit=50`
)).json();
console.log(`dataset items: ${Array.isArray(items) ? items.length : 'n/a'}`);
for (const it of (Array.isArray(items) ? items : []).slice(0, 8)) {
  console.log(`  - ${String(it.title ?? JSON.stringify(it)).slice(0, 80)}`);
  if (it.eventUrl) console.log(`      ${it.eventUrl}  | ${it?.location?.city ?? '?'} | ${it.scheduleText ?? '?'}`);
}

// the run log says why it stalled, if it did
const log = await (await fetch(`https://api.apify.com/v2/actor-runs/${runId}/log?token=${encodeURIComponent(TOKEN)}`)).text();
console.log('\nlast lines of the actor log:');
console.log(log.split('\n').slice(-14).map((l) => '  ' + l.slice(0, 150)).join('\n'));
