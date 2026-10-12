/**
 * Every database access in the system. Raw SQL, no ORM, so what runs is what
 * you can read here.
 *
 * Neon's HTTP driver: one round trip per query, no connection to keep warm,
 * which is what a serverless function wants.
 */

import { neon, types } from '@neondatabase/serverless';
import { DEFAULT_CITIES, DEFAULT_FOCUS_AREAS, DEFAULT_WINDOW_DAYS, DAILY_SEND_CAP } from '@/config';
import type { ScoutEvent, Settings, SourceRun } from './types';
import { pgDateToISO } from './dates';

/**
 * Postgres DATE (oid 1082) must come back as a plain 'yyyy-mm-dd' string.
 * Left to itself the driver builds a JS Date at LOCAL midnight, which in IST
 * is 18:30 UTC the previous day — and every date in the system silently
 * shifts back one. Belt and braces: pgDateToISO() also handles a Date safely.
 */
types.setTypeParser(1082, (v: string) => v);

let _sql: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = neon(url);
  }
  return _sql;
}

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

type Row = Record<string, unknown>;
const q = async (text: string, params: unknown[] = []): Promise<Row[]> =>
  (await sql().query(text, params)) as Row[];

const asDate = pgDateToISO;
const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<Settings> {
  const rows = await q('SELECT * FROM settings WHERE id = 1');
  const r = rows[0];
  if (!r) {
    return {
      cities: DEFAULT_CITIES,
      focus_areas: DEFAULT_FOCUS_AREAS,
      extra_sources: [],
      recipient: process.env.DIGEST_RECIPIENT ?? '',
      window_days: DEFAULT_WINDOW_DAYS,
    };
  }
  return {
    cities: (r.cities as string[]) ?? DEFAULT_CITIES,
    focus_areas: (r.focus_areas as Settings['focus_areas']) ?? DEFAULT_FOCUS_AREAS,
    extra_sources: (r.extra_sources as Settings['extra_sources']) ?? [],
    recipient: (r.recipient as string) || (process.env.DIGEST_RECIPIENT ?? ''),
    window_days: Number(r.window_days ?? DEFAULT_WINDOW_DAYS),
  };
}

export async function getSettingsUpdatedAt(): Promise<string | null> {
  const rows = await q('SELECT updated_at FROM settings WHERE id = 1');
  return rows[0]?.updated_at ? new Date(String(rows[0].updated_at)).toISOString() : null;
}

export async function saveSettings(s: Settings): Promise<void> {
  await q(
    `UPDATE settings
        SET cities = $1, focus_areas = $2::jsonb, extra_sources = $3::jsonb,
            recipient = $4, window_days = $5, updated_at = now()
      WHERE id = 1`,
    [s.cities, JSON.stringify(s.focus_areas), JSON.stringify(s.extra_sources), s.recipient, s.window_days]
  );
}

// ---------------------------------------------------------------------- runs

export async function createRun(kind: 'monday_auto' | 'test_send'): Promise<number> {
  const rows = await q('INSERT INTO runs (kind) VALUES ($1) RETURNING id', [kind]);
  return Number(rows[0].id);
}

export async function updateRun(
  id: number,
  patch: { stage?: string; status?: string; error?: string | null; stats?: unknown }
): Promise<void> {
  await q(
    `UPDATE runs
        SET stage = COALESCE($2, stage),
            status = COALESCE($3, status),
            error = COALESCE($4, error),
            stats = COALESCE($5::jsonb, stats),
            updated_at = now()
      WHERE id = $1`,
    [id, patch.stage ?? null, patch.status ?? null, patch.error ?? null,
     patch.stats === undefined ? null : JSON.stringify(patch.stats)]
  );
}

export async function latestRun(): Promise<Row | null> {
  const rows = await q('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1');
  return rows[0] ?? null;
}

// -------------------------------------------------------------------- events

function rowToEvent(r: Row): ScoutEvent {
  return {
    id: Number(r.id),
    fingerprint: String(r.fingerprint),
    source: String(r.source),
    source_url: String(r.source_url),
    title: String(r.title),
    start_date: asDate(r.start_date),
    end_date: asDate(r.end_date),
    city: asStr(r.city),
    venue: asStr(r.venue),
    format: (asStr(r.format) as ScoutEvent['format']) ?? null,
    registration_deadline: asDate(r.registration_deadline),
    organiser: asStr(r.organiser),
    audience_tag: asStr(r.audience_tag),
    summary: asStr(r.summary),
    score: asNum(r.score),
    reason: asStr(r.reason),
    focus_area: asStr(r.focus_area),
    rank_value: asNum(r.rank_value) ?? undefined,
    link_ok: r.link_ok === null || r.link_ok === undefined ? undefined : Boolean(r.link_ok),
    link_status: asNum(r.link_status),
    first_seen: r.first_seen ? new Date(String(r.first_seen)).toISOString() : undefined,
  };
}

/**
 * Insert or refresh events by fingerprint.
 * first_seen is never overwritten — it is what makes an event "new" in a
 * digest, and an event re-found next Monday must not look new again.
 * Returns the ids of rows that were inserted for the first time.
 */
export async function upsertEvents(events: ScoutEvent[], runId: number): Promise<Set<string>> {
  const freshlyInserted = new Set<string>();
  for (const e of events) {
    const rows = await q(
      `INSERT INTO events (
         fingerprint, run_id, source, source_url, title, start_date, end_date,
         city, venue, format, registration_deadline, organiser, audience_tag,
         summary, score, reason, focus_area, rank_value, link_ok, link_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (fingerprint) DO UPDATE SET
         run_id = EXCLUDED.run_id,
         source = EXCLUDED.source,
         source_url = EXCLUDED.source_url,
         title = EXCLUDED.title,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         city = EXCLUDED.city,
         venue = EXCLUDED.venue,
         format = EXCLUDED.format,
         -- a deadline is only ever added, never erased by a source that omits it
         registration_deadline = COALESCE(EXCLUDED.registration_deadline, events.registration_deadline),
         organiser = EXCLUDED.organiser,
         audience_tag = COALESCE(EXCLUDED.audience_tag, events.audience_tag),
         summary = COALESCE(EXCLUDED.summary, events.summary),
         -- A scoring pass that failed returns nothing, and must not erase a
         -- good score from a previous run. A real new score, 0 included,
         -- still overwrites; only NULL (meaning "not scored this time")
         -- leaves the old value alone. Without this a Gemini outage silently
         -- degrades the digest to an unranked list, which is what happened
         -- on the first production run.
         score = COALESCE(EXCLUDED.score, events.score),
         reason = COALESCE(EXCLUDED.reason, events.reason),
         focus_area = COALESCE(EXCLUDED.focus_area, events.focus_area),
         rank_value = COALESCE(EXCLUDED.rank_value, events.rank_value),
         link_ok = EXCLUDED.link_ok,
         link_status = EXCLUDED.link_status,
         last_seen = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        e.fingerprint, runId, e.source, e.source_url, e.title, e.start_date, e.end_date,
        e.city, e.venue, e.format, e.registration_deadline, e.organiser, e.audience_tag,
        e.summary, e.score ?? null, e.reason ?? null, e.focus_area ?? null,
        e.rank_value ?? null, e.link_ok ?? null, e.link_status ?? null,
      ]
    );
    if (rows[0]?.inserted) freshlyInserted.add(String(e.fingerprint));
  }
  return freshlyInserted;
}

/** Events found by a given run, ranked. */
export async function eventsForRun(runId: number): Promise<ScoutEvent[]> {
  const rows = await q(
    'SELECT * FROM events WHERE run_id = $1 ORDER BY rank_value DESC NULLS LAST, start_date ASC',
    [runId]
  );
  return rows.map(rowToEvent);
}

/** Everything still ahead of us, ranked. Powers the dashboard list. */
export async function upcomingEvents(limit = 60): Promise<ScoutEvent[]> {
  const rows = await q(
    `SELECT * FROM events
      WHERE link_ok IS NOT FALSE
        AND start_date >= CURRENT_DATE
      ORDER BY rank_value DESC NULLS LAST, start_date ASC
      LIMIT $1`,
    [limit]
  );
  return rows.map(rowToEvent);
}

// ----------------------------------------------------------- calendar clicks

/**
 * "Add to calendar" was clicked. An interest signal, nothing more.
 * This is never rendered as "registered" — the system cannot know that.
 */
export async function recordCalendarClick(eventId: number): Promise<void> {
  await q('INSERT INTO calendar_clicks (event_id) VALUES ($1)', [eventId]);
}

export async function getEvent(id: number): Promise<ScoutEvent | null> {
  const rows = await q('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0] ? rowToEvent(rows[0]) : null;
}

/**
 * Events on the calendar that have not expired yet. These ride in every
 * Monday email, outside the 15 cap, until their deadline passes — or, where
 * no deadline was ever stated, until the event date passes.
 */
export async function calendarEvents(): Promise<ScoutEvent[]> {
  const rows = await q(
    `SELECT DISTINCT ON (e.id) e.*
       FROM events e
       JOIN calendar_clicks c ON c.event_id = e.id
      WHERE COALESCE(e.registration_deadline, e.start_date) >= CURRENT_DATE
      ORDER BY e.id, c.clicked_at DESC`
  );
  return rows
    .map(rowToEvent)
    .sort((a, b) => String(a.registration_deadline ?? a.start_date).localeCompare(String(b.registration_deadline ?? b.start_date)));
}

export async function clickedEventIds(): Promise<Set<number>> {
  const rows = await q('SELECT DISTINCT event_id FROM calendar_clicks');
  return new Set(rows.map((r) => Number(r.event_id)));
}

// ------------------------------------------------------------- source status

export async function recordSourceRuns(runId: number, runs: SourceRun[]): Promise<void> {
  for (const s of runs) {
    await q(
      'INSERT INTO source_runs (run_id, source, ok, error, found) VALUES ($1,$2,$3,$4,$5)',
      [runId, s.source, s.ok, s.error, s.found]
    );
  }
}

export async function latestSourceRuns(): Promise<SourceRun[]> {
  const rows = await q(
    `SELECT source, ok, error, found, ran_at
       FROM source_runs
      WHERE run_id = (SELECT max(run_id) FROM source_runs)
      ORDER BY id`
  );
  return rows.map((r) => ({
    source: String(r.source),
    ok: Boolean(r.ok),
    error: asStr(r.error),
    found: Number(r.found),
    ran_at: new Date(String(r.ran_at)).toISOString(),
  }));
}

// ------------------------------------------------------------------- digests

export async function insertDigest(d: {
  runId: number | null;
  kind: 'monday_auto' | 'test_send';
  recipient: string;
  subject: string;
  newCount: number;
  calendarCount: number;
  closingCount: number;
  html: string;
}): Promise<number> {
  const rows = await q(
    `INSERT INTO digests (run_id, kind, recipient, subject, new_count, calendar_count, closing_count, html)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [d.runId, d.kind, d.recipient, d.subject, d.newCount, d.calendarCount, d.closingCount, d.html]
  );
  return Number(rows[0].id);
}

export async function listDigests(limit = 40) {
  const rows = await q(
    `SELECT id, sent_at, kind, recipient, subject, new_count, calendar_count, closing_count
       FROM digests ORDER BY sent_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    sent_at: new Date(String(r.sent_at)).toISOString(),
    kind: String(r.kind) as 'monday_auto' | 'test_send',
    recipient: String(r.recipient),
    subject: String(r.subject),
    new_count: Number(r.new_count),
    calendar_count: Number(r.calendar_count),
    closing_count: Number(r.closing_count),
  }));
}

/** The HTTP driver returns bytea as the Postgres hex string "\x89504e...". */
function byteaToBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  const s = String(raw);
  // String.raw avoids an escaped-backslash literal, which is easy to mangle
  return Buffer.from(s.startsWith(String.raw`\x`) ? s.slice(2) : s, 'hex');
}

export async function saveDigestAudio(
  id: number,
  audio: Buffer,
  script: string,
  seconds: number
): Promise<void> {
  await q('UPDATE digests SET audio = $2, audio_script = $3, audio_seconds = $4 WHERE id = $1',
    [id, audio, script, seconds]);
}

export async function getDigestAudio(
  id: number
): Promise<{ audio: Buffer; script: string; seconds: number } | null> {
  const rows = await q('SELECT audio, audio_script, audio_seconds FROM digests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r?.audio) return null;
  const raw = r.audio as unknown;
  // The HTTP driver returns bytea as the Postgres hex string "\x89504e..."
  const audio = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(String(raw).replace(/^\\x/, ''), 'hex');
  return { audio, script: String(r.audio_script ?? ''), seconds: Number(r.audio_seconds ?? 0) };
}

export async function digestSummary(id: number) {
  const rows = await q('SELECT id, sent_at, subject, audio_seconds FROM digests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    sent_at: new Date(String(r.sent_at)).toISOString(),
    subject: String(r.subject),
    audio_seconds: r.audio_seconds === null || r.audio_seconds === undefined ? null : Number(r.audio_seconds),
  };
}

export async function digestHtml(id: number): Promise<{ html: string; subject: string } | null> {
  const rows = await q('SELECT html, subject FROM digests WHERE id = $1', [id]);
  return rows[0] ? { html: String(rows[0].html), subject: String(rows[0].subject) } : null;
}

// ------------------------------------------------------------------ send log

export async function logSend(entry: {
  kind: 'monday_auto' | 'test_send';
  result: 'sent' | 'error' | 'blocked';
  recipient?: string | null;
  messageId?: string | null;
  error?: string | null;
}): Promise<void> {
  await q(
    'INSERT INTO send_log (kind, result, recipient, message_id, error) VALUES ($1,$2,$3,$4,$5)',
    [entry.kind, entry.result, entry.recipient ?? null, entry.messageId ?? null, entry.error ?? null]
  );
}

/**
 * How many admin test sends have gone out today, IST.
 *
 * Only successful test sends count. The Monday auto-send does not consume one
 * of the 10 and is never blocked by the cap (components map note 2).
 */
export async function testSendsToday(): Promise<number> {
  const rows = await q(
    `SELECT count(*)::int AS n FROM send_log
      WHERE kind = 'test_send' AND result = 'sent'
        AND (at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`
  );
  return Number(rows[0]?.n ?? 0);
}

export async function sendCapRemaining(): Promise<number> {
  return Math.max(0, DAILY_SEND_CAP - (await testSendsToday()));
}

export async function recentSends(limit = 15) {
  const rows = await q(
    'SELECT at, kind, result, recipient, message_id, error FROM send_log ORDER BY at DESC LIMIT $1',
    [limit]
  );
  return rows.map((r) => ({
    at: new Date(String(r.at)).toISOString(),
    kind: String(r.kind),
    result: String(r.result),
    recipient: asStr(r.recipient),
    message_id: asStr(r.message_id),
    error: asStr(r.error),
  }));
}

// ------------------------------------------------------------------- charts

/** Weekly activity for the dashboard charts. Real rows, never sample data. */
export async function weeklyActivity(weeks = 4) {
  const found = await q(
    `SELECT to_char(date_trunc('week', first_seen AT TIME ZONE 'Asia/Kolkata'), 'DD Mon') AS wk,
            date_trunc('week', first_seen AT TIME ZONE 'Asia/Kolkata') AS ord,
            count(*)::int AS n
       FROM events GROUP BY 1,2 ORDER BY ord DESC LIMIT $1`,
    [weeks]
  );
  const added = await q(
    `SELECT to_char(date_trunc('week', clicked_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon') AS wk,
            date_trunc('week', clicked_at AT TIME ZONE 'Asia/Kolkata') AS ord,
            count(*)::int AS n
       FROM calendar_clicks GROUP BY 1,2 ORDER BY ord DESC LIMIT $1`,
    [weeks]
  );
  const sent = await q(
    `SELECT to_char(date_trunc('week', sent_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon') AS wk,
            date_trunc('week', sent_at AT TIME ZONE 'Asia/Kolkata') AS ord,
            count(*)::int AS n
       FROM digests GROUP BY 1,2 ORDER BY ord DESC LIMIT $1`,
    [weeks]
  );
  const shape = (rows: Row[]) =>
    rows.reverse().map((r) => ({ label: String(r.wk), value: Number(r.n) }));
  return { found: shape(found), added: shape(added), sent: shape(sent) };
}

/** This week's split by city and by focus area. */
export async function splits() {
  const byCity = await q(
    `SELECT city AS label, count(*)::int AS n FROM events
      WHERE start_date >= CURRENT_DATE AND city IS NOT NULL
      GROUP BY city ORDER BY n DESC`
  );
  const byFocus = await q(
    `SELECT COALESCE(focus_area, 'No focus area matched') AS label, count(*)::int AS n
       FROM events WHERE start_date >= CURRENT_DATE
      GROUP BY 1 ORDER BY n DESC`
  );
  const shape = (rows: Row[]) => rows.map((r) => ({ label: String(r.label), value: Number(r.n) }));
  return { byCity: shape(byCity), byFocus: shape(byFocus) };
}

/**
 * Enrichment we already have, keyed by source_url.
 *
 * The brief: "cache extractions by source URL so unchanged pages are not
 * re-processed". Enrichment is the expensive stage — one url_context call per
 * handful of events, ~45s a batch — so skipping pages we have already read is
 * what keeps the Monday run inside Vercel's 300s ceiling from week two on.
 */
export async function existingEnrichment(
  urls: string[]
): Promise<Map<string, { summary: string | null; audience_tag: string | null; registration_deadline: string | null }>> {
  const out = new Map<string, { summary: string | null; audience_tag: string | null; registration_deadline: string | null }>();
  if (!urls.length) return out;
  const rows = await q(
    `SELECT source_url, summary, audience_tag, registration_deadline
       FROM events WHERE source_url = ANY($1) AND summary IS NOT NULL`,
    [urls]
  );
  for (const r of rows) {
    out.set(String(r.source_url), {
      summary: asStr(r.summary),
      audience_tag: asStr(r.audience_tag),
      registration_deadline: asDate(r.registration_deadline),
    });
  }
  return out;
}

export async function updateDigestHtml(id: number, html: string): Promise<void> {
  await q('UPDATE digests SET html = $2 WHERE id = $1', [id, html]);
}

/** Used only to clean up a digest row whose send then failed. */
export async function deleteDigest(id: number): Promise<void> {
  await q('DELETE FROM digests WHERE id = $1', [id]);
}

/**
 * Audio we have already synthesised for this exact script.
 *
 * The admin button re-sends the same digest, so ten grader presses would be
 * ten TTS calls saying one identical sentence. TTS is the most tightly
 * rate-limited model we use, so the clip is reused whenever the words have
 * not changed — the same principle as caching extractions by source URL.
 */
export async function findAudioByScript(
  script: string
): Promise<{ wav: Buffer; seconds: number } | null> {
  const rows = await q(
    `SELECT audio, audio_seconds FROM digests
      WHERE audio_script = $1 AND audio IS NOT NULL
      ORDER BY sent_at DESC LIMIT 1`,
    [script]
  );
  const r = rows[0];
  if (!r?.audio) return null;
  // same shape as tts.synthesise(), so callers can use either interchangeably
  return { wav: byteaToBuffer(r.audio), seconds: Number(r.audio_seconds ?? 0) };
}
