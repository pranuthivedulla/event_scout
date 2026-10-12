import { NextResponse } from 'next/server';
import { saveSettings } from '@/lib/db';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Saving settings needs the admin passcode.
 *
 * Not in the brief, but the dashboard is a public URL: without this, anyone
 * with the link can delete Vikram's cities and quietly empty his digest.
 */
export async function POST(req: Request) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    return NextResponse.json({ ok: false, message: 'Saving is not configured.' }, { status: 503 });
  }

  let body: { passcode?: string; settings?: Settings };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: 'Bad request.' }, { status: 400 }); }

  if (String(body.passcode ?? '') !== expected) {
    return NextResponse.json({ ok: false, message: 'Passcode not accepted.' }, { status: 401 });
  }

  const s = body.settings;
  if (!s) return NextResponse.json({ ok: false, message: 'Nothing to save.' }, { status: 400 });

  const cities = (s.cities ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (!cities.length) {
    return NextResponse.json(
      { ok: false, message: 'Keep at least one city, or every event gets filtered out.' },
      { status: 400 }
    );
  }

  const focus = (s.focus_areas ?? [])
    .map((f) => ({ name: String(f.name).trim(), level: f.level }))
    .filter((f) => f.name && ['High', 'Medium', 'Low'].includes(f.level));

  const sources = (s.extra_sources ?? [])
    .map((x) => ({ label: String(x.label ?? '').trim(), url: String(x.url ?? '').trim() }))
    .filter((x) => /^https?:\/\/.+\..+/.test(x.url));

  const windowDays = Math.min(365, Math.max(7, Number(s.window_days) || 90));
  const recipient = String(s.recipient ?? '').trim();
  if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json({ ok: false, message: 'That recipient is not a valid email address.' }, { status: 400 });
  }

  await saveSettings({ cities, focus_areas: focus, extra_sources: sources, recipient, window_days: windowDays });
  return NextResponse.json({ ok: true });
}
