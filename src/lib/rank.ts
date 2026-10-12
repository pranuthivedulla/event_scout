/**
 * Ranking, duplicate merging and the cap. Plain code.
 *
 * Gemini supplies a 0-5 fit score and a one-line reason per event. It does not
 * sort, it does not apply the cap, and it never decides what gets dropped.
 * Focus areas RANK events; they never filter one out, so an event whose focus
 * area matches nothing still appears — at the bottom.
 */

import { LEVEL_WEIGHT, MAX_NEW_EVENTS, type FocusLevel } from '@/config';
import type { ScoutEvent, Settings } from './types';
import { toUTCDay, urgency, todayISO } from './dates';
import { normaliseCity } from './filters';

/** Which configured focus area did Gemini say this matched, and at what level? */
export function levelFor(ev: ScoutEvent, settings: Settings): FocusLevel | null {
  if (!ev.focus_area) return null;
  const want = ev.focus_area.trim().toLowerCase();
  const hit = settings.focus_areas.find((f) => f.name.trim().toLowerCase() === want);
  return hit ? hit.level : null;
}

/**
 * Deterministic rank value: fit score multiplied by the focus-area weight.
 *
 * It was `weight * 10 + score` — level dominating absolutely — until the first
 * live run put a 1/5 "NEAR x Quantus Happy Hour" (High area, barely relevant)
 * above a 5/5 ETBFSI Converge (Medium area, the single most relevant BFSI
 * conference found). Letting the level dominate means a token mention of
 * payments outranks a conference that is squarely Vikram's room.
 *
 * Multiplying keeps both signals live: a High area is worth 3x a Low one at
 * equal fit, but no amount of level weighting rescues an event the model
 * judged irrelevant. Ties fall back to the level, so at equal fit the
 * higher-priority focus area still wins.
 */
export function rankValue(ev: ScoutEvent, settings: Settings): number {
  const level = levelFor(ev, settings);
  const weight = level ? LEVEL_WEIGHT[level] : 0;
  const score = typeof ev.score === 'number' ? Math.max(0, Math.min(5, ev.score)) : 0;
  return score * 10 * weight + weight;
}

/**
 * Is this event urgent AND worth his time?
 *
 * The 7-day flag is the point of the digest, so a flagged event must not be
 * buried at number fourteen. But promoting EVERY flagged event would open the
 * digest on noise: with no source publishing deadlines the flag fires on
 * event-date proximity, and the soonest events are routinely the ones that
 * match no focus area. So urgency promotes an event only once it is relevant.
 * Urgent-but-unmatched events keep their place in the tail, visible as ever.
 */
export function urgentAndRelevant(ev: ScoutEvent, today: string): boolean {
  return (ev.score ?? 0) > 0 && urgency(ev, today).flagged;
}

/**
 * Sort: anything urgent and relevant first, then rank value desc, then soonest
 * event, then title for stability.
 *
 * City is NOT a ranking factor — Bengaluru, Mumbai and Hyderabad rank equally
 * (decided 20:57, nine-checks).
 */
export function rank(events: ScoutEvent[], settings: Settings, today: string = todayISO()): ScoutEvent[] {
  return events
    .map((ev) => ({
      ...ev,
      // Only events that were actually scored get a rank_value. An unscored
      // event would otherwise be written back as 0, overwriting a good value
      // from an earlier run — the same way a failed scoring pass used to
      // erase the score itself.
      rank_value: typeof ev.score === 'number' ? rankValue(ev, settings) : ev.rank_value,
    }))
    .sort((a, b) => {
      const ua = urgentAndRelevant(a, today) ? 1 : 0;
      const ub = urgentAndRelevant(b, today) ? 1 : 0;
      if (ua !== ub) return ub - ua;
      const ra = a.rank_value ?? 0;
      const rb = b.rank_value ?? 0;
      if (rb !== ra) return rb - ra;
      const da = toUTCDay(a.start_date) ?? Number.MAX_SAFE_INTEGER;
      const db = toUTCDay(b.start_date) ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title);
    });
}

/** Up to 15 NEW events. Carried-over calendar events are capped separately (they aren't). */
export function applyCap(events: ScoutEvent[], max: number = MAX_NEW_EVENTS): ScoutEvent[] {
  return events.slice(0, max);
}

// --------------------------------------------------------------------------
// Duplicate merging
// --------------------------------------------------------------------------

const NOISE = /\b(20\d\d|the|a|an|and|&|india|summit|conference|edition|\d+(st|nd|rd|th))\b/g;

/**
 * A title reduced to the part two platforms are likely to agree on.
 *
 * The same conference is rarely titled identically on two sites: one appends
 * the venue after a pipe, another brackets the city, a third adds "- Day 1".
 * Anything after a pipe or dash separator is dropped, as is a trailing
 * bracketed group, before the usual noise words go.
 *
 * Used ONLY for matching. The title shown to Vikram is never altered.
 */
export function normaliseTitle(title: string): string {
  return title
    .split(/\s[|–—-]\s/)[0]
    .replace(/\s*[([][^)\]]*[)\]]\s*$/g, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable identity for an event, used for dedup and for "have we seen this?". */
export function fingerprint(ev: ScoutEvent): string {
  return `${normaliseTitle(ev.title)}|${ev.start_date ?? 'nodate'}`;
}

/** Every source that contributed to a record, including after a merge. */
function sourcesOf(ev: ScoutEvent): string[] {
  return String(ev.source).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Whole days between two ISO dates, or null if either is missing. */
function dayGap(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = toUTCDay(a ?? null);
  const y = toUTCDay(b ?? null);
  if (x === null || y === null) return null;
  return Math.abs(Math.round((x - y) / 86_400_000));
}

/** How much do we actually know about this event? More is better when merging. */
function completeness(ev: ScoutEvent): number {
  const fields: (keyof ScoutEvent)[] = [
    'start_date', 'end_date', 'city', 'venue', 'format',
    'registration_deadline', 'organiser', 'audience_tag', 'summary',
  ];
  return fields.reduce((n, f) => n + (ev[f] ? 1 : 0), 0);
}

/**
 * Is this one real event listed twice?
 *
 * One predicate for both cases, because splitting it into an exact-match pass
 * and a cross-platform pass let contradictions through: the exact pass keyed
 * on title and date alone, so two different-city conferences sharing a title
 * and a date merged before any of the guards below could object.
 */
export function isDuplicate(a: ScoutEvent, b: ScoutEvent): boolean {
  const ta = normaliseTitle(a.title);
  if (!ta || ta !== normaliseTitle(b.title)) return false;

  // Two events in different cities are different events, whatever the title
  // says. Only applied when both sides actually state one.
  if (a.city && b.city && normaliseCity(a.city) !== normaliseCity(b.city)) return false;

  const sharesSource = sourcesOf(b).some((s) => new Set(sourcesOf(a)).has(s));
  const gap = dayGap(a.start_date, b.start_date);

  if (sharesSource) {
    // The same platform listing one title on two days is a recurring series,
    // not a duplicate. Only an exact date match counts.
    return gap === 0;
  }

  // A title that reduces to one short word is too generic to be an identity:
  // "Fintech Summit" normalises to "fintech", and two unrelated fintech
  // summits must not collapse into one.
  if (ta.split(' ').length < 2 && ta.length < 10) return false;

  // Across platforms the dates routinely disagree by a day, because sites
  // differ on timezones and on which day a multi-day conference starts, and
  // one side may carry no date at all.
  if (gap === null) return true;
  return gap <= 1;
}

/** Kept for the cross-platform case specifically; see isDuplicate. */
export function sameEventAcrossSources(a: ScoutEvent, b: ScoutEvent): boolean {
  const sharesSource = sourcesOf(b).some((s) => new Set(sourcesOf(a)).has(s));
  return !sharesSource && isDuplicate(a, b);
}

/**
 * Merge duplicates into one event, including the same conference listed on
 * two platforms under different titles or a day apart.
 *
 * The richest record wins the shape; any field it is missing is filled from a
 * sibling that has it, so a registration deadline or a summary held by only
 * one platform is never lost.
 */
export function mergeDuplicates(events: ScoutEvent[]): ScoutEvent[] {
  const out: ScoutEvent[] = [];

  for (const ev of events) {
    const match = out.find((kept) => isDuplicate(kept, ev));
    if (!match) {
      out.push({ ...ev, source: sourcesOf(ev).join(', '), fingerprint: fingerprint(ev) });
      continue;
    }

    const [rich, thin] = completeness(match) >= completeness(ev) ? [match, ev] : [ev, match];
    const merged: ScoutEvent = { ...rich };
    for (const k of Object.keys(thin) as (keyof ScoutEvent)[]) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') {
        (merged as unknown as Record<string, unknown>)[k] = thin[k];
      }
    }

    // prefer a real date over none, and the earlier of two that disagree
    const x = toUTCDay(match.start_date), y = toUTCDay(ev.start_date);
    if (x !== null && y !== null) merged.start_date = x <= y ? match.start_date : ev.start_date;
    else merged.start_date = match.start_date ?? ev.start_date;

    // credit every platform that listed it, so the digest can say "via X and Y"
    merged.source = [...new Set([...sourcesOf(match), ...sourcesOf(ev)])].join(', ');
    merged.fingerprint = fingerprint(merged);

    out[out.indexOf(match)] = merged;
  }

  return out;
}

/**
 * Re-sort already-stored events for display.
 *
 * rank_value is computed once, when the run scores the event, and saved. But
 * urgency changes every single day, so the order the email and the dashboard
 * show has to be worked out at render time, not read from the database.
 */
export function sortForDisplay(events: ScoutEvent[], today: string): ScoutEvent[] {
  return [...events].sort((a, b) => {
    const ua = urgentAndRelevant(a, today) ? 1 : 0;
    const ub = urgentAndRelevant(b, today) ? 1 : 0;
    if (ua !== ub) return ub - ua;
    const ra = a.rank_value ?? 0;
    const rb = b.rank_value ?? 0;
    if (rb !== ra) return rb - ra;
    const da = toUTCDay(a.start_date) ?? Number.MAX_SAFE_INTEGER;
    const db = toUTCDay(b.start_date) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });
}
