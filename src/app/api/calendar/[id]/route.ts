import { NextResponse } from 'next/server';
import { getEvent, recordCalendarClick } from '@/lib/db';
import { googleCalendarUrl } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/**
 * Records the "Add to calendar" click, then redirects to a pre-filled Google
 * Calendar entry. No Google Calendar API, no OAuth — a template URL.
 *
 * The click means "interested". It is never treated or displayed as a
 * registration: registration happens on the organiser's own page and this
 * system cannot observe it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: 'bad event id' }, { status: 400 });
  }

  const ev = await getEvent(eventId);
  if (!ev) return NextResponse.json({ error: 'event not found' }, { status: 404 });

  const url = googleCalendarUrl(ev);
  if (!url) {
    return NextResponse.json(
      { error: 'this event has no stated date, so there is nothing to put in a calendar' },
      { status: 409 }
    );
  }

  // Record, but never let a logging failure cost the user the redirect.
  try { await recordCalendarClick(eventId); } catch { /* ignore */ }

  return NextResponse.redirect(url, 302);
}
