import { NextResponse } from 'next/server';
import { after } from 'next/server';
import {
  getSettings, createRun, updateRun, upsertEvents, recordSourceRuns,
  existingEnrichment, upcomingEvents, calendarEvents, logSend,
} from '@/lib/db';
import { prepareAndSend } from '@/lib/digest';
import { runPipeline } from '@/lib/pipeline';
import { renderDigest, appUrl } from '@/lib/email';
import { MAX_NEW_EVENTS } from '@/config';
import { todayISO } from '@/lib/dates';
import { safeMessage } from '@/lib/redact';

export const dynamic = 'force-dynamic';
/** Hobby's ceiling is 300s, and that is also its default with Fluid compute. */
export const maxDuration = 300;

/**
 * Hobby cuts the function at 300s. Stop enriching at this point so scoring,
 * persisting, rendering and the SMTP send all still fit afterwards. Whatever
 * is left unenriched keeps its event — only its summary is missing — and the
 * continuation pass fills it in after the digest has gone.
 *
 * Measured in production: at a 130s cutoff the whole run took 177s, so the
 * stages after enrichment cost ~47s. Raised to 170s, which leaves roughly
 * 300 - 170 - 50 (a batch already in flight when the deadline passes) - 47
 * = ~33s of margin, and gets noticeably more events summarised.
 */
const ENRICH_DEADLINE_MS = 170_000;

/**
 * The Monday run.
 *
 * Schedule is `0 2 * * 1` — 2 UTC, which Vercel Hobby fires anywhere inside
 * that hour, so 07:30-08:29 IST. Always before 9:00, never after. Nothing in
 * the UI claims a 9:00 send; the dashboard shows the real timestamp.
 *
 * Vercel does not retry a failed cron, so this is idempotent: events upsert on
 * fingerprint, and a second call simply refreshes them. If enrichment runs out
 * of time the run still completes and still sends — missing summaries, not
 * missing events — and a follow-up pass fills them in afterwards.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const authorised =
    !secret || auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
  if (!authorised) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry') === '1';
  const startedAt = Date.now();
  const today = todayISO();
  const settings = await getSettings();
  const runId = await createRun('monday_auto');
  const log: string[] = [];

  try {
    await updateRun(runId, { stage: 'fetch' });

    // Everything we have already read, so unchanged pages are not re-processed.
    const seen = await upcomingEvents(200);
    const cached = await existingEnrichment(seen.map((e) => e.source_url));

    const result = await runPipeline(settings, {
      today,
      cached,
      enrichDeadline: startedAt + ENRICH_DEADLINE_MS,
      log: (m) => log.push(m),
    });

    await updateRun(runId, { stage: 'persist' });
    await recordSourceRuns(runId, result.sourceRuns);
    await upsertEvents(result.events, runId);

    const [all, calendar] = await Promise.all([upcomingEvents(60), calendarEvents()]);
    const rendered = renderDigest({
      newEvents: all.slice(0, MAX_NEW_EVENTS),
      calendar,
      sourceRuns: result.sourceRuns,
      sentAt: new Date(),
      today,
    });

    if (dryRun) {
      await updateRun(runId, { stage: 'done', status: 'done', stats: { ...result.stats, dryRun: true } });
      return NextResponse.json({
        ok: true, dryRun: true, runId, subject: rendered.subject,
        stats: result.stats, sources: result.sourceRuns, log,
      });
    }

    await updateRun(runId, { stage: 'send' });
    const to = settings.recipient || process.env.DIGEST_RECIPIENT || '';
    if (!to) {
      await updateRun(runId, { stage: 'done', status: 'failed', error: 'no recipient configured', stats: result.stats });
      await logSend({ kind: 'monday_auto', result: 'error', error: 'no recipient configured' });
      return NextResponse.json({ ok: false, runId, error: 'no recipient configured', stats: result.stats }, { status: 500 });
    }

    const delivered = await prepareAndSend({
      kind: 'monday_auto',
      to,
      newEvents: all.slice(0, MAX_NEW_EVENTS),
      calendar,
      sourceRuns: result.sourceRuns,
      today,
      runId,
    });

    await updateRun(runId, {
      stage: 'done',
      status: delivered.ok ? 'done' : 'failed',
      error: delivered.error,
      stats: result.stats,
    });

    // If enrichment ran short, fill in the rest after responding. Best effort:
    // the digest has already gone, this only improves the dashboard.
    if (result.stats.enrichIncomplete && secret) {
      after(async () => {
        try {
          await fetch(`${appUrl()}/api/cron/monday?dry=1&key=${encodeURIComponent(secret)}`, {
            headers: { 'x-event-scout': 'continuation' },
          });
        } catch { /* best effort */ }
      });
    }

    return NextResponse.json({
      ok: delivered.ok, runId, sentTo: delivered.ok ? to : null, error: delivered.error,
      subject: delivered.rendered.subject, audioSeconds: delivered.audioSeconds,
      stats: result.stats, sources: result.sourceRuns,
    });
  } catch (e) {
    const msg = safeMessage(e);
    await updateRun(runId, { status: 'failed', error: msg });
    await logSend({ kind: 'monday_auto', result: 'error', error: msg });
    return NextResponse.json({ ok: false, runId, error: msg, log }, { status: 500 });
  }
}
