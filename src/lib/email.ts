/**
 * The Monday digest email.
 *
 * Deliberately NOT the dashboard's glassmorphism. backdrop-filter, flex and
 * gradients are stripped or broken by Gmail and Outlook desktop, so this is
 * tables, inline styles and flat colour — a cousin of the dashboard, sharing
 * its green (#0f5c49) and its red badge (#b42318), not a copy of it.
 *
 * The deadline flag is plain text in a solid-colour cell. It works with images
 * off, in dark mode, and in Outlook's Word renderer.
 */

import type { ScoutEvent, SourceRun } from './types';
import { urgency, formatRange, formatDay, googleCalendarUrl, todayISO } from './dates';

const GREEN = '#0f5c49';
const GREEN_DARK = '#0b4a3a';
const RED = '#b42318';
const INK = '#12302a';
const MUTED = '#3a5a51';
const LINE = '#d7e5df';
const PAPER = '#f4f8f6';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * The calendar link goes through our own route so the click is recorded, then
 * redirects to Google. The click means "interested" and nothing more — it is
 * never rendered anywhere as "registered".
 */
function calendarLink(ev: ScoutEvent): string | null {
  if (!ev.id) return googleCalendarUrl(ev);
  if (!googleCalendarUrl(ev)) return null;
  return `${appUrl()}/api/calendar/${ev.id}`;
}

// --------------------------------------------------------------------------

function badgeCell(ev: ScoutEvent, today: string): string {
  const u = urgency(ev, today);
  if (!u.badge) {
    return `<span style="font-size:13px;color:${MUTED};">${esc(u.line)}</span>`;
  }
  // solid background, white text: survives dark mode and images-off
  return (
    `<span style="display:inline-block;background:${RED};color:#ffffff;font-size:13px;` +
    `font-weight:700;padding:4px 10px;border-radius:4px;">${esc(u.badge)}</span>` +
    `<span style="font-size:13px;color:${MUTED};">&nbsp;&nbsp;${esc(u.line)}</span>`
  );
}

function button(href: string, label: string, primary: boolean): string {
  const bg = primary ? GREEN : '#ffffff';
  const fg = primary ? '#ffffff' : GREEN_DARK;
  const border = primary ? GREEN : '#b9d3c9';
  return (
    `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};` +
    `border:1px solid ${border};border-radius:6px;padding:9px 16px;font-size:14px;` +
    `font-weight:700;text-decoration:none;font-family:${FONT};">${esc(label)}</a>`
  );
}

function eventBlock(ev: ScoutEvent, rank: number | null, today: string): string {
  const meta = [ev.city, formatRange(ev.start_date, ev.end_date, today), ev.format]
    .filter(Boolean)
    .map((s) => esc(s))
    .join(' &middot; ');

  const cal = calendarLink(ev);

  return `
<tr><td style="padding:18px 0;border-bottom:1px solid ${LINE};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${rank !== null ? `<td width="34" valign="top" style="font-family:${FONT};font-size:15px;font-weight:800;color:${GREEN};padding-top:2px;">${rank}.</td>` : ''}
    <td valign="top" style="font-family:${FONT};">
      <div style="font-size:17px;font-weight:700;color:${INK};line-height:1.35;">${esc(ev.title)}</div>
      <div style="font-size:13px;color:${MUTED};padding-top:4px;">${meta}${
        ev.audience_tag
          ? ` &middot; <span style="background:#fff0cf;color:#5c3f00;padding:2px 7px;border-radius:3px;font-weight:700;">${esc(ev.audience_tag)}</span>`
          : ''
      }</div>
      ${ev.summary ? `<div style="font-size:14px;color:#1f3b34;line-height:1.5;padding-top:8px;">${esc(ev.summary)}</div>` : ''}
      ${ev.reason ? `<div style="font-size:13px;color:${GREEN_DARK};padding-top:6px;"><strong>Fit ${ev.score ?? '-'}/5</strong>${ev.focus_area ? ` &middot; ${esc(ev.focus_area)}` : ''} &middot; ${esc(ev.reason)}</div>` : ''}
      <div style="padding-top:10px;">${badgeCell(ev, today)}</div>
      <div style="padding-top:12px;">
        ${button(ev.source_url, 'Register', true)}
        ${cal ? `&nbsp;&nbsp;${button(cal, 'Add to calendar', false)}` : ''}
      </div>
      <div style="font-size:12px;color:#7d948c;padding-top:8px;">via ${esc(ev.source)}</div>
    </td>
  </tr></table>
</td></tr>`;
}

function calendarLine(ev: ScoutEvent, today: string): string {
  const u = urgency(ev, today);
  const when = ev.registration_deadline
    ? `Closes ${formatDay(ev.registration_deadline, today)}`
    : `Event ${formatDay(ev.start_date, today)}`;
  return `
<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-size:14px;color:${INK};">
      <a href="${esc(ev.source_url)}" style="color:${INK};text-decoration:none;font-weight:600;">${esc(ev.title)}</a>
      <span style="color:${MUTED};font-size:13px;">&nbsp;&middot;&nbsp;${esc(ev.city ?? '')}</span>
    </td>
    <td align="right" style="font-size:12px;font-weight:700;white-space:nowrap;${
      u.flagged ? `background:${RED};color:#ffffff;padding:3px 9px;border-radius:4px;` : `color:${MUTED};`
    }">${esc(when)}</td>
  </tr></table>
</td></tr>`;
}

function section(title: string, note: string | null): string {
  return `
<tr><td style="padding:26px 0 2px;font-family:${FONT};">
  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${GREEN};">${esc(title)}</div>
  ${note ? `<div style="font-size:13px;color:${MUTED};padding-top:4px;">${esc(note)}</div>` : ''}
</td></tr>`;
}

// --------------------------------------------------------------------------

export interface DigestInput {
  newEvents: ScoutEvent[];
  calendar: ScoutEvent[];
  sourceRuns: SourceRun[];
  sentAt: Date;
  today?: string;
  /**
   * The spoken deadline note, when one was recorded. Audio cannot play inside
   * an email, so this is a LINK to the player, never an embedded element.
   * Everything in the digest works with this ignored.
   */
  audio?: { digestId: number; seconds: number } | null;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
  newCount: number;
  calendarCount: number;
  closingCount: number;
}

/** One line on how the sources did. A failed source is named, never hidden. */
export function sourceStatusLine(runs: SourceRun[]): string {
  const ok = runs.filter((r) => r.ok);
  const bad = runs.filter((r) => !r.ok);
  const parts: string[] = [];
  if (ok.length) parts.push(`${ok.map((r) => r.source).join(', ')} checked`);
  for (const b of bad) {
    parts.push(
      b.error === 'not configured'
        ? `${b.source} is not connected yet`
        : `${b.source} could not be reached (${b.error ?? 'unknown error'})`
    );
  }
  return parts.length ? `Sources: ${parts.join('. ')}.` : 'No sources ran.';
}

export function renderDigest(input: DigestInput): RenderedDigest {
  const today = input.today ?? todayISO(input.sentAt);

  // 0/5 events are never hidden — the brief forbids it — but they sit in a
  // quieter tail so the top of the email stays worth reading.
  const ranked = input.newEvents.filter((e) => (e.score ?? 0) > 0);
  const alsoFound = input.newEvents.filter((e) => (e.score ?? 0) === 0);

  const closing = [...input.newEvents, ...input.calendar].filter((e) => urgency(e, today).flagged).length;

  const istTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(input.sentAt);

  const subject =
    input.newEvents.length === 0
      ? `Event Scout: nothing new this week${input.calendar.length ? `, ${input.calendar.length} on your calendar` : ''}`
      : `Event Scout: ${input.newEvents.length} new event${input.newEvents.length === 1 ? '' : 's'}${
          input.calendar.length ? ` and ${input.calendar.length} on your calendar` : ''
        }`;

  const body: string[] = [];

  // A link, not a player: no mainstream email client runs <audio> or script.
  // It sits above the content and is purely additive.
  if (input.audio) {
    const href = `${appUrl()}/listen/${input.audio.digestId}`;
    body.push(`
<tr><td style="padding:20px 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background:#eef5f2;border:1px solid ${LINE};border-radius:10px;">
    <tr><td style="padding:14px 16px;font-family:${FONT};">
      <div style="font-size:14px;font-weight:700;color:${INK};">
        ${closing} ${closing === 1 ? 'thing needs' : 'things need'} you this week
      </div>
      <div style="font-size:13px;color:${MUTED};padding:3px 0 10px;">
        ${Math.round(input.audio.seconds)}-second spoken summary, for the commute.
      </div>
      ${button(href, 'Listen', false)}
    </td></tr>
  </table>
</td></tr>`);
  }

  if (input.calendar.length) {
    body.push(section('On your calendar', 'Stays here every Monday until it closes.'));
    body.push('<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    for (const e of input.calendar) body.push(calendarLine(e, today));
    body.push('</table></td></tr>');
  }

  if (ranked.length) {
    body.push(section('Ranked for you', `${ranked.length} new, ordered by fit to your focus areas.`));
    body.push('<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    ranked.forEach((e, i) => body.push(eventBlock(e, i + 1, today)));
    body.push('</table></td></tr>');
  }

  if (!input.newEvents.length) {
    body.push(section('Nothing new this week', null));
    body.push(`
<tr><td style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.6;padding-top:6px;">
  No new events matched your cities and window this week. The sources were
  checked and reported above &mdash; this is a quiet week, not a failure.
</td></tr>`);
  }

  if (alsoFound.length) {
    body.push(section('Also found this week', 'No focus-area match. Listed so nothing is hidden from you.'));
    body.push('<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">');
    for (const e of alsoFound) body.push(calendarLine(e, today));
    body.push('</table></td></tr>');
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(sourceStatusLine(input.sourceRuns))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:10px;">

  <tr><td style="background:${GREEN};border-radius:9px 9px 0 0;padding:20px 24px;font-family:${FONT};">
    <div style="font-size:19px;font-weight:800;color:#ffffff;">Event Scout</div>
    <div style="font-size:13px;color:#bfe3d6;padding-top:3px;">
      ${esc(formatDay(today, today))} &middot; sent ${esc(istTime)} IST
    </div>
  </td></tr>

  <tr><td style="padding:16px 24px;background:#eef5f2;font-family:${FONT};font-size:13px;color:${MUTED};line-height:1.5;">
    ${esc(sourceStatusLine(input.sourceRuns))}
  </td></tr>

  <tr><td style="padding:0 24px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${body.join('')}
    </table>
  </td></tr>

  <tr><td style="padding:16px 24px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;color:#7d948c;line-height:1.6;">
    Register links go straight to the organiser. You decide whether to register &mdash;
    Event Scout only narrows and ranks, and never registers you for anything.<br>
    <a href="${esc(appUrl())}" style="color:${GREEN};text-decoration:none;font-weight:700;">Open the dashboard</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    `EVENT SCOUT — ${formatDay(today, today)}, sent ${istTime} IST`,
    '',
    sourceStatusLine(input.sourceRuns),
    '',
    ...(input.audio ? [`Spoken summary (${Math.round(input.audio.seconds)}s): ${appUrl()}/listen/${input.audio.digestId}`, ''] : []),
    ...(input.calendar.length
      ? ['ON YOUR CALENDAR', ...input.calendar.map((e) => `  ${e.title} — ${e.city ?? ''} — ${e.registration_deadline ? `closes ${formatDay(e.registration_deadline, today)}` : `event ${formatDay(e.start_date, today)}`}`), '']
      : []),
    ...(ranked.length
      ? ['RANKED FOR YOU', ...ranked.flatMap((e, i) => {
          const u = urgency(e, today);
          return [
            `  ${i + 1}. ${e.title}`,
            `     ${[e.city, formatRange(e.start_date, e.end_date, today), e.format].filter(Boolean).join(' · ')}`,
            ...(e.summary ? [`     ${e.summary}`] : []),
            `     ${u.badge ? `[${u.badge}] ` : ''}${u.line}`,
            `     ${e.source_url}`,
            '',
          ];
        })]
      : ['Nothing new this week. The sources were checked; this is a quiet week, not a failure.', '']),
    ...(alsoFound.length
      ? ['ALSO FOUND (no focus-area match)', ...alsoFound.map((e) => `  ${e.title} — ${e.city ?? ''}`), '']
      : []),
    `You decide whether to register. ${appUrl()}`,
  ].join('\n');

  return {
    subject,
    html,
    text,
    newCount: input.newEvents.length,
    calendarCount: input.calendar.length,
    closingCount: closing,
  };
}

// --------------------------------------------------------------------------
// Sending
// --------------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
  recipient: string;
}

export async function sendDigest(to: string, rendered: RenderedDigest): Promise<SendResult> {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;

  if (!user || !pass) {
    return { ok: false, messageId: null, error: 'SMTP is not configured', recipient: to };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, messageId: null, error: 'recipient is not a valid email address', recipient: to };
  }

  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });

  try {
    const info = await transport.sendMail({
      from: `Event Scout <${user}>`,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    return { ok: true, messageId: info.messageId ?? null, error: null, recipient: to };
  } catch (e) {
    // Never let an SMTP error carry the password back up into a log or a page.
    const raw = e instanceof Error ? e.message : String(e);
    const safe = raw.replace(new RegExp(pass.replace(/\s+/g, ''), 'g'), '***');
    return { ok: false, messageId: null, error: safe, recipient: to };
  }
}
