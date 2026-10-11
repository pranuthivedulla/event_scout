// Spike 5: Eventbrite has no BFSI supply and nothing has deadlines.
// Do the sources the brief did NOT name do better?
// Testing: 10times (B2B conference index), AllEvents, Meetup.

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
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonLd(html) {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
}
function flattenEvents(blocks) {
  const out = [];
  const take = (o) => {
    if (!o || typeof o !== 'object') return;
    const t = o['@type'];
    if (t === 'Event' || (Array.isArray(t) && t.includes('Event')) || /Event$/.test(String(t || ''))) {
      out.push({
        name: o.name || null,
        startDate: o.startDate || null,
        endDate: o.endDate || null,
        mode: o.eventAttendanceMode || null,
        city: o?.location?.address?.addressLocality || o?.location?.name || null,
        url: typeof o.url === 'string' ? o.url : null,
        offers_validThrough: o?.offers?.validThrough || (Array.isArray(o?.offers) ? o.offers[0]?.validThrough : null) || null,
      });
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(take);
      else if (v && typeof v === 'object') take(v);
    }
  };
  blocks.forEach(take);
  return out;
}

const TARGETS = [
  ['10times Bengaluru banking', 'https://10times.com/bengaluru-in/banking-finance'],
  ['10times Mumbai banking', 'https://10times.com/mumbai-in/banking-finance'],
  ['10times India fintech', 'https://10times.com/india/fintech'],
  ['AllEvents Bengaluru biz', 'https://allevents.in/bengaluru/business'],
  ['Meetup fintech Bengaluru', 'https://www.meetup.com/find/?keywords=fintech&location=in--Bengaluru'],
];

const report = [];
for (const [label, url] of TARGETS) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
    const html = await r.text();
    const blocks = jsonLd(html);
    const evs = flattenEvents(blocks);
    const withDeadline = evs.filter((e) => e.offers_validThrough).length;
    console.log(`\n=== ${label}`);
    console.log(`    http ${r.status}  ${html.length}b  json-ld blocks ${blocks.length}  events ${evs.length}  with validThrough ${withDeadline}`);
    evs.slice(0, 6).forEach((e) =>
      console.log(`      - ${String(e.name).slice(0, 58)} | ${e.city} | ${e.startDate} | validThrough=${e.offers_validThrough || 'NONE'}`)
    );
    if (!evs.length) {
      // what IS in there?
      const types = blocks.flatMap((b) => (Array.isArray(b) ? b : [b])).map((b) => b['@type']).filter(Boolean);
      console.log('      json-ld @types present:', JSON.stringify(types).slice(0, 200));
    }
    report.push({ label, url, status: r.status, count: evs.length, withDeadline, events: evs.slice(0, 25) });
  } catch (e) {
    console.log(`\n=== ${label}\n    THREW ${e.message}`);
    report.push({ label, url, error: e.message });
  }
  await sleep(1200);
}

writeFileSync(join(OUT, 'alt-sources.json'), JSON.stringify(report, null, 2));
console.log('\n-> spike/out/alt-sources.json');
