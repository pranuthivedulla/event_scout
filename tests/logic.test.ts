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

import { isISODate, daysBetween, addDays, urgency, calendarDate, googleCalendarUrl, formatRange, pgDateToISO } from '../src/lib/dates';
import { hardFilter, matchCity, dropSummary } from '../src/lib/filters';
import { rank, applyCap, rankValue, mergeDuplicates, fingerprint, sortForDisplay } from '../src/lib/rank';
import { buildDeadlineScript } from '../src/lib/tts';
import { redactSecrets, safeMessage } from '../src/lib/redact';
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

let evSeq = 0;
const ev = (over: Partial<ScoutEvent> = {}): ScoutEvent => ({
  source: 'luma',
  // distinct per event: dedup keys on the URL, so sharing one would collapse
  // two different test events into one
  source_url: `https://example.com/e/${++evSeq}`,
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

// ------------------------------------------------------- postgres DATE reads

test('a Postgres DATE read back in IST does not shift a day earlier', () => {
  // Regression. The driver builds DATE into a JS Date at LOCAL midnight. In
  // IST that is 18:30 UTC the day before, so .toISOString().slice(0,10)
  // returned the previous day and every date in the system was one day early.
  // Caught by diffing two runs: ETBFSI Converge moved 10 Dec -> 9 Dec.
  const istMidnight = new Date(2026, 11, 10, 0, 0, 0); // local 10 Dec 2026
  assert.equal(pgDateToISO(istMidnight), '2026-12-10');

  const oct = new Date(2026, 9, 24, 0, 0, 0);
  assert.equal(pgDateToISO(oct), '2026-10-24');
});

test('pgDateToISO passes strings through and rejects junk', () => {
  assert.equal(pgDateToISO('2026-10-24'), '2026-10-24');
  assert.equal(pgDateToISO('2026-10-24T00:00:00Z'), '2026-10-24');
  assert.equal(pgDateToISO(null), null);
  assert.equal(pgDateToISO(undefined), null);
  assert.equal(pgDateToISO(''), null);
  assert.equal(pgDateToISO(new Date('nonsense')), null);
  assert.equal(pgDateToISO('not a date'), null);
});

// ------------------------------------------------------- spoken deadline note

test('the voice note skips urgent events that match no focus area', () => {
  // The first recorded clip spent 47 seconds reading out iOS meetups and a
  // wellness talk, because the soonest events are often the least relevant.
  // They stay in the email and on the dashboard; they are just not spoken.
  const relevant = ev({ title: 'Payments Roundtable', score: 4, start_date: '2026-10-15' });
  const noise = ev({ title: 'Swift Bengaluru x Okta', score: 0, start_date: '2026-10-14' });
  const script = buildDeadlineScript([noise, relevant], [], TODAY);
  assert.ok(script);
  assert.equal(script!.count, 1);
  assert.ok(script!.text.includes('Payments Roundtable'));
  assert.ok(!script!.text.includes('Swift'), 'a 0/5 event must not be read aloud');
});

test('anything on the calendar is spoken whatever it scored', () => {
  // He put it there himself, so it is relevant by his own choice.
  const pinned = ev({ title: 'Odd One Out', score: 0, start_date: '2026-10-15', fingerprint: 'fp-1' });
  const script = buildDeadlineScript([], [pinned], TODAY);
  assert.ok(script);
  assert.ok(script!.text.includes('Odd One Out'));
});

test('no clip is recorded when nothing is both urgent and relevant', () => {
  const faraway = ev({ title: 'ETBFSI Converge', score: 5, start_date: '2026-12-10' });
  const soonButIrrelevant = ev({ title: 'Embedded Swift', score: 0, start_date: '2026-10-13' });
  assert.equal(buildDeadlineScript([faraway, soonButIrrelevant], [], TODAY), null);
});

test('a stated deadline and an event date are spoken differently', () => {
  const stated = ev({ title: 'Alpha', score: 4, registration_deadline: '2026-10-15' });
  const unstated = ev({ title: 'Beta', score: 4, start_date: '2026-10-15' });

  const a = buildDeadlineScript([stated], [], TODAY)!;
  assert.ok(a.text.includes('closes for registration'), 'a stated deadline says so');
  assert.ok(!a.text.includes('no registration deadline was published'));

  const b = buildDeadlineScript([unstated], [], TODAY)!;
  assert.ok(b.text.includes('takes place'), 'an event date must not be called a deadline');
  assert.ok(b.text.includes('no registration deadline was published'), 'and must be disclosed');
});

test('titles are tidied for speech without changing the event', () => {
  const messy = ev({
    title: '-1 to Swiggy with Nandan Reddy | South Park Commons (BLR)',
    score: 3, start_date: '2026-10-15',
  });
  const text = buildDeadlineScript([messy], [], TODAY)!.text;
  assert.ok(!text.includes('|'), 'pipe suffixes are dropped');
  assert.ok(!text.includes('(BLR)'), 'bracketed suffixes are dropped');
  assert.ok(text.includes('-1 to Swiggy with Nandan Reddy'));
});

test('acronyms are spelled out so they are read as letters', () => {
  const e = ev({ title: 'ETBFSI Converge', score: 5, start_date: '2026-10-15' });
  assert.ok(buildDeadlineScript([e], [], TODAY)!.text.includes('E T B F S I'));
});

// --------------------------------------------- urgent events sort to the top

test('an urgent, relevant event outranks a better-fitting distant one', () => {
  // The 7-day flag is the point of the digest. A flagged event must not be
  // buried at number fourteen just because something else scored higher.
  const perfectButFar = ev({ title: 'ETBFSI Converge', score: 5, start_date: '2026-12-10',
                             focus_area: 'Payments and digital payments' });
  const goodAndUrgent = ev({ title: 'Payments Roundtable', score: 3, start_date: '2026-10-15',
                             focus_area: 'Payments and digital payments' });
  const out = rank([perfectButFar, goodAndUrgent], settings, TODAY);
  assert.equal(out[0].title, 'Payments Roundtable');
  assert.equal(out[1].title, 'ETBFSI Converge');
});

test('an urgent event that matches NO focus area is not promoted', () => {
  // Every flagged event today is a 0/5 meetup, because the flag falls back to
  // event-date proximity and the soonest events are the least relevant.
  // Promoting those would open the digest on noise.
  const noiseButUrgent = ev({ title: 'Swift Bengaluru and Okta', score: 0, start_date: '2026-10-14' });
  const relevantButFar = ev({ title: 'ETBFSI Converge', score: 5, start_date: '2026-12-10',
                              focus_area: 'Payments and digital payments' });
  const out = rank([noiseButUrgent, relevantButFar], settings, TODAY);
  assert.equal(out[0].title, 'ETBFSI Converge', 'a 0/5 event never leads the digest');
  assert.equal(out.length, 2, 'but it is still present, never hidden');
});

test('among several urgent and relevant events, fit still decides', () => {
  const a = ev({ title: 'Weak fit, urgent', score: 1, start_date: '2026-10-15',
                 focus_area: 'Fintech and BFSI at large' });
  const b = ev({ title: 'Strong fit, urgent', score: 5, start_date: '2026-10-16',
                 focus_area: 'Payments and digital payments' });
  const out = rank([a, b], settings, TODAY);
  assert.equal(out[0].title, 'Strong fit, urgent');
});

test('sortForDisplay honours the same rule using the stored rank value', () => {
  const far = ev({ title: 'Far', score: 5, start_date: '2026-12-10', rank_value: 150 });
  const urgent = ev({ title: 'Urgent', score: 2, start_date: '2026-10-15', rank_value: 60 });
  const noise = ev({ title: 'Noise', score: 0, start_date: '2026-10-13', rank_value: 0 });
  const out = sortForDisplay([far, noise, urgent], TODAY);
  assert.deepEqual(out.map((e) => e.title), ['Urgent', 'Far', 'Noise']);
});

// ---------------------------------------------------------------- redaction

test('a secret pasted into an error message never survives', () => {
  // This happened in production: GEMINI_API_KEY was pasted into Vercel with a
  // trailing newline, dragging the next .env line with it. fetch() threw
  // 'Headers.append: "<key>\nADMIN_PASSCODE=..." is an invalid header value'
  // and the raw text went into the HTTP response, the database, and would
  // have gone into the digest email.
  const before = { ...process.env };
  process.env.GEMINI_API_KEY = 'AQ.Ab8RN6IU02GOmSpUw5q2mIPC9mOR4Q0wjD8AYlTJ';
  process.env.ADMIN_PASSCODE = 'moss-thistle-63';
  try {
    const leak = `Headers.append: "${process.env.GEMINI_API_KEY}\nADMIN_PASSCODE=${process.env.ADMIN_PASSCODE}" is an invalid header value.`;
    const safe = redactSecrets(leak);
    assert.ok(!safe.includes('AQ.Ab8RN6IU'), 'the API key must not survive');
    assert.ok(!safe.includes('moss-thistle-63'), 'the passcode must not survive');
    assert.ok(safe.includes('invalid header value'), 'the useful part is kept');
  } finally {
    process.env = before;
  }
});

test('a connection string and its password are both redacted', () => {
  const before = { ...process.env };
  process.env.DATABASE_URL = 'postgresql://neondb_owner:npg_S3cretPw123@ep-x-pooler.aws.neon.tech/event_scout?sslmode=require';
  try {
    const safe = redactSecrets(`connect failed for ${process.env.DATABASE_URL} (password npg_S3cretPw123)`);
    assert.ok(!safe.includes('npg_S3cretPw123'), 'the password must not survive anywhere');
    assert.ok(!safe.includes('neon.tech'), 'nor the host');
  } finally {
    process.env = before;
  }
});

test('key-shaped strings are redacted even when we do not hold them', () => {
  assert.ok(!redactSecrets('token AIzaSyCOeX0pHblpZDw7qCuZVFLx5SdObZXaYk failed').includes('AIzaSy'));
  assert.ok(!redactSecrets('using AQ.AbCdEfGhIjKlMnOpQrStUv now').includes('AQ.AbCdEf'));
});

test('redaction leaves ordinary error text alone', () => {
  assert.equal(redactSecrets('HTTP 503 from the organiser site'), 'HTTP 503 from the organiser site');
  assert.equal(safeMessage(new Error('page could not be read')), 'page could not be read');
});
