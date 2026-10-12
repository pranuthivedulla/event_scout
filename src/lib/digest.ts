/**
 * Preparing and sending one digest. Shared by the admin button and the Monday
 * cron so the two cannot drift apart.
 *
 * Order matters here: the email needs the digest's id to link to its player,
 * and the id only exists once the row is inserted. So the row goes in first,
 * the HTML is rendered against it, and the row is removed again if the send
 * then fails — no archive entry for an email that never arrived.
 */

import {
  insertDigest, updateDigestHtml, deleteDigest, saveDigestAudio, logSend,
} from './db';
import { renderDigest, sendDigest, type RenderedDigest } from './email';
import { buildDeadlineScript, synthesise } from './tts';
import { sortForDisplay } from './rank';
import type { ScoutEvent, SourceRun } from './types';

export interface DeliverInput {
  kind: 'monday_auto' | 'test_send';
  to: string;
  newEvents: ScoutEvent[];
  calendar: ScoutEvent[];
  sourceRuns: SourceRun[];
  today: string;
  runId?: number | null;
  /** Skip the TTS call, e.g. on a dry run. */
  skipAudio?: boolean;
}

export interface DeliverResult {
  ok: boolean;
  digestId: number | null;
  messageId: string | null;
  error: string | null;
  rendered: RenderedDigest;
  audioSeconds: number | null;
}

export async function prepareAndSend(input: DeliverInput): Promise<DeliverResult> {
  const { kind, to, calendar, sourceRuns, today } = input;
  const sentAt = new Date();

  // Flagged-and-relevant to the top. The 7-day flag is the point of the
  // digest; it must not land at number fourteen.
  const newEvents = sortForDisplay(input.newEvents, today);

  // Rendered once without audio, purely to get the counts for the row.
  const provisional = renderDigest({ newEvents, calendar, sourceRuns, sentAt, today });

  const digestId = await insertDigest({
    runId: input.runId ?? null,
    kind,
    recipient: to,
    subject: provisional.subject,
    newCount: provisional.newCount,
    calendarCount: provisional.calendarCount,
    closingCount: provisional.closingCount,
    html: '',
  });

  // The spoken note, only when something is genuinely urgent. Its failure must
  // never cost the digest — the email is the deliverable, the audio is an extra.
  let audio: { digestId: number; seconds: number } | null = null;
  if (!input.skipAudio) {
    const script = buildDeadlineScript(newEvents, calendar, today);
    if (script) {
      try {
        const spoken = await synthesise(script.text);
        await saveDigestAudio(digestId, spoken.wav, script.text, spoken.seconds);
        audio = { digestId, seconds: spoken.seconds };
      } catch {
        audio = null;
      }
    }
  }

  const rendered = renderDigest({ newEvents, calendar, sourceRuns, sentAt, today, audio });
  await updateDigestHtml(digestId, rendered.html);

  const sent = await sendDigest(to, rendered);

  if (!sent.ok) {
    // Nothing arrived, so nothing belongs in the archive.
    await deleteDigest(digestId).catch(() => {});
    await logSend({ kind, result: 'error', recipient: to, error: sent.error });
    return { ok: false, digestId: null, messageId: null, error: sent.error, rendered, audioSeconds: null };
  }

  await logSend({ kind, result: 'sent', recipient: to, messageId: sent.messageId });
  return {
    ok: true, digestId, messageId: sent.messageId, error: null,
    rendered, audioSeconds: audio?.seconds ?? null,
  };
}
