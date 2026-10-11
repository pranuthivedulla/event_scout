// Spike 3: how much real BFSI event supply is there across Eventbrite + Luma?
// Pure code, no Gemini. Run: node spike/source-sweep.mjs
//
// Answers the question the brief never asks: is there actually enough to fill
// a 15-event digest every Monday?

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

// --- brace-matched extraction of an embedded JS object ----------------------
function extractObject(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0,
    inStr = false,
    quote = '',
    esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
}

// --- Eventbrite discovery ---------------------------------------------------
function parseEventbrite(html) {
  const d = extractObject(html, '__SERVER_DATA__');
  if (!d) return { error: 'no __SERVER_DATA__' };
  const sd = d.search_data || {};
  const ev = sd.events || {};
  const organic = ev.results || [];
  const promoted = ev.promoted_results || [];
  const map = (e) => ({
    id: e.id,
    title: e.name || e.summary || null,
    start_date: e.start_date || null,
    city: e?.primary_venue?.address?.city || e?.primary_venue?.address?.localized_area_display || null,
    online: e.is_online_event ?? null,
    // THE field that drives the red flag:
    end_sales_date: e?.ticket_availability?.end_sales_date?.utc || null,
    sales_status: e?.event_sales_status?.sales_status || null,
    url: e.url || null,
    tz: e.timezone || null,
  });
  return {
    object_count: ev?.pagination?.object_count ?? null,
    organic: organic.map(map),
    promoted: promoted.map(map),
  };
}

// --- Luma -------------------------------------------------------------------
function parseLuma(html) {
  const blocks = jsonLdBlocks(html);
  const events = [];
  for (const b of blocks) {
    const arr = Array.isArray(b) ? b : [b];
    for (const o of arr) {
      if (o['@type'] === 'Event') {
        events.push({
          title: o.name || null,
          start_date: o.startDate || null,
          end_date: o.endDate || null,
          mode: o.eventAttendanceMode || null,
          city: o?.location?.address?.addressLocality || o?.location?.name || null,
          url: o.url || null,
        });
      }
      if (o.itemListElement) {
        for (const it of o.itemListElement) {
          const i = it.item || it;
          if (i.url && (i.startDate || i.name))
            events.push({
              title: i.name || null,
              start_date: i.startDate || null,
              end_date: i.endDate || null,
              mode: i.eventAttendanceMode || null,
              city: i?.location?.address?.addressLocality || null,
              url: i.url,
            });
        }
      }
    }
  }
  const nd = extractObject(html, '__NEXT_DATA__');
  return { events, hasNextData: !!nd };
}

async function get(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  return { status: r.status, finalUrl: r.url, html: await r.text() };
}

// --- the grid ---------------------------------------------------------------
const EB_CITIES = [
  ['Bengaluru', 'india--bangalore'],
  ['Mumbai', 'india--mumbai'],
  ['Hyderabad', 'india--hyderabad'],
];
const EB_KEYWORDS = ['finance', 'fintech', 'banking', 'payments', 'financial-services', 'bfsi'];

const LUMA_URLS = [
  ['Luma Bengaluru', 'https://luma.com/bangalore'],
  ['Luma Mumbai', 'https://luma.com/mumbai'],
  ['Luma Hyderabad', 'https://luma.com/hyderabad'],
  ['Luma discover', 'https://luma.com/discover'],
];

const report = { eventbrite: [], luma: [] };
const seen = new Set();

console.log('=== EVENTBRITE ===');
console.log('city        keyword              count  organic  w/deadline  offcity');
for (const [cityName, slug] of EB_CITIES) {
  for (const kw of EB_KEYWORDS) {
    const url = `https://www.eventbrite.com/d/${slug}/${kw}/`;
    try {
      const { status, html } = await get(url);
      const p = parseEventbrite(html);
      if (p.error) {
        console.log(`${cityName.padEnd(11)} ${kw.padEnd(20)} PARSE FAIL (${p.error}) http ${status}`);
        report.eventbrite.push({ cityName, kw, url, status, error: p.error });
        continue;
      }
      const withDeadline = p.organic.filter((e) => e.end_sales_date).length;
      // promoted results are ads and are NOT city-filtered
      const offCity = p.promoted.length;
      p.organic.forEach((e) => e.url && seen.add(e.url.split('?')[0]));
      console.log(
        `${cityName.padEnd(11)} ${kw.padEnd(20)} ${String(p.object_count ?? '?').padStart(5)}  ${String(p.organic.length).padStart(7)}  ${String(withDeadline).padStart(10)}  ${String(offCity).padStart(7)}`
      );
      report.eventbrite.push({ cityName, kw, url, status, ...p });
    } catch (e) {
      console.log(`${cityName.padEnd(11)} ${kw.padEnd(20)} THREW ${e.message}`);
      report.eventbrite.push({ cityName, kw, url, error: e.message });
    }
    await sleep(900);
  }
}

console.log('\n=== LUMA ===');
for (const [label, url] of LUMA_URLS) {
  try {
    const { status, html, finalUrl } = await get(url);
    const p = parseLuma(html);
    console.log(`${label.padEnd(18)} http ${status}  json-ld events: ${p.events.length}  __NEXT_DATA__: ${p.hasNextData}  -> ${finalUrl}`);
    if (p.events[0]) console.log('   sample:', JSON.stringify(p.events[0]));
    report.luma.push({ label, url, status, finalUrl, ...p });
  } catch (e) {
    console.log(`${label.padEnd(18)} THREW ${e.message}`);
    report.luma.push({ label, url, error: e.message });
  }
  await sleep(900);
}

console.log(`\n=== TOTAL distinct Eventbrite event URLs across the whole grid: ${seen.size} ===`);
writeFileSync(join(OUT, 'source-sweep.json'), JSON.stringify(report, null, 2));
console.log('full report -> spike/out/source-sweep.json');
