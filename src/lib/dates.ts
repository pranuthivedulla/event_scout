/**
 * All date arithmetic lives here, in plain code.
 *
 * The brief forbids using Gemini for date arithmetic, the 7-day flag or the cap.
 * Storage is UTC; display is Asia/Kolkata. A date-only value (yyyy-mm-dd) is
 * treated as a calendar day, never as a timestamp, so no amount of timezone
 * shifting can move an event a day.
 */

import { DISPLAY_TZ, URGENCY_DAYS } from '@/config';
import type { ScoutEvent, Urgency } from './types';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // rejects 2026-02-30 and friends
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** yyyy-mm-dd -> epoch ms at UTC midnight. Returns null for anything invalid. */
export function toUTCDay(iso: string | null | undefined): number | null {
  if (!isISODate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `from` to `to`. Negative means `to` is in the past. */
export function daysBetween(from: string, to: string): number | null {
  const a = toUTCDay(from);
  const b = toUTCDay(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

/** Today's calendar date in the display timezone, as yyyy-mm-dd. */
export function todayISO(now: Date = new Date()): string {
  // en-CA gives yyyy-mm-dd directly
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(iso: string, n: number): string | null {
  const base = toUTCDay(iso);
  if (base === null) return null;
  return new Date(base + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Tue 20 Oct" — compact, unambiguous, no year unless it differs from today's. */
export function formatDay(iso: string | null, today: string = todayISO()): string {
  if (!isISODate(iso)) return 'Date not stated';
  const ms = toUTCDay(iso)!;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(ms));
}

/** "Tue 20 Oct" or "Tue 20 - Wed 21 Oct" for a multi-day event. */
export function formatRange(
  start: string | null,
  end: string | null,
  today: string = todayISO()
): string {
  if (!isISODate(start)) return 'Date not stated';
  if (!isISODate(end) || end === start) return formatDay(start, today);
  return `${formatDay(start, today)} - ${formatDay(end, today)}`;
}

/**
 * The red badge.
 *
 * If a source actually stated a registration deadline, the badge counts down to
 * THAT and says "Closes in N days". If none was stated — which fifteen sites
 * said is the normal case — it counts down to the EVENT and says "Event in N
 * days". The system never claims a registration closes on a date nobody stated.
 */
export function urgency(ev: ScoutEvent, today: string = todayISO()): Urgency {
  const hasDeadline = isISODate(ev.registration_deadline);

  if (hasDeadline) {
    const days = daysBetween(today, ev.registration_deadline!);
    if (days === null) return { kind: 'none', days: null, flagged: false, badge: null, line: 'Deadline unknown' };
    const line = `Registration closes ${formatDay(ev.registration_deadline, today)}`;
    if (days < 0) return { kind: 'deadline', days, flagged: false, badge: null, line: `Registration closed ${formatDay(ev.registration_deadline, today)}` };
    if (days < URGENCY_DAYS) {
      const badge = days === 0 ? 'Closes today' : days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`;
      return { kind: 'deadline', days, flagged: true, badge, line };
    }
    return { kind: 'deadline', days, flagged: false, badge: null, line };
  }

  // No stated deadline anywhere. Fall back to the event date, and say so.
  const days = isISODate(ev.start_date) ? daysBetween(today, ev.start_date!) : null;
  if (days === null) return { kind: 'none', days: null, flagged: false, badge: null, line: 'Deadline unknown' };
  if (days < 0) return { kind: 'event-date', days, flagged: false, badge: null, line: 'Deadline unknown' };
  if (days < URGENCY_DAYS) {
    const badge = days === 0 ? 'Event today' : days === 1 ? 'Event tomorrow' : `Event in ${days} days`;
    return { kind: 'event-date', days, flagged: true, badge, line: 'Deadline unknown' };
  }
  return { kind: 'event-date', days, flagged: false, badge: null, line: 'Deadline unknown' };
}

/**
 * The date the "Add to calendar" entry lands on.
 * Stated deadline if there is one, otherwise the event date — and the caller
 * must label it accordingly. Never invents a date.
 */
export function calendarDate(ev: ScoutEvent): { date: string | null; basis: 'deadline' | 'event' | 'none' } {
  if (isISODate(ev.registration_deadline)) return { date: ev.registration_deadline, basis: 'deadline' };
  if (isISODate(ev.start_date)) return { date: ev.start_date, basis: 'event' };
  return { date: null, basis: 'none' };
}

/**
 * Pre-filled Google Calendar link. No Google Calendar API, no OAuth —
 * a plain template URL, per the brief.
 */
export function googleCalendarUrl(ev: ScoutEvent): string | null {
  const { date, basis } = calendarDate(ev);
  if (!date) return null;
  const compact = date.replace(/-/g, '');
  const next = addDays(date, 1)!.replace(/-/g, '');

  const title =
    basis === 'deadline'
      ? `Register by today: ${ev.title}`
      : `${ev.title}`;

  const detail = [
    basis === 'deadline'
      ? `Registration closes today for this event.`
      : `Registration deadline not stated by the source. This entry is on the event date.`,
    ev.start_date ? `Event date: ${formatRange(ev.start_date, ev.end_date)}` : null,
    ev.city ? `City: ${ev.city}` : null,
    ev.organiser ? `Organiser: ${ev.organiser}` : null,
    ``,
    `Register: ${ev.source_url}`,
    ``,
    `Added from Event Scout. You decide whether to register, on the organiser's page.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compact}/${next}`,
    details: detail,
    ...(ev.city ? { location: ev.city } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
