// Spike 7: THE load-bearing test.
// ETBFSI and Nasscom have no JSON-LD. The plan needs Gemini url_context to read
// their listing pages. url_context already failed on Eventbrite's listing page.
// If it fails here too, the source plan does not work and we need another route.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spike', 'out');
mkdirSync(OUT, { recursive: true });

const MODEL = 'gemini-3.8-flash';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const KEY = env.GEMINI_API_KEY;

const prompt = (url) => `Read ${url} and list every UPCOMING event it advertises.

Return ONLY a JSON object: {"page_readable": true|false, "events": [...]}

Each event object:
  title                  as the page states it
  start_date             ISO yyyy-mm-dd, or null if the page does not state one
  city                   as the page states it, or null
  format                 "in-person" | "hybrid" | "online" | null
  registration_deadline  ISO yyyy-mm-dd ONLY if the page states a registration
                         or early-bird closing date. Otherwise null.
                         Never use the event date as the deadline.
  event_url              the link to that event's own page, absolute, or null

Rules:
- Only events that have not happened yet. Today is 2026-10-11.
- Any field the page does not state must be null. Never guess or infer.
- "page_readable": false if you could not read actual listing content there.
- If there are no upcoming events, return an empty array, not invented ones.`;

async function call(label, url) {
  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json', 'Api-Revision': API_REVISION },
    body: JSON.stringify({ model: MODEL, input: prompt(url), tools: [{ type: 'url_context' }] }),
  });
  const text = await res.text();
  writeFileSync(join(OUT, `disc-${label}.raw.json`), text);
  if (!res.ok) return { label, url, ok: false, http: res.status, error: text.slice(0, 300) };

  const j = JSON.parse(text);
  let out = '';
  const retrieval = [];
  for (const s of j.steps || []) {
    if (s.type === 'model_output') for (const c of s.content || []) if (c.type === 'text') out += c.text;
    if (s.type === 'url_context_result') {
      const r = typeof s.result === 'string' ? JSON.parse(s.result) : s.result;
      (Array.isArray(r) ? r : [r]).forEach((x) => retrieval.push(x));
    }
  }
  let parsed = null, err = null;
  try { const m = out.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
  catch (e) { err = e.message; }
  return { label, url, ok: true, ms: Date.now() - t0, usage: j.usage, retrieval, parsed, err, raw: parsed ? null : out.slice(0, 400) };
}

const TARGETS = [
  ['etbfsi', 'https://bfsi.economictimes.indiatimes.com/events'],
  ['nasscom', 'https://nasscom.in/events'],
];

const all = [];
for (const [label, url] of TARGETS) {
  console.log(`\n=== ${label}  ${url}`);
  const r = await call(label, url);
  all.push(r);
  if (!r.ok) { console.log(`  FAILED http ${r.http}: ${r.error}`); continue; }
  console.log(`  ${r.ms}ms  tokens=${r.usage?.total_tokens}`);
  console.log(`  retrieval: ${JSON.stringify(r.retrieval)}`);
  if (!r.parsed) { console.log(`  PARSE FAILED: ${r.err}\n  ${r.raw}`); continue; }
  console.log(`  page_readable=${r.parsed.page_readable}  events=${(r.parsed.events || []).length}`);
  for (const e of r.parsed.events || [])
    console.log(`    - ${String(e.title).slice(0, 58).padEnd(60)} ${e.start_date || '????'} | ${e.city || '?'} | ${e.format || '?'} | deadline=${e.registration_deadline || 'NONE'}`);
}
writeFileSync(join(OUT, 'gemini-discovery.json'), JSON.stringify(all, null, 2));
console.log('\n-> spike/out/gemini-discovery.json');
