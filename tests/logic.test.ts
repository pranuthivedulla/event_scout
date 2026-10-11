/**
 * Tests for the plain-code core: dates, the flag, the hard filters, ranking,
 * the cap and duplicate merging.
 *
 * The brief: "tests on the filter and flag logic (these are plain code and must
 * be correct)". The single most important test in here is that the system never
 * says "registration closes" on a date no source stated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isISODate, daysBetween, addDays, urgency, calendarDate, googleCalendarUrl, formatRange } from '../src/lib/dates';
import { hardFilter, matchCity, dropSummary } from '../src/lib/filters';
import { rank, applyCap, rankValue, mergeDuplicates, fingerprint } from '../src/lib/rank';
import type { ScoutEvent, Settings } from '../src/lib/types';

const TODAY = '2026-10-12'; // a Monday

const settings: Settings = {
  cities: ['Bengaluru', 'Mumbai', 'Hyderabad'],
  focus_areas: [
    { name: 'Banking and core banking technology', level: 'High' },
    { name: 'Payments and digital payments', level: 'High' },
    { name: 'Fintech and BFSI at large', level: 'Medium' },
  ],
  extra_sources: [],
  recipient: 'vikram@example.com',
  window_days: 90,
};

const ev = (over: Partial<ScoutEvent> = {}): ScoutEvent => ({
  source: 'luma',
  source_url: 'https://example.com/e/1',
  title: 'Core Banking Modernisation Roundtable',
  start_date: '2026-11-20',
  end_date: null,
  city: 'Bengaluru',
  venue: null,
  format: 'in-person',
  registration_deadline: null,
  organiser: null,
  audience_tag: null,
  summary: null,
  ...over,
});

// ---------------------------------------------------------------- dates

test('isISODate rejects impossible and malformed dates', () => {
  assert.equal(isISODate('2026-10-12'), true);
  assert.equal(isISODate('2026-02-30'), false, 'Feb 30 does not exist');
  assert.equal(isISODate('2026-13-01'), false);
  assert.equal(isISODate('2026-00-10'), false);
  assert.equal(isISODate('12/10/2026'), false);
  assert.equal(isISODate(''), false);
  assert.equal(isISODate(null), false);
  assert.equal(isISODate(undefined), false);
  assert.equal(isISODate('2028-02-29'), true, '2028 is a leap year');
  assert.equal(isISODate('2027-02-29'), false, '2027 is not');
});

test('daysBetween counts whole calendar days and signs the past', () => {
  assert.equal(daysBetween('2026-10-12', '2026-10-19'), 7);
  assert.equal(daysBetween('2026-10-12', '2026-10-12'), 0);
  assert.equal(daysBetween('2026-10-12', '2026-10-11'), -1);
  assert.equal(daysBetween('2026-12-28', '2027-01-04'), 7, 'crosses a year boundary');
  assert.equal(daysBetween('2026-10-12', 'not-a-date'), null);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

// ------------------------------------------------------- the flag (rule 6)

test('a STATED deadline under 7 days gives a red "Closes in N days" badge', () => {
  const u = urgency(ev({ registration_deadline: '2026-10-16' }), TODAY);
  assert.equal(u.kind, 'deadline');
  assert.equal(u.days, 4);
  assert.equal(u.flagged, true);
  assert.equal(u.badge, 'Closes in 4 days');
  assert.equal(u.line, 'Registration closes Fri 16 Oct');
});

test('deadline exactly 7 days away is NOT flagged (boundary is strict)', () => {
  const u = urgency(ev({ registration_deadline: '2026-10-19' }), TODAY);
  assert.equal(u.days, 7);
  assert.equal(u.flagged, false);
  assert.equal(u.badge, null);
});

test('deadline today and tomorrow read naturally', () => {
  assert.equal(urgency(ev({ registration_deadline: '2026-10-12' }), TODAY).badge, 'Closes today');
  assert.equal(urgency(ev({ registration_deadline: '2026-10-13' }), TODAY).badge, 'Closes tomorrow');
});

test('NO stated deadline never claims a registration closes', () => {
  // The rule-6 test. Fifteen sites state no deadline, so this is the normal path.
  const u = urgency(ev({ registration_deadline: null, start_date: '2026-10-16' }), TODAY);
  assert.equal(u.kind, 'event-date');
  assert.equal(u.flagged, true);
  assert.equal(u.badge, 'Event in 4 days', 'must count down to the EVENT, not a deadline');
  assert.equal(u.line, 'Deadline unknown');
  assert.ok(!/clos/i.test(u.badge!), 'the word "closes" must never appear without a stated deadline');
  assert.ok(!/clos/i.test(u.line), 'nor in the plain line');
});

test('no deadline and a far-off event is not flagged but still says unknown', () => {
  const u = urgency(ev({ registration_deadline: null, start_date: '2026-11-20' }), TODAY);
  assert.equal(u.flagged, false);
  assert.equal(u.badge, null);
  assert.equal(u.line, 'Deadline unknown');
});

test('an event with no dates at all degrades to unknown, never to a guess', () => {
  const u = urgency(ev({ registration_deadline: null, start_date: null }), TODAY);
  assert.equal(u.kind, 'none');
  assert.equal(u.flagged, false);
  assert.equal(u.badge, null);
  assert.equal(u.line, 'Deadline unknown');
});

test('formatRange collapses a one-day event and expands a multi-day one', () => {
  assert.equal(formatRange('2026-11-20', null, TODAY), 'Fri 20 Nov');
  assert.equal(formatRange('2026-11-20', '2026-11-20', TODAY), 'Fri 20 Nov');
  assert.equal(formatRange('2026-11-20', '2026-11-21', TODAY), 'Fri 20 Nov - Sat 21 Nov');
  assert.equal(formatRange(null, null, TODAY), 'Date not stated');
});

// ------------------------------------------------------------ calendar link

test('calendar entry uses the stated deadline when there is one', () => {
  const e = ev({ registration_deadline: '2026-10-16' });
  assert.deepEqual(calendarDate(e), { date: '2026-10-16', basis: 'deadline' });
  const p = new URL(googleCalendarUrl(e)!).searchParams;
  assert.equal(p.get('dates'), '20261016/20261017');
  assert.ok(p.get('text')!.startsWith('Register by today'));
  assert.ok(p.get('details')!.includes('Registration closes today'));
});

test('calendar entry falls back to the event date and SAYS it is doing so', () => {
  const e = ev({ registration_deadline: null, start_date: '2026-11-20' });
  assert.deepEqual(calendarDate(e), { date: '2026-11-20', basis: 'event' });
  const p = new URL(googleCalendarUrl(e)!).searchParams;
  assert.equal(p.get('dates'), '20261120/20261121');
  assert.ok(p.get('details')!.includes('Registration deadline not stated'), 'must disclose the fallback');
  assert.ok(!p.get('text')!.includes('Register by today'));
  assert.ok(p.get('details')!.includes('You decide whether to register'));
});

test('no dates at all means no calendar link rather than a wrong one', () => {
  assert.equal(googleCalendarUrl(ev({ registration_deadline: null, start_date: null })), null);
});

// ------------------------------------------------------------- hard filters

test('purely online is excluded, unstated format is kept', () => {
  const r = hardFilter([ev({ format: 'online' }), ev({ format: 'hybrid' }), ev({ format: null })], settings, TODAY);
  assert.equal(r.kept.length, 2, 'hybrid and unstated survive; only purely online is dropped');
  assert.equal(r.dropped[0].reason, 'purely online');
});

test('the window is inclusive at its edge and excludes the day beyond', () => {
  const inside = ev({ start_date: addDays(TODAY, 90)! });
  const outside = ev({ start_date: addDays(TODAY, 91)! });
  assert.equal(hardFilter([inside], settings, TODAY).kept.length, 1);
  const r = hardFilter([outside], settings, TODAY);
  assert.equal(r.kept.length, 0);
  assert.equal(r.dropped[0].reason, 'beyond the window');
});

test('the 90-day window keeps the event the 30-day rule threw away', () => {
  // ETBFSI Converge 2026: Mumbai, BFSI, in-person, 10 Dec. The reason the
  // window was changed at all. See DECISIONS.md.
  const converge = ev({ title: 'ETBFSI Converge 2026', city: 'Mumbai', start_date: '2026-12-10' });
  assert.equal(hardFilter([converge], settings, TODAY).kept.length, 1);
  assert.equal(hardFilter([converge], { ...settings, window_days: 30 }, TODAY).kept.length, 0);
});

test('past events and undated events are dropped with distinct reasons', () => {
  const r = hardFilter([ev({ start_date: '2026-10-11' }), ev({ start_date: null })], settings, TODAY);
  assert.equal(r.kept.length, 0);
  assert.deepEqual(dropSummary(r.dropped), { 'event already passed': 1, 'no date stated': 1 });
});

test('a closed registration is dropped; an unknown one is allowed through', () => {
  const closed = ev({ registration_deadline: '2026-10-11' });
  const unknown = ev({ registration_deadline: null });
  const r = hardFilter([closed, unknown], settings, TODAY);
  assert.equal(r.kept.length, 1);
  assert.equal(r.dropped[0].reason, 'registration already closed');
});

test('city aliases match and the city is normalised to the configured spelling', () => {
  assert.equal(matchCity('Bangalore', settings.cities), 'Bengaluru');
  assert.equal(matchCity('Bengaluru, India', settings.cities), 'Bengaluru');
  assert.equal(matchCity('Navi Mumbai', settings.cities), 'Mumbai');
  assert.equal(matchCity('Secunderabad', settings.cities), 'Hyderabad');
  assert.equal(matchCity('Chennai', settings.cities), null);
  assert.equal(matchCity('New Delhi, India', settings.cities), null);
  assert.equal(matchCity(null, settings.cities), null);

  const r = hardFilter([ev({ city: 'Bangalore' })], settings, TODAY);
  assert.equal(r.kept[0].city, 'Bengaluru', 'display spelling follows Settings');
});

test('an event whose source link did not resolve is never shown', () => {
  // Gemini demonstrably invents URLs (spike 7). Rule 6: no event without a
  // working source link.
  const r = hardFilter([ev({ link_ok: false })], settings, TODAY);
  assert.equal(r.kept.length, 0);
  assert.equal(r.dropped[0].reason, 'source link did not resolve');
});

// ------------------------------------------------------------------ ranking

test('a barely-relevant High event never outranks a highly-relevant Medium one', () => {
  // Regression: the first live run ranked a 1/5 "NEAR x Quantus Happy Hour"
  // (High: payments) above a 5/5 ETBFSI Converge (Medium: BFSI at large).
  const happyHour = ev({ focus_area: 'Payments and digital payments', score: 1 });
  const converge = ev({ focus_area: 'Fintech and BFSI at large', score: 5 });
  assert.ok(rankValue(converge, settings) > rankValue(happyHour, settings),
    'fit must dominate; the focus level weights it, it does not override it');
});

test('at equal fit, the higher-priority focus area still wins', () => {
  const high = ev({ focus_area: 'Payments and digital payments', score: 4 });
  const medium = ev({ focus_area: 'Fintech and BFSI at large', score: 4 });
  assert.ok(rankValue(high, settings) > rankValue(medium, settings));
});

test('a zero fit ranks below everything, whatever its focus area', () => {
  const zeroHigh = ev({ focus_area: 'Payments and digital payments', score: 0 });
  const oneNone = ev({ focus_area: 'Fintech and BFSI at large', score: 1 });
  assert.ok(rankValue(oneNone, settings) > rankValue(zeroHigh, settings));
});

test('focus areas rank but never filter', () => {
  const unmatched = ev({ title: 'Z', focus_area: null, score: 0 });
  const matched = ev({ title: 'A', focus_area: 'Payments and digital payments', score: 4 });
  const out = rank([unmatched, matched], settings);
  assert.equal(out.length, 2, 'the unmatched event is still present');
  assert.equal(out[0].title, 'A');
  assert.equal(out[1].title, 'Z');
});

test('ties break by soonest event, then title, and are stable', () => {
  const a = ev({ title: 'B event', focus_area: 'Payments and digital payments', score: 3, start_date: '2026-11-20' });
  const b = ev({ title: 'A event', focus_area: 'Payments and digital payments', score: 3, start_date: '2026-11-01' });
  const c = ev({ title: 'A event', focus_area: 'Payments and digital payments', score: 3, start_date: '2026-11-20' });
  const out = rank([a, b, c], settings);
  assert.deepEqual(out.map((e) => `${e.title}/${e.start_date}`),
    ['A event/2026-11-01', 'A event/2026-11-20', 'B event/2026-11-20']);
});

test('the cap takes the top 15 and does not reorder them', () => {
  const many = Array.from({ length: 23 }, (_, i) =>
    ev({ title: `Event ${String(i).padStart(2, '0')}`, focus_area: 'Payments and digital payments', score: 5 - (i % 5) })
  );
  const capped = applyCap(rank(many, settings));
  assert.equal(capped.length, 15);
  assert.deepEqual(capped, rank(many, settings).slice(0, 15));
});

test('a short list is returned whole rather than padded', () => {
  assert.equal(applyCap(rank([ev()], settings)).length, 1);
  assert.equal(applyCap([]).length, 0);
});

// ------------------------------------------------------------------ merging

test('the same event from two sources merges into one', () => {
  const a = ev({ source: 'luma', title: 'Digital Payments Summit 2026', start_date: '2026-11-05' });
  const b = ev({ source: 'etbfsi', title: 'The Digital Payments Summit', start_date: '2026-11-05' });
  const out = mergeDuplicates([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'luma, etbfsi', 'both sources are credited');
});

test('merging never loses a stated deadline held by only one source', () => {
  const rich = ev({ source: 'luma', city: 'Mumbai', venue: 'Hall 1', summary: 'Two lines.', registration_deadline: null });
  const thin = ev({ source: 'etbfsi', city: null, venue: null, summary: null, registration_deadline: '2026-11-01' });
  const out = mergeDuplicates([rich, thin]);
  assert.equal(out.length, 1);
  assert.equal(out[0].venue, 'Hall 1', 'the richer record wins the shape');
  assert.equal(out[0].registration_deadline, '2026-11-01', 'but the only stated deadline survives');
});

test('different dates are different events, however similar the title', () => {
  const a = ev({ title: 'BFSI Meetup', start_date: '2026-11-05' });
  const b = ev({ title: 'BFSI Meetup', start_date: '2026-12-05' });
  assert.equal(mergeDuplicates([a, b]).length, 2);
});

test('fingerprints ignore year, ordinal and filler noise in titles', () => {
  assert.equal(
    fingerprint(ev({ title: '29th BFSI IT Summit 2026', start_date: '2026-11-05' })),
    fingerprint(ev({ title: 'The BFSI IT Summit', start_date: '2026-11-05' }))
  );
});
