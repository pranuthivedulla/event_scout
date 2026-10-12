// Narrow filters returned nothing. Widen step by step to find where the
// supply actually is. Pay-per-event, so an empty result costs nothing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROOT,'spike','out'), { recursive: true });
const env = Object.fromEntries(readFileSync(join(ROOT,'.env'),'utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const TOKEN = env.APIFY_TOKEN;
const ACTOR = 'maximedupre~linkedin-events';

const variants = [
  ['cities + in_person + upcoming', { target:'discover', searchQuery:'fintech', cities:['Mumbai'], eventTiming:'upcoming', eventFormat:'in_person' }],
  ['cities, any format',            { target:'discover', searchQuery:'fintech', cities:['Mumbai'], eventTiming:'upcoming', eventFormat:'any' }],
  ['no city filter',                { target:'discover', searchQuery:'fintech Mumbai', eventTiming:'upcoming', eventFormat:'any' }],
  ['no city, any timing',           { target:'discover', searchQuery:'fintech India', eventTiming:'any', eventFormat:'any' }],
  ['broad: banking',                { target:'discover', searchQuery:'banking', eventTiming:'any', eventFormat:'any' }],
];

const results = [];
for (const [label, input] of variants) {
  const t0 = Date.now();
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}&maxItems=15&timeout=180`;
  try {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(input) });
    const txt = await res.text();
    let items = [];
    try { items = JSON.parse(txt); } catch {}
    const n = Array.isArray(items) ? items.length : 0;
    console.log(`${label.padEnd(32)} HTTP ${res.status}  ${String(n).padStart(3)} items  ${((Date.now()-t0)/1000).toFixed(0)}s`);
    if (n) {
      for (const it of items.slice(0,4))
        console.log(`     - ${String(it.title??'').slice(0,58)} | ${it?.location?.city ?? it?.location?.text ?? '—'} | ${it.scheduleText ?? '—'}`);
      results.push({ label, input, items });
    }
    if (!res.ok) console.log('     ' + txt.replace(TOKEN,'[token]').slice(0,200));
  } catch (e) {
    console.log(`${label.padEnd(32)} THREW ${String(e.message).slice(0,80)}`);
  }
}
writeFileSync(join(ROOT,'spike','out','apify-probe.json'), JSON.stringify(results, null, 2));
console.log(`\nvariants returning data: ${results.length}/${variants.length}`);
