import { NextResponse } from 'next/server';
import {
  getSettings, upcomingEvents, calendarEvents, latestSourceRuns,
  insertDigest, logSend, testSendsToday,
} from '@/lib/db';
import { renderDigest, sendDigest } from '@/lib/email';
import { DAILY_SEND_CAP, MAX_NEW_EVENTS } from '@/config';
import { todayISO } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Admin "Send digest now".
 *
 * Passcode-only, checked server-side against an env var that never reaches
 * the client bundle. Capped at 10 successful test sends a day, shared by
 * everyone. The cap is never revealed on the page — a blocked attempt gets a
 * neutral message, not a count.
 *
 * This sends the digest built from the events already in the database. It
 * does not re-run the research: a full fetch takes minutes and would exceed
 * the function limit. The Monday cron is what goes and finds new events.
 */
export async function POST(req: Request) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    return NextResponse.json({ ok: false, message: 'Sending is not configured.' }, { status: 503 });
  }

  let body: { passcode?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Bad request.' }, { status: 400 });
  }

  if (!timingSafeEqual(String(body.passcode ?? ''), expected)) {
    // Deliberately vague, and logged as blocked.
    try { await logSend({ kind: 'test_send', result: 'blocked', error: 'bad passcode' }); } catch {}
    return NextResponse.json({ ok: false, message: 'Passcode not accepted.' }, { status: 401 });
  }

  const settings = await getSettings();
  const to = (body.to || settings.recipient || process.env.DIGEST_RECIPIENT || '').trim();
  if (!to) {
    return NextResponse.json(
      { ok: false, message: 'No recipient. Type an address, or set one in Settings.' },
      { status: 400 }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ ok: false, message: 'That does not look like an email address.' }, { status: 400 });
  }

  if ((await testSendsToday()) >= DAILY_SEND_CAP) {
    try { await logSend({ kind: 'test_send', result: 'blocked', recipient: to, error: 'daily cap' }); } catch {}
    return NextResponse.json(
      { ok: false, message: 'Not available right now. Try again tomorrow.' },
      { status: 429 }
    );
  }

  const today = todayISO();
  const [all, calendar, sourceRuns] = await Promise.all([
    upcomingEvents(60), calendarEvents(), latestSourceRuns(),
  ]);

  const rendered = renderDigest({
    newEvents: all.slice(0, MAX_NEW_EVENTS),
    calendar,
    sourceRuns,
    sentAt: new Date(),
    today,
  });

  const sent = await sendDigest(to, rendered);

  if (!sent.ok) {
    await logSend({ kind: 'test_send', result: 'error', recipient: to, error: sent.error });
    return NextResponse.json({ ok: false, message: `Not sent: ${sent.error}` }, { status: 502 });
  }

  const digestId = await insertDigest({
    runId: null,
    kind: 'test_send',
    recipient: to,
    subject: rendered.subject,
    newCount: rendered.newCount,
    calendarCount: rendered.calendarCount,
    closingCount: rendered.closingCount,
    html: rendered.html,
  });
  await logSend({ kind: 'test_send', result: 'sent', recipient: to, messageId: sent.messageId });

  const at = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date());

  return NextResponse.json({
    ok: true,
    message: `Sent to ${to} at ${at} IST — ${rendered.newCount} events, ${rendered.calendarCount} on the calendar.`,
    at,
    digestId,
  });
}

/** Constant-time compare, so the passcode cannot be probed character by character. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still burn a comparison so length is not a timing signal on its own
    let x = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) x |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
