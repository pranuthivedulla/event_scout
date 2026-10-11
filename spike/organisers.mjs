// Spike 6: BFSI events live on organiser sites, not ticketing platforms.
// Which organiser sites can we actually fetch and parse, and do they have RSS?

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spike', 'out');
mkdirSync(OUT, { recursive: true });

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept-language': 'en-IN,en;q=0.9',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonLdEvents(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
  const out = [];
  const take = (o) => {
    if (!o || typeof o !== 'object') return;
    const t = String(o['@type'] || '');
    if (/Event/.test(t)) out.push({ name: o.name, startDate: o.startDate, city: o?.location?.address?.addressLocality || o?.location?.name, url: typeof o.url === 'string' ? o.url : null });
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(take); else if (v && typeof v === 'object') take(v);
    }
  };
  blocks.forEach(take);
  return out;
}

// signals that a page is a real, dated event listing even without JSON-LD
const DATE_RX = /\b(\d{1,2}\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2},?\s+)?20(2[6-9]|3\d)\b/gi;
const DEADLINE_RX = /(registration\s+(closes|deadline|ends)|early\s*bird\s+(ends|closes|until|till)|last\s+date\s+to\s+register|rsvp\s+by)/gi;

const SITES = [
  // organiser sites
  ['Exito Media', 'https://www.exito-e.com/'],
  ['Exito upcoming', 'https://www.exito-e.com/upcoming-events'],
  ['Elets Technomedia', 'https://elets.in/events/'],
  ['ETBFSI events', 'https://bfsi.economictimes.indiatimes.com/events'],
  ['UBS Forums', 'https://www.ubsforums.com/'],
  ['BFSI Bharat', 'https://bfsibharat.com/'],
  ['BFSI Tech Summit', 'https://bfsitechsummit.in/'],
  ['e4m events', 'https://e4mevents.com/'],
  ['Entraine', 'https://entraine.com/'],
  ['Global Fintech Fest', 'https://globalfintechfest.com/'],
  ['Nasscom events', 'https://nasscom.in/events'],
  // aggregator, retry with full browser headers
  ['10times bengaluru', 'https://10times.com/bengaluru-in/banking-finance'],
  // RSS candidates
  ['ETBFSI RSS', 'https://bfsi.economictimes.indiatimes.com/rss/topstories'],
  ['Medianama RSS', 'https://www.medianama.com/feed/'],
  ['Entrackr RSS', 'https://entrackr.com/feed/'],
];

const report = [];
console.log('site                    http   bytes   jsonld-ev  future-dates  deadline-words  rss?');
for (const [label, url] of SITES) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
    const body = await r.text();
    const isXml = /^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 400));
    const evs = isXml ? [] : jsonLdEvents(body);
    const futureDates = [...new Set((body.match(DATE_RX) || []).map((s) => s.toLowerCase().trim()))];
    const deadlineWords = [...new Set((body.match(DEADLINE_RX) || []).map((s) => s.toLowerCase().trim()))];
    // does the HTML advertise an RSS feed?
    const rssLink = (body.match(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/i) || [])[0] || null;
    const rssHref = rssLink ? (rssLink.match(/href=["']([^"']+)["']/) || [])[1] : null;

    console.log(
      `${label.padEnd(23)} ${String(r.status).padStart(4)}  ${String(body.length).padStart(7)}  ${String(evs.length).padStart(9)}  ${String(futureDates.length).padStart(12)}  ${String(deadlineWords.length).padStart(14)}  ${isXml ? 'IS-RSS' : rssHref ? 'yes' : '-'}`
    );
    if (evs.length) evs.slice(0, 3).forEach((e) => console.log(`      JSONLD: ${String(e.name).slice(0, 60)} | ${e.city} | ${e.startDate}`));
    if (!evs.length && futureDates.length) console.log(`      dates seen: ${futureDates.slice(0, 6).join(' / ')}`);
    if (deadlineWords.length) console.log(`      DEADLINE WORDS: ${deadlineWords.slice(0, 4).join(' / ')}`);
    if (isXml) {
      const titles = [...body.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()).slice(1, 4);
      console.log(`      feed items: ${titles.join(' | ').slice(0, 160)}`);
    }
    if (rssHref) console.log(`      rss: ${rssHref}`);
    report.push({ label, url, status: r.status, bytes: body.length, jsonldEvents: evs, futureDates: futureDates.slice(0, 20), deadlineWords, rssHref, isXml });
  } catch (e) {
    console.log(`${label.padEnd(23)} THREW ${e.message.slice(0, 60)}`);
    report.push({ label, url, error: e.message });
  }
  await sleep(1000);
}

writeFileSync(join(OUT, 'organisers.json'), JSON.stringify(report, null, 2));
console.log('\n-> spike/out/organisers.json');
