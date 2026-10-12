/**
 * LinkedIn events via Apify.
 *
 * The brief calls this the least reliable input, and spike 9 bore that out:
 * `maximedupre/linkedin-events` runs cleanly (HTTP 201) and returns zero items
 * for every query tried, including the broadest possible one with no city, no
 * format and no timing filter. A second actor, `memo23/linkedin-events-scraper`,
 * timed out at 150s on two consecutive attempts.
 *
 * So this source is wired for real — it calls Apify, maps whatever comes back,
 * and reports its own outcome into the digest's source-status line — but it is
 * NOT depended on. Today it contributes nothing, and the digest says so rather
 * than hiding it.
 *
 * The field mapping below follows the actor's published output schema. It has
 * not been exercised against live output, because there has been none.
 */

import type { EventFormat, ScoutEvent, Settings } from '../types';
import { isISODate } from '../dates';
import { toDisplayDate } from './luma';

/** Apify actor, overridable without a code change if a better one appears. */
const ACTOR = process.env.APIFY_ACTOR ?? 'maximedupre~linkedin-events';

/** Never let a scraper run long enough to threaten the Monday run's budget. */
const TIMEOUT_S = 60;
/** Hard cap on billable events per run. */
const MAX_ITEMS = 60;

interface ApifyEvent {
  eventId?: string | null;
  eventUrl?: string | null;
  title?: string | null;
  description?: string | null;
  scheduleText?: string | null;
  format?: string | null;
  organizer?: { name?: string | null } | null;
  location?: { text?: string | null; name?: string | null; city?: string | null } | null;
  registrationUrls?: string[] | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Pull a calendar date out of LinkedIn's free-text schedule line.
 *
 * Plain code, never a model: the brief forbids using Gemini for date work, and
 * a guessed date is worse than no date. Anything this cannot read with
 * certainty returns null, and the event is then dropped by the hard filter
 * with the reason "no date stated" rather than shown with an invented day.
 */
export function parseScheduleText(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim();

  // A full ISO timestamp carries a timezone, so it has to be converted to the
  // display timezone rather than sliced: 2026-10-24T18:30:00Z is already the
  // 25th in IST. A bare yyyy-mm-dd is a calendar day and is taken as written.
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(s)) {
    const converted = toDisplayDate(s);
    if (converted) return converted;
  }
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso && isISODate(iso[1])) return iso[1];

  // "Oct 24, 2026" / "October 24 2026" / "Oct 24"
  const mdy = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,)?\s*(\d{4})?\b/);
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (m) {
      const d = Number(mdy[2]);
      const y = mdy[3] ? Number(mdy[3]) : new Date().getUTCFullYear();
      const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (isISODate(out)) return out;
    }
  }

  // "24 Oct 2026" / "24 October"
  const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(\d{4})?\b/);
  if (dmy) {
    const m = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (m) {
      const d = Number(dmy[1]);
      const y = dmy[3] ? Number(dmy[3]) : new Date().getUTCFullYear();
      const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (isISODate(out)) return out;
    }
  }

  return null;
}

function toFormat(f: string | null | undefined): EventFormat | null {
  const s = String(f ?? '').toLowerCase();
  if (s.includes('inperson') || s.includes('in_person') || s.includes('in person')) return 'in-person';
  if (s.includes('hybrid')) return 'hybrid';
  if (s.includes('virtual') || s.includes('online')) return 'online';
  return null;
}

export async function fetchApify(
  sourceKey: string,
  settings: Settings
): Promise<ScoutEvent[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('not configured');

  const input = {
    target: 'discover',
    // the focus areas drive what we look for, same as everywhere else
    searchQuery: settings.focus_areas.map((f) => f.name).join(' ') || 'banking fintech',
    cities: settings.cities,
    eventTiming: 'upcoming',
    eventFormat: 'any', // our own filter excludes purely online; theirs is coarser
    searchMarket: 'auto',
  };

  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&maxItems=${MAX_ITEMS}&timeout=${TIMEOUT_S}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((TIMEOUT_S + 15) * 1000),
    });
  } catch {
    // the token is in the URL, so never let a fetch error carry it upward
    throw new Error('Apify did not respond in time');
  }

  if (!res.ok) throw new Error(`Apify returned ${res.status}`);

  const items = (await res.json()) as ApifyEvent[];
  if (!Array.isArray(items)) throw new Error('Apify returned an unexpected shape');

  const out: ScoutEvent[] = [];
  for (const it of items) {
    // An actor row that reports its own failure is not an event.
    if (!it?.title || !it?.eventUrl) continue;

    out.push({
      source: sourceKey,
      // Register goes to the organiser's own registration link when LinkedIn
      // gives one, and to the LinkedIn event page otherwise.
      source_url: it.registrationUrls?.[0] ?? it.eventUrl,
      title: String(it.title).trim(),
      start_date: parseScheduleText(it.scheduleText),
      end_date: null,
      city: it.location?.city ?? it.location?.text ?? null,
      venue: it.location?.name ?? null,
      format: toFormat(it.format),
      // LinkedIn states no registration deadline, like every other source.
      registration_deadline: null,
      organiser: it.organizer?.name ?? null,
      audience_tag: null,
      summary: null,
    });
  }
  return out;
}
