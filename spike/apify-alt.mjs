// The cheap actor returns nothing even unfiltered. Is that the actor, or is
// LinkedIn event scraping simply not working right now? Try a second one.
// Capped at 10 items: this one bills ~$0.03/event, so worst case ~$0.30.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(join(ROOT,'.env'),'utf8').split(/\r?\n/)
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));
const TOKEN = env.APIFY_TOKEN;

const tries = [
  ['memo23~linkedin-events-scraper', { searchQueries: ['fintech india'], maxItems: 10 }],
  ['memo23~linkedin-events-scraper', { searchQueries: ['banking mumbai', 'fintech bengaluru'], maxItems: 10 }],
];

for (const [actor, input] of tries) {
  const t0 = Date.now();
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}&maxItems=10&timeout=150`;
  try {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(input) });
    const txt = await res.text();
    let items = []; try { items = JSON.parse(txt); } catch {}
    const n = Array.isArray(items) ? items.length : 0;
    console.log(`${actor}  ${JSON.stringify(input).slice(0,40)}  HTTP ${res.status}  ${n} items  ${((Date.now()-t0)/1000).toFixed(0)}s`);
    if (!res.ok) console.log('   ' + txt.replace(TOKEN,'[token]').slice(0,300));
    if (n) {
      writeFileSync(join(ROOT,'spike','out','apify-alt.json'), JSON.stringify(items, null, 2));
      for (const it of items.slice(0,5)) console.log('   - ' + JSON.stringify(it).slice(0,160));
      break;
    }
  } catch (e) { console.log(`${actor} THREW ${String(e.message).slice(0,90)}`); }
}
