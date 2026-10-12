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
    .map((ev) => ({ ...ev, rank_value: rankValue(ev, settings) }))
    .sort((a, b) => {
      const ua = urgentAndRelevant(a, today) ? 1 : 0;
      const ub = urgentAndRelevant(b, today) ? 1 : 0;
      if (ua !== ub) return ub - ua;
      if (b.rank_value! !== a.rank_value!) return b.rank_value! - a.rank_value!;
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

/** Stable identity for an event, used for dedup and for "have we seen this?". */
export function fingerprint(ev: ScoutEvent): string {
  const title = ev.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${title}|${ev.start_date ?? 'nodate'}`;
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
 * Merge duplicates into one event. The richest record wins the shape; any
 * field it is missing is filled from a sibling that has it, so a stated
 * registration deadline is never lost just because another source omitted it.
 */
export function mergeDuplicates(events: ScoutEvent[]): ScoutEvent[] {
  const groups = new Map<string, ScoutEvent[]>();
  for (const ev of events) {
    const fp = fingerprint(ev);
    const g = groups.get(fp);
    if (g) g.push(ev);
    else groups.set(fp, [ev]);
  }

  const out: ScoutEvent[] = [];
  for (const [fp, group] of groups) {
    const sorted = [...group].sort((a, b) => completeness(b) - completeness(a));
    const base: ScoutEvent = { ...sorted[0], fingerprint: fp };

    for (const other of sorted.slice(1)) {
      for (const k of Object.keys(other) as (keyof ScoutEvent)[]) {
        if (base[k] === null || base[k] === undefined || base[k] === '') {
          (base as unknown as Record<string, unknown>)[k] = other[k];
        }
      }
    }
    // record every source that saw it, so the digest can say "via X and Y"
    const sources = [...new Set(group.map((e) => e.source))];
    base.source = sources.join(', ');
    out.push(base);
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
