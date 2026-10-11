/**
 * The ONLY place this system calls a model.
 *
 * Gemini does exactly four things (brief §5):
 *   1. extract event details from page text
 *   2. write the two-line summary
 *   3. score fit to focus areas, with a one-line reason
 *   4. structure LinkedIn text coming from Apify   (deferred: no APIFY_TOKEN yet)
 *
 * It never filters, never ranks, never does date arithmetic, never applies the
 * cap. Those are in dates.ts / filters.ts / rank.ts and are covered by tests.
 */

import {
  GEMINI_API_URL,
  GEMINI_API_REVISION,
  GEMINI_MODEL,
} from '@/config';
import type { EventFormat, ScoutEvent, Settings } from './types';
import { isISODate } from './dates';

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

interface CallOpts {
  input: string;
  urlContext?: boolean;
  /** Total attempts including the first. */
  attempts?: number;
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  /** [{url, status}] from the url_context tool — the truth about what loaded. */
  retrieval: { url: string; status: string }[];
  tokens: number;
}

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError('GEMINI_API_KEY is not set');
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One model call, with retry and backoff on transient failures. */
export async function callGemini(opts: CallOpts): Promise<CallResult> {
  const attempts = opts.attempts ?? 3;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1200 * 2 ** (i - 1)); // 1.2s, 2.4s

    let res: Response;
    try {
      res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey(),
          'Content-Type': 'application/json',
          'Api-Revision': GEMINI_API_REVISION,
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: opts.input,
          ...(opts.urlContext ? { tools: [{ type: 'url_context' }] } : {}),
        }),
        signal: opts.signal,
      });
    } catch (e) {
      lastErr = e;
      continue; // network blip: retry
    }

    if (res.status === 429 || res.status >= 500) {
      lastErr = new GeminiError(`transient ${res.status}`, res.status);
      continue;
    }
    if (!res.ok) {
      // 4xx other than rate limit will not fix itself. Never echo the body
      // wholesale in case a key or header ends up in it.
      throw new GeminiError(`Gemini returned ${res.status}`, res.status);
    }

    const json = (await res.json()) as {
      steps?: { type?: string; content?: { type?: string; text?: string }[]; result?: unknown }[];
      usage?: { total_tokens?: number };
    };

    let text = '';
    const retrieval: { url: string; status: string }[] = [];
    for (const s of json.steps ?? []) {
      if (s.type === 'model_output') {
        for (const c of s.content ?? []) if (c.type === 'text' && c.text) text += c.text;
      }
      if (s.type === 'url_context_result') {
        const raw = typeof s.result === 'string' ? safeParse(s.result) : s.result;
        for (const r of Array.isArray(raw) ? raw : raw ? [raw] : []) {
          const o = r as { url?: string; status?: string };
          if (o?.url) retrieval.push({ url: o.url, status: String(o.status ?? 'unknown') });
        }
      }
    }
    return { text, retrieval, tokens: json.usage?.total_tokens ?? 0 };
  }

  throw lastErr instanceof Error ? lastErr : new GeminiError('Gemini call failed');
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Pull the first JSON object or array out of a model response. */
export function extractJSON<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; } } }
  }
  return null;
}

// --------------------------------------------------------------------------
// Shared prompt language. Rule 6 is restated in every prompt, not assumed.
// --------------------------------------------------------------------------

const NEVER_GUESS = `
Rules you must follow exactly:
- Any field the page does not state must be null. Never guess it, never infer
  it, never substitute a nearby or similar value for a missing one.
- registration_deadline is ONLY a date the page explicitly gives as a
  registration, ticket-sales or early-bird closing date. The event's own date
  is NOT a registration deadline. If the page does not state one, return null.
- audience_tag is ONLY an audience the page explicitly names, such as
  "CIO roundtable", "CXO only" or "invite-only". Never infer an audience from
  the event's topic. If the page does not name one, return null.
- Do not invent URLs. Only return a URL that appears on the page.
- Return ONLY JSON. No prose, no markdown fence, no commentary.`.trim();

// --------------------------------------------------------------------------
// 1. Extract: read a listing page and return the events it advertises.
//    Used for 'page' sources (organiser sites) which carry no structured data.
// --------------------------------------------------------------------------

export interface ExtractedEvent {
  title: string;
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  venue: string | null;
  format: EventFormat | null;
  registration_deadline: string | null;
  organiser: string | null;
  audience_tag: string | null;
  event_url: string | null;
}

export async function extractFromListing(
  url: string,
  today: string
): Promise<{ events: ExtractedEvent[]; readable: boolean; retrieval: CallResult['retrieval']; tokens: number }> {
  const input = `Read ${url} and list every UPCOMING event it advertises.

Today is ${today}. Only include events that have not happened yet.

Return ONLY this JSON object:
{"page_readable": true|false, "events": [
  {"title": "...", "start_date": "yyyy-mm-dd"|null, "end_date": "yyyy-mm-dd"|null,
   "city": "..."|null, "venue": "..."|null,
   "format": "in-person"|"hybrid"|"online"|null,
   "registration_deadline": "yyyy-mm-dd"|null, "organiser": "..."|null,
   "audience_tag": "..."|null, "event_url": "absolute url"|null}
]}

${NEVER_GUESS}
- "page_readable" is false if you could not read actual listing content there.
- If there are no upcoming events, return an empty array. Never pad it.`;

  const res = await callGemini({ input, urlContext: true });
  const parsed = extractJSON<{ page_readable?: boolean; events?: ExtractedEvent[] }>(res.text);
  return {
    events: Array.isArray(parsed?.events) ? parsed!.events!.map(cleanExtracted) : [],
    readable: parsed?.page_readable !== false,
    retrieval: res.retrieval,
    tokens: res.tokens,
  };
}

// --------------------------------------------------------------------------
// 2. Enrich: read one event's own page for its two-line summary, its audience
//    tag, and a registration deadline if the prose states one.
//    This is the only route to a real deadline — no source exposes one in
//    structured data (fifteen checked). See DECISIONS.md.
// --------------------------------------------------------------------------

export interface Enrichment {
  source_url: string;
  summary: string | null;
  audience_tag: string | null;
  registration_deadline: string | null;
  format: EventFormat | null;
  city: string | null;
}

export async function enrichEvents(
  events: ScoutEvent[],
  today: string
): Promise<{ enrichments: Enrichment[]; retrieval: CallResult['retrieval']; tokens: number }> {
  if (!events.length) return { enrichments: [], retrieval: [], tokens: 0 };

  const list = events.map((e, i) => `${i + 1}. ${e.title} — ${e.source_url}`).join('\n');
  const input = `Read each of these event pages and describe each event.

Today is ${today}.

${list}

Return ONLY a JSON array, one object per event, in the same order:
[{"source_url": "the url you were given",
  "summary": "exactly two sentences on what happens at this event"|null,
  "audience_tag": "..."|null,
  "registration_deadline": "yyyy-mm-dd"|null,
  "format": "in-person"|"hybrid"|"online"|null,
  "city": "..."|null}]

${NEVER_GUESS}
- summary is exactly two sentences, plain and factual, no selling language.
  If you could not read the page, summary is null.
- Read the page text carefully for a stated registration or early-bird closing
  date; it is often in the body rather than near the title. If there is none,
  registration_deadline is null. This is normal and expected.`;

  const res = await callGemini({ input, urlContext: true });
  const parsed = extractJSON<Enrichment[]>(res.text);
  const arr = Array.isArray(parsed) ? parsed : [];
  return {
    enrichments: arr.map((e) => ({
      source_url: typeof e?.source_url === 'string' ? e.source_url : '',
      summary: twoSentences(e?.summary),
      audience_tag: nonEmpty(e?.audience_tag),
      registration_deadline: isISODate(e?.registration_deadline) ? e.registration_deadline! : null,
      format: validFormat(e?.format),
      city: nonEmpty(e?.city),
    })),
    retrieval: res.retrieval,
    tokens: res.tokens,
  };
}

// --------------------------------------------------------------------------
// 3. Score: fit to the configured focus areas, with a one-line reason.
//    No url_context — it works on text we already have, so it is fast and
//    can be batched generously.
// --------------------------------------------------------------------------

export interface Scoring {
  index: number;
  score: number;
  reason: string;
  focus_area: string | null;
}

export async function scoreEvents(
  events: ScoutEvent[],
  settings: Settings
): Promise<{ scorings: Scoring[]; tokens: number }> {
  if (!events.length) return { scorings: [], tokens: 0 };

  const areas = settings.focus_areas.map((f) => `- ${f.name}`).join('\n');
  const list = events
    .map((e, i) =>
      [
        `${i + 1}.`,
        `title: ${e.title}`,
        `city: ${e.city ?? 'not stated'}`,
        `organiser: ${e.organiser ?? 'not stated'}`,
        `audience: ${e.audience_tag ?? 'not stated'}`,
        `summary: ${e.summary ?? 'not available'}`,
      ].join('\n   ')
    )
    .join('\n\n');

  const input = `Score how well each event fits these focus areas.

Focus areas:
${areas}

Events:
${list}

Return ONLY a JSON array, one object per event:
[{"index": 1, "score": 0-5, "reason": "one line, under 18 words",
  "focus_area": "the focus area it fits best, copied EXACTLY from the list above, or null"}]

Rules:
- score 5 = squarely about that focus area; 0 = unrelated to all of them.
- focus_area must be copied character for character from the list, or be null.
  Do not invent a focus area and do not reword one.
- reason states why it fits or does not. No selling language, no adjectives
  about quality. If it does not fit, say so plainly.
- Score every event. Never omit one, never add one.
- Return ONLY JSON.`;

  const res = await callGemini({ input });
  const parsed = extractJSON<Scoring[]>(res.text);
  const arr = Array.isArray(parsed) ? parsed : [];
  const names = new Set(settings.focus_areas.map((f) => f.name));
  return {
    scorings: arr.map((s) => ({
      index: Number(s?.index),
      score: clamp(s?.score),
      reason: nonEmpty(s?.reason) ?? '',
      // a focus area the model invented is discarded, not trusted
      focus_area: typeof s?.focus_area === 'string' && names.has(s.focus_area) ? s.focus_area : null,
    })),
    tokens: res.tokens,
  };
}

// --------------------------------------------------------------------------

function clamp(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : 0;
}
function nonEmpty(s: unknown): string | null {
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}
function validFormat(f: unknown): EventFormat | null {
  return f === 'in-person' || f === 'hybrid' || f === 'online' ? f : null;
}
/** Keep the summary to two sentences, as promised in the UI. */
function twoSentences(s: unknown): string | null {
  const t = nonEmpty(s);
  if (!t) return null;
  const parts = t.match(/[^.!?]+[.!?]+/g);
  if (!parts || parts.length <= 2) return t;
  return parts.slice(0, 2).join(' ').trim();
}
function cleanExtracted(e: ExtractedEvent): ExtractedEvent {
  return {
    title: typeof e?.title === 'string' ? e.title.trim() : '',
    start_date: isISODate(e?.start_date) ? e.start_date! : null,
    end_date: isISODate(e?.end_date) ? e.end_date! : null,
    city: nonEmpty(e?.city),
    venue: nonEmpty(e?.venue),
    format: validFormat(e?.format),
    registration_deadline: isISODate(e?.registration_deadline) ? e.registration_deadline! : null,
    organiser: nonEmpty(e?.organiser),
    audience_tag: nonEmpty(e?.audience_tag),
    event_url: nonEmpty(e?.event_url),
  };
}
