// The post actor works and is fast. Can a boolean query make it RELEVANT?
// Capped at 40 posts per query: $1.50/1k, so this probe costs about 12 cents.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const TOKEN = env.APIFY_TOKEN;
const ACTOR = 'harvestapi~linkedin-post-search';
const PER_QUERY = 40;

// The actor's docs allow up to 5 boolean operators and 500 characters.
const QUERIES = [
  '("roundtable" OR "summit" OR "conclave") AND ("BFSI" OR "banking") AND "Mumbai"',
  '("summit" OR "conference") AND ("fintech" OR "payments") AND "Bengaluru"',
];

const EVENT = /\b(summit|conference|conclave|roundtable|round table|meetup|forum|expo|symposium|workshop|masterclass|convention|congress|registrations? open|save the date|join us|we are hosting|hosting|will host|to host|invited to)\b/i;
const TOPIC = /\b(bank|payment|fintech|bfsi|financ|lending|insur|nbfc|credit|wealth|treasur|regtech|upi)/i;
const CITY = /\b(bengaluru|bangalore|mumbai|hyderabad)\b/i;
// A post advertising a FUTURE event, versus a thank-you for a past one
const PAST = /\b(was (a|an) (great|wonderful|fantastic)|thank(s| you) (all|everyone)|had (a|the) (great|wonderful)|recap|glimpses|yesterday|last week)\b/i;

async function run(q) {
  const t0 = Date.now();
  const s = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(TOKEN)}&timeout=240&memory=1024&maxItems=${PER_QUERY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchQueries: [q], maxPosts: PER_QUERY, postedLimit: 'month' }) }
  );
  const j = await s.json();
  if (!s.ok) return { q, error: JSON.stringify(j.error ?? j).replace(TOKEN, '[token]').slice(0, 150) };
  const { id, defaultDatasetId } = j.data;

  let status = 'RUNNING';
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const rr = await (await fetch(`https://api.apify.com/v2/actor-runs/${id}?token=${encodeURIComponent(TOKEN)}`)).json();
    status = rr.data.status;
    if (!['RUNNING', 'READY'].includes(status)) break;
  }
  const items = await (await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${encodeURIComponent(TOKEN)}&limit=${PER_QUERY}`
  )).json();
  return { q, status, secs: ((Date.now() - t0) / 1000).toFixed(0), items: Array.isArray(items) ? items : [] };
}

const all = [];
for (const q of QUERIES) {
  const r = await run(q);
  console.log(`\n=== ${q}`);
  if (r.error) { console.log(`    ERROR ${r.error}`); continue; }

  let ev = 0, both = 0, future = 0;
  const keep = [];
  for (const it of r.items) {
    const t = String(it.content ?? '');
    const e = EVENT.test(t), p = TOPIC.test(t), c = CITY.test(t), old = PAST.test(t);
    if (e) ev++;
    if (e && p) both++;
    if (e && p && c && !old) { future++; keep.push(it); }
  }
  console.log(`    ${r.status} in ${r.secs}s · ${r.items.length} posts`);
  console.log(`    mention an event:            ${ev}`);
  console.log(`    + a focus-area term:         ${both}`);
  console.log(`    + a target city, not a recap:${future}   <- these would reach Gemini`);
  for (const k of keep.slice(0, 5)) {
    console.log(`      -> ${String(k.content).replace(/\s+/g, ' ').slice(0, 118)}`);
    console.log(`         ${k.linkedinUrl}`);
  }
  all.push({ q, count: r.items.length, ev, both, future, keep: keep.slice(0, 8) });
}

writeFileSync(join(ROOT, 'spike', 'out', 'apify-posts-tuned.json'), JSON.stringify(all, null, 2));
const t = all.reduce((a, r) => ({ c: a.c + r.count, f: a.f + (r.future ?? 0) }), { c: 0, f: 0 });
console.log(`\nTOTAL ${t.c} posts fetched -> ${t.f} reach Gemini -> cost ${(t.c * 0.0015).toFixed(3)} USD`);
