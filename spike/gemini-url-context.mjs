// Spike 1: can Gemini Flash + url_context read real event pages and return structured fields?
// Run: node spike/gemini-url-context.mjs
// Writes raw responses to spike/out/ (gitignored). Never prints the key.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'spike', 'out');
mkdirSync(OUT, { recursive: true });

// --- config (exam rule: model id lives in ONE constant) ---------------------
const MODEL = 'gemini-3.8-flash';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const KEY = env.GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY missing from .env');

// --- the extraction contract ------------------------------------------------
// Rule 6 of the brief: never guess. Unknown must come back null, not invented.
const FIELDS = `
title                  the event name, exactly as the page states it
start_date             ISO yyyy-mm-dd, the first day of the event
end_date               ISO yyyy-mm-dd, or same as start_date for a one-day event
city                   the city it is physically held in, as the page states it
venue                  venue name or address if stated
format                 exactly one of: in-person | hybrid | online
registration_deadline  ISO yyyy-mm-dd ONLY if the page states a registration or
                       ticket-sales closing date. If the page does not state one,
                       return null. Do NOT use the event date as the deadline.
organiser              the organising person or company as stated
audience_tag           ONLY if the page explicitly names its audience, e.g.
                       "CIO roundtable", "CXO only", "invite-only for founders".
                       If the page does not state an audience, return null.
                       Never infer this from the topic.
summary                exactly two sentences describing what happens at the event
is_past                true if the event date has already passed
`.trim();

const prompt = (url) => `Read ${url} and extract this event as JSON.

Fields:
${FIELDS}

Rules:
- Return ONLY a JSON object, no prose, no markdown fence.
- Any field the page does not state must be null. Never guess, never infer,
  never substitute a nearby date for a missing one.
- Add a field "page_readable": true if you could actually read event content at
  that URL, false if the page was empty, blocked, or not an event page.`;

async function call(label, url) {
  const started = Date.now();
  const body = {
    model: MODEL,
    input: prompt(url),
    tools: [{ type: 'url_context' }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': KEY,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  writeFileSync(join(OUT, `${label}.raw.json`), text);

  if (!res.ok) {
    return { label, url, ok: false, http: res.status, error: text.slice(0, 400) };
  }

  const json = JSON.parse(text);
  const steps = json.steps || [];

  // model text
  let out = '';
  for (const s of steps) {
    if (s.type === 'model_output') {
      for (const c of s.content || []) if (c.type === 'text') out += c.text;
    }
  }

  // what url_context actually managed to retrieve
  const retrieval = steps
    .filter((s) => s.type === 'url_context_result' || s.url_context_result)
    .flatMap((s) => {
      const r = s.url_context_result || s;
      const arr = r.url_metadata || r.results || (Array.isArray(r) ? r : [r]);
      return (Array.isArray(arr) ? arr : [arr]).map((m) => ({
        url: m.retrieved_url || m.url || null,
        status: m.url_retrieval_status || m.status || null,
      }));
    });

  let parsed = null;
  let parseError = null;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
    if (!parsed) parseError = 'no JSON object found in model output';
  } catch (e) {
    parseError = e.message;
  }

  return {
    label,
    url,
    ok: true,
    http: res.status,
    ms: Date.now() - started,
    usage: json.usage || null,
    retrieval,
    parsed,
    parseError,
    rawTextSample: parsed ? null : out.slice(0, 500),
  };
}

const TARGETS = [
  // a real, future-dated Eventbrite event detail page
  ['eventbrite-event', 'https://www.eventbrite.com/e/the-future-of-fintech-tickets-1974670707242'],
  // a real Luma event detail page
  ['luma-event', 'https://lu.ma/31qch4vj'],
  // a DISCOVERY page: this is how the pipeline would find events in the first place
  ['eventbrite-discovery', 'https://www.eventbrite.com/d/india--bangalore/finance/'],
];

const results = [];
for (const [label, url] of TARGETS) {
  process.stdout.write(`\n=== ${label} ===\n${url}\n`);
  try {
    const r = await call(label, url);
    results.push(r);
    if (!r.ok) {
      console.log(`FAILED  http ${r.http}\n${r.error}`);
      continue;
    }
    console.log(`http ${r.http}  ${r.ms}ms`);
    console.log('retrieval:', JSON.stringify(r.retrieval));
    console.log('usage:', JSON.stringify(r.usage));
    if (r.parsed) console.log('parsed:', JSON.stringify(r.parsed, null, 2));
    else console.log(`PARSE FAILED (${r.parseError})\nmodel said: ${r.rawTextSample}`);
  } catch (e) {
    console.log('THREW:', e.message);
    results.push({ label, url, ok: false, error: e.message });
  }
}

writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
console.log(`\n--- raw responses in spike/out/ ---`);
