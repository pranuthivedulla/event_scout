#!/usr/bin/env node
/**
 * Does a newsletter feed carry events worth paying for?
 *
 *   node scripts/check-feed.mjs https://something.substack.com/feed
 *   node scripts/check-feed.mjs something.substack.com        (/feed is added)
 *
 * Reports: whether the feed parses, how many items it carries, and how many
 * clear the plain-code gate that decides whether Gemini sees anything. A feed
 * that scores 0 candidates costs nothing per run, so it is safe to add —
 * it just will not contribute events either.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Usage: node scripts/check-feed.mjs <url> [url...]');
  process.exit(0);
}

/** Substack, Ghost and WordPress all answer at /feed; add it when it is missing. */
function feedUrl(raw) {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (!/\/(feed|rss|atom)(\.xml)?\/?$/i.test(u)) u = u.replace(/\/+$/, '') + '/feed';
  return u;
}

const { parseFeed, looksLikeAnEvent } = await import('../src/lib/sources/rss.ts');
const { getSettings } = await import('../src/lib/db.ts');

let settings;
try {
  settings = await getSettings();
} catch {
  settings = {
    cities: ['Bengaluru', 'Mumbai', 'Hyderabad'],
    focus_areas: [
      { name: 'Banking and core banking technology', level: 'High' },
      { name: 'Payments and digital payments', level: 'High' },
      { name: 'Fintech and BFSI at large', level: 'Medium' },
    ],
    extra_sources: [], recipient: '', window_days: 90,
  };
}
console.log(`gate built from focus areas: ${settings.focus_areas.map((f) => f.name).join(' | ')}\n`);

const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  accept: 'application/rss+xml, application/xml, text/xml, */*',
};

for (const raw of args) {
  const url = feedUrl(raw);
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();

    if (!res.ok) { console.log(`${url}\n  HTTP ${res.status} — not a readable feed\n`); continue; }
    if (!/<\?xml|<rss|<feed/i.test(body.slice(0, 500))) {
      console.log(`${url}\n  HTTP ${res.status} but this is a web page, not a feed. Add it under`);
      console.log(`  "Organiser sites you follow" in Settings instead.\n`);
      continue;
    }

    const items = parseFeed(body);
    const hits = items.filter((i) => looksLikeAnEvent(i.text, settings));
    console.log(`${url}`);
    console.log(`  HTTP ${res.status} · ${items.length} items · ${hits.length} clear the gate`);
    for (const h of hits.slice(0, 5)) console.log(`    -> ${h.title.slice(0, 84)}`);
    if (!hits.length && items.length) {
      console.log(`    recent titles, for a sense of what it publishes:`);
      for (const i of items.slice(0, 3)) console.log(`       ${i.title.slice(0, 78)}`);
    }
    console.log(
      hits.length
        ? `  VERDICT: worth adding — ${hits.length} article(s) would be read this run.\n`
        : `  VERDICT: safe to add, but it carries no events this week, so it costs nothing and contributes nothing.\n`
    );
  } catch (e) {
    console.log(`${url}\n  failed: ${String(e.message).slice(0, 70)}\n`);
  }
}
