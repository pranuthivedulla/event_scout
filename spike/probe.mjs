// Spike 4: three things the sweep left unresolved.
//  A. Does Eventbrite's real ?q= search filter properly (unlike the slug path)?
//  B. Do individual event pages carry end_sales_date for a LIVE future event?
//  C. Does Luma's __NEXT_DATA__ hold more than its JSON-LD, incl. any deadline?

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

function extractObject(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
const get = async (u) => { const r = await fetch(u, { headers: UA, redirect: 'follow' }); return { status: r.status, finalUrl: r.url, html: await r.text() }; };

// ---------- A: real ?q= search ----------
console.log('=== A. Eventbrite ?q= search (city listing + explicit query) ===');
const queries = ['fintech', 'banking', 'payments', 'BFSI'];
const aOut = [];
for (const q of queries) {
  const url = `https://www.eventbrite.com/d/india--bangalore/events/?q=${encodeURIComponent(q)}`;
  const { status, html } = await get(url);
  const d = extractObject(html, '__SERVER_DATA__');
  const ev = d?.search_data?.events || {};
  const organic = ev.results || [];
  console.log(`\n  q="${q}"  http ${status}  object_count=${ev?.pagination?.object_count}  organic=${organic.length}`);
  console.log('  search params echoed back:', JSON.stringify(d?.search_data?.event_search || {}));
  organic.slice(0, 6).forEach((e) =>
    console.log(`    - ${e.name} | ${e?.primary_venue?.address?.city} | ${e.start_date} | deadline=${e?.ticket_availability?.end_sales_date?.utc || 'NONE'}`)
  );
  aOut.push({ q, status, count: ev?.pagination?.object_count, titles: organic.map((e) => e.name) });
  await sleep(900);
}

// ---------- B: individual event page, live + future ----------
console.log('\n=== B. Individual Eventbrite event pages: is end_sales_date there? ===');
// take real future-dated events found in the sweep
const sweep = JSON.parse((await import('node:fs')).readFileSync(join(OUT, 'source-sweep.json'), 'utf8'));
const candidates = [];
for (const row of sweep.eventbrite) for (const e of row.organic || []) {
  if (e.url && e.start_date && e.start_date >= '2026-10-12' && !candidates.find((c) => c.url === e.url)) candidates.push(e);
}
const bOut = [];
for (const c of candidates.slice(0, 4)) {
  const { status, html } = await get(c.url);
  const nd = extractObject(html, '__NEXT_DATA__');
  const ctx = nd?.props?.pageProps?.context || {};
  const ta = ctx.ticketAvailability || ctx.ticket_availability || null;
  const found = {
    title: c.title,
    http: status,
    has_next_data: !!nd,
    // hunt for any sales-end date anywhere in the embedded blob
    end_sales_date:
      ta?.endSalesDate?.utc || ta?.end_sales_date?.utc ||
      ctx?.eventSalesStatus?.endSalesDate?.utc || null,
    sales_status: ctx?.eventSalesStatus?.salesStatus || ctx?.event_sales_status?.sales_status || null,
    raw_hits: ['endSalesDate', 'end_sales_date', 'salesEnd'].filter((k) => html.includes(k)),
  };
  console.log(`  ${(c.title || '').slice(0, 52).padEnd(54)} http ${status}  deadline=${found.end_sales_date || 'NONE'}  status=${found.sales_status}  keys_present=${found.raw_hits.join(',') || 'none'}`);
  bOut.push(found);
  await sleep(900);
}

// ---------- C: Luma __NEXT_DATA__ ----------
console.log('\n=== C. Luma __NEXT_DATA__ depth ===');
const { html: lh } = await get('https://luma.com/bengaluru');
const lnd = extractObject(lh, '__NEXT_DATA__');
const pp = lnd?.props?.pageProps || {};
console.log('  pageProps keys:', Object.keys(pp).join(', ') || '(none)');
const findEntries = (o, depth = 0) => {
  if (!o || depth > 4) return null;
  if (Array.isArray(o) && o.length && o[0]?.event) return o;
  if (typeof o === 'object') for (const k of Object.keys(o)) { const r = findEntries(o[k], depth + 1); if (r) return r; }
  return null;
};
const entries = findEntries(pp);
console.log('  event entries found:', entries ? entries.length : 0);
if (entries?.[0]?.event) {
  console.log('  event object keys:', Object.keys(entries[0].event).join(', '));
  const e = entries[0].event;
  console.log('  sample:', JSON.stringify({
    name: e.name, start_at: e.start_at, end_at: e.end_at,
    timezone: e.timezone, url: e.url,
    geo_city: e.geo_address_info?.city_state || e.geo_address_info?.city,
    registration_close: e.registration_close_at ?? '(no such field)',
  }, null, 1));
}
writeFileSync(join(OUT, 'probe.json'), JSON.stringify({ a: aOut, b: bOut }, null, 2));
console.log('\n-> spike/out/probe.json');
