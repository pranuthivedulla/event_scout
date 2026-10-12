/**
 * The spoken deadline note.
 *
 * Audio cannot play inside an email — Gmail and Outlook strip <audio> and all
 * script — so the digest links to a player page instead, and only when there
 * is something urgent to say.
 *
 * IMPORTANT: the script is composed here, in plain code, from event data whose
 * dates were computed by dates.ts. Gemini is given a finished transcript and
 * does nothing but read it aloud. No model is anywhere near a date, a count or
 * a deadline, so rule 6 holds exactly as it does in the email.
 */

import { GEMINI_API_URL, GEMINI_TTS_MODEL, TTS_VOICE } from '@/config';
import type { ScoutEvent } from './types';
import { urgency, todayISO } from './dates';

/** Spell out acronyms so they are read as letters, not as a word. */
function speakable(s: string): string {
  return s
    // A pipe is a pause, not a truncation point: organisers put the venue
    // there, but just as often the informative half of the title.
    .replace(/\s*\|\s*/g, ', ')
    // a trailing "(BLR)" or "[Mumbai]" is always noise when read aloud
    .replace(/\s*[([][^)\]]*[)\]]\s*$/, '')
    // ETBFSI -> E T B F S I, but leave ordinary Capitalised Words alone
    .replace(/\b[A-Z]{2,6}\b/g, (m) => m.split('').join(' '))
    .replace(/\s[×x]\s/gi, ' and ')
    .replace(/&/g, ' and ')
    .replace(/[:;]/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/, '')
    .trim();
}

export interface DeadlineScript {
  text: string;
  count: number;
}

/**
 * Build the transcript. Returns null when there is nothing worth saying.
 *
 * Only events that are urgent AND relevant are read aloud. The flag fires on
 * event-date proximity when no deadline was published, and the soonest events
 * are frequently the least relevant ones — the first recorded clip spent 47
 * seconds on iOS meetups and a wellness talk. In text you skim past those; in
 * audio you cannot. They remain in the email and on the dashboard, so nothing
 * is hidden by focus area; they are simply not spoken.
 */
export function buildDeadlineScript(
  events: ScoutEvent[],
  calendar: ScoutEvent[],
  today: string = todayISO()
): DeadlineScript | null {
  const onCalendar = new Set(calendar.map((e) => e.fingerprint ?? e.source_url));
  const seen = new Set<string>();
  const flagged = [...calendar, ...events].filter((e) => {
    const key = e.fingerprint ?? e.source_url;
    if (seen.has(key)) return false;
    seen.add(key);
    if (!urgency(e, today).flagged) return false;
    // Anything he put on his calendar is relevant by his own choice.
    if (onCalendar.has(key)) return true;
    return (e.score ?? 0) > 0;
  });

  if (!flagged.length) return null;

  // Keep it short enough to be worth listening to.
  const spoken = flagged.slice(0, 6);
  const parts: string[] = [];

  parts.push(
    flagged.length === 1
      ? 'One thing needs you this week.'
      : `${capitalise(numberWord(flagged.length))} things need you this week.`
  );

  let anyUnstated = false;
  for (const e of spoken) {
    const u = urgency(e, today);
    const days = u.days ?? 0;
    const when =
      days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${numberWord(days)} days`;

    if (u.kind === 'deadline') {
      parts.push(`${speakable(e.title)}${e.city ? `, ${e.city},` : ','} closes for registration ${when}.`);
    } else {
      anyUnstated = true;
      parts.push(`${speakable(e.title)}${e.city ? `, ${e.city},` : ','} takes place ${when}.`);
    }
  }

  if (flagged.length > spoken.length) {
    parts.push(`And ${numberWord(flagged.length - spoken.length)} more in the email.`);
  }

  if (anyUnstated) {
    parts.push(
      'For the ones given as a date of the event, no registration deadline was published, so check the organiser page before you count on it.'
    );
  }

  return { text: parts.join(' '), count: flagged.length };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function numberWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return n <= 10 ? words[n] : String(n);
}

export interface Spoken {
  wav: Buffer;
  seconds: number;
}

/** Gemini TTS. Returns a complete WAV (RIFF header, 24 kHz mono 16-bit). */
export async function synthesise(text: string): Promise<Spoken> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{
        type: 'user_input',
        content: [{
          type: 'text',
          text,
          // 3.8 TTS reads its input verbatim, so tone goes here, never in the text.
          annotations: [{ type: 'speech_metadata', style: 'calm, clear, matter of fact' }],
        }],
      }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: TTS_VOICE }] },
    }),
  });

  if (!res.ok) throw new Error(`TTS returned ${res.status}`);
  const json = (await res.json()) as {
    steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
  };

  let b64: string | null = null;
  for (const s of json.steps ?? []) {
    if (s.type !== 'model_output') continue;
    for (const c of s.content ?? []) if (c.type === 'audio' && c.data) b64 = c.data;
  }
  if (!b64) throw new Error('TTS returned no audio');

  const wav = Buffer.from(b64, 'base64');
  if (wav.subarray(0, 4).toString('ascii') !== 'RIFF') throw new Error('TTS did not return a WAV');

  // duration from the RIFF header rather than a guess
  const rate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  const seconds = (wav.length - 44) / (rate * channels * (bits / 8));

  return { wav, seconds: Math.round(seconds * 10) / 10 };
}
