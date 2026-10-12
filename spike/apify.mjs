// Spike 9: what does the LinkedIn events actor actually return?
// Build prompt step 2: report what it returns, do not build on it until confirmed.
//
// Costs ~$2.70 per 1,000 events, so this run is a fraction of a cent.
// maxItems is capped deliberately: a spike should not be able to run up a bill.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spike', 'out');
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const TOKEN = env.APIFY_TOKEN;
if (!TOKEN) { console.error('APIFY_TOKEN is empty'); process.exit(1); }

const ACTOR = 'maximedupre~linkedin-events';
const MAX_ITEMS = 40; // hard cap on what we will pay for

const input = {
  target: 'discover',
  searchQuery: 'banking payments fintech BFSI',
  cities: ['Bengaluru', 'Mumbai', 'Hyderabad'],
  eventTiming: 'upcoming',
  eventFormat: 'in_person',
  searchMarket: 'auto',
};

console.log('actor :', ACTOR);
console.log('input :', JSON.stringify(input));
console.log('cap   :', MAX_ITEMS, 'items\n');

const t0 = Date.now();
const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`
  + `?token=${encodeURIComponent(TOKEN)}&maxItems=${MAX_ITEMS}&timeout=180`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});

const text = await res.text();
console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (!res.ok) {
  // never echo the token, it is in the URL
  console.log('FAILED:', text.replace(TOKEN, '[token]').slice(0, 600));
  process.exit(1);
}

let items;
try { items = JSON.parse(text); } catch {
  console.log('could not parse response:', text.slice(0, 400));
  process.exit(1);
}
writeFileSync(join(OUT, 'apify.raw.json'), JSON.stringify(items, null, 2));

console.log(`items returned: ${Array.isArray(items) ? items.length : 'not an array'}\n`);
if (!Array.isArray(items) || !items.length) {
  console.log('Nothing came back. The actor ran but found no matching public events.');
  process.exit(0);
}

console.log('fields on the first item:');
console.log('  ' + Object.keys(items[0]).join(', ') + '\n');

const BFSI = /bank|payment|fintech|bfsi|financ|lending|insur|nbfc|credit|wealth|treasur|regtech|upi/i;
let withCity = 0, withDate = 0, withUrl = 0, bfsi = 0, deadline = 0;

for (const it of items) {
  const city = it?.location?.city ?? it?.location?.text ?? null;
  if (city) withCity++;
  if (it?.scheduleText) withDate++;
  if (it?.eventUrl) withUrl++;
  if (BFSI.test(`${it?.title ?? ''} ${it?.description ?? ''}`)) bfsi++;
  if (JSON.stringify(it).match(/deadline|registration clos|early bird/i)) deadline++;
}

console.log('coverage across all items:');
console.log(`  has a city        : ${withCity}/${items.length}`);
console.log(`  has schedule text : ${withDate}/${items.length}`);
console.log(`  has an event URL  : ${withUrl}/${items.length}`);
console.log(`  looks BFSI        : ${bfsi}/${items.length}`);
console.log(`  mentions a deadline anywhere: ${deadline}/${items.length}`);

console.log('\nfirst 8:');
for (const it of items.slice(0, 8)) {
  console.log(`\n  ${String(it.title ?? '(no title)').slice(0, 70)}`);
  console.log(`    city     : ${it?.location?.city ?? it?.location?.text ?? '—'}`);
  console.log(`    when     : ${it.scheduleText ?? '—'}`);
  console.log(`    format   : ${it.format ?? '—'}`);
  console.log(`    organiser: ${it?.organizer?.name ?? '—'}`);
  console.log(`    attendees: ${it.attendanceCount ?? '—'}`);
  console.log(`    url      : ${it.eventUrl ?? '—'}`);
}

console.log('\n-> spike/out/apify.raw.json');
