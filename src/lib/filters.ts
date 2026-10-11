/**
 * Hard filters. Plain code, pass/fail, never the model.
 *
 * Every drop is recorded with a reason so the dashboard can say WHY the digest
 * is short instead of silently showing nothing. "Never fail silently" applies
 * to filtering as much as to fetching.
 */

import { CITY_ALIASES } from '@/config';
import type { ScoutEvent, Settings } from './types';
import { daysBetween, isISODate, todayISO } from './dates';

export type DropReason =
  | 'purely online'
  | 'no date stated'
  | 'event already passed'
  | 'beyond the window'
  | 'registration already closed'
  | 'city not in settings'
  | 'source link did not resolve';

export interface FilterResult {
  kept: ScoutEvent[];
  dropped: { event: ScoutEvent; reason: DropReason }[];
}

export function normaliseCity(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does a page's city string match one of the configured cities?
 * Handles "Bangalore", "Bengaluru, India", "Navi Mumbai", "Secunderabad".
 */
export function matchCity(raw: string | null, configured: string[]): string | null {
  if (!raw) return null;
  const hay = normaliseCity(raw);
  if (!hay) return null;

  for (const city of configured) {
    const key = normaliseCity(city);
    const aliases = CITY_ALIASES[key] ?? [key];
    for (const alias of aliases) {
      // word-boundary match so "Mumbai" doesn't match inside another word
      const re = new RegExp(`(^|\\s)${alias.replace(/\s+/g, '\\s+')}(\\s|$)`);
      if (re.test(hay)) return city;
    }
  }
  return null;
}

export interface FilterOpts {
  /**
   * Pass 1 of the pipeline runs before we have read each event's own page, so
   * a city the listing did not state is not yet knowable. Keeping those events
   * alive for one more stage avoids throwing away real events, and avoids
   * paying Gemini to enrich events we were going to drop anyway.
   */
  allowUnknownCity?: boolean;
}

export function hardFilter(
  events: ScoutEvent[],
  settings: Settings,
  today: string = todayISO(),
  opts: FilterOpts = {}
): FilterResult {
  const kept: ScoutEvent[] = [];
  const dropped: { event: ScoutEvent; reason: DropReason }[] = [];
  const drop = (event: ScoutEvent, reason: DropReason) => dropped.push({ event, reason });

  for (const ev of events) {
    // A link we could not resolve means we cannot show the event at all.
    if (ev.link_ok === false) { drop(ev, 'source link did not resolve'); continue; }

    // In-person or hybrid only. PURELY online is excluded; an unstated format
    // is not a reason to drop, because the brief only excludes "purely online".
    if (ev.format === 'online') { drop(ev, 'purely online'); continue; }

    if (!isISODate(ev.start_date)) { drop(ev, 'no date stated'); continue; }

    const daysToEvent = daysBetween(today, ev.start_date);
    if (daysToEvent === null) { drop(ev, 'no date stated'); continue; }
    if (daysToEvent < 0) { drop(ev, 'event already passed'); continue; }
    if (daysToEvent > settings.window_days) { drop(ev, 'beyond the window'); continue; }

    // Registration still open. Unknown deadline is ALLOWED and shown as unknown.
    if (isISODate(ev.registration_deadline)) {
      const d = daysBetween(today, ev.registration_deadline);
      if (d !== null && d < 0) { drop(ev, 'registration already closed'); continue; }
    }

    const city = matchCity(ev.city, settings.cities);
    if (!city) {
      if (opts.allowUnknownCity && !ev.city) { kept.push(ev); continue; }
      drop(ev, 'city not in settings');
      continue;
    }

    // normalise the city to the configured spelling for consistent display
    kept.push({ ...ev, city });
  }

  return { kept, dropped };
}

/** Counts by reason, for the dashboard's "why is this short" line. */
export function dropSummary(dropped: FilterResult['dropped']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dropped) out[d.reason] = (out[d.reason] ?? 0) + 1;
  return out;
}
