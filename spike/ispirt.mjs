// Can iSPIRT and a few newsletter feeds actually be read?
import { readFileSync } from 'node:fs';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'accept-language': 'en-IN,en;q=0.9' };
const DATE_RX = /\b(\d{1,2}\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2},?\s*)?20(2[6-9]|3\d)\b/gi;

const targets = [
  ['iSPIRT home',        'https://ispirt.in/'],
  ['iSPIRT events',      'https://ispirt.in/events/'],
  ['iSPIRT pn-events',   'https://pn.ispirt.in/'],
  ['ETBFSI RSS',         'https://bfsi.economictimes.indiatimes.com/rss/topstories'],
  ['Medianama RSS',      'https://www.medianama.com/feed/'],
  ['Inc42 RSS',          'https://inc42.com/feed/'],
  ['YourStory RSS',      'https://yourstory.com/feed'],
  ['Moneycontrol BFSI',  'https://www.moneycontrol.com/rss/business.xml'],
];

for (const [label, url] of targets) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    const isFeed = /^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 500));
    const items = isFeed ? (body.match(/<item\b|<entry\b/gi) || []).length : 0;
    const dates = [...new Set((body.match(DATE_RX) || []).map(s => s.toLowerCase().trim()))];
    const jsonld = (body.match(/application\/ld\+json/g) || []).length;
    console.log(`${label.padEnd(20)} HTTP ${String(r.status).padStart(3)}  ${String(body.length).padStart(7)}b  ${isFeed ? `FEED ${items} items` : `html, ${jsonld} json-ld`}  dates:${dates.length}`);
    if (dates.length) console.log(`   ${dates.slice(0, 5).join(' / ')}`);
    if (isFeed) {
      const titles = [...body.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(m => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()).slice(1, 4);
      titles.forEach(t => console.log(`   - ${t.slice(0, 84)}`));
    }
  } catch (e) {
    console.log(`${label.padEnd(20)} FAILED ${String(e.message).slice(0, 50)}`);
  }
}
