import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Checks that the environment variables are SHAPED correctly, without ever
 * revealing a value.
 *
 * This exists because a GEMINI_API_KEY pasted into Vercel with a trailing
 * newline dragged the next line of the .env file along with it. The key went
 * into an HTTP header, headers cannot contain newlines, and every Gemini call
 * failed before it left the building — with an error that quoted the pasted
 * text, passcode and all. A malformed paste is invisible in Vercel's UI and
 * was only diagnosable from a stack trace, which is the wrong way to find it.
 *
 * Passcode-gated: lengths and shapes are not secrets, but they are a hint,
 * and this is a public URL.
 */

interface Check {
  name: string;
  present: boolean;
  ok: boolean;
  note: string;
}

function check(
  name: string,
  opts: { required?: boolean; expectLength?: number; startsWith?: string; contains?: string; pattern?: RegExp; allowSpaces?: boolean }
): Check {
  const raw = process.env[name];
  const present = Boolean(raw && raw.length);

  if (!present) {
    return {
      name, present: false,
      ok: opts.required === false,
      note: opts.required === false ? 'empty, which is expected' : 'MISSING',
    };
  }

  const v = raw!;
  const problems: string[] = [];

  // the one that actually bit us
  if (/[\r\n]/.test(v)) problems.push('contains a LINE BREAK — the paste picked up the next line');
  if (v !== v.trim()) problems.push('has leading or trailing whitespace');
  if (!opts.allowSpaces && /\s/.test(v.trim())) problems.push('contains a space in the middle');
  if (/^[A-Z][A-Z0-9_]{3,}=/.test(v)) problems.push('starts with a VARIABLE NAME — the "NAME=" prefix was copied too');
  if (opts.startsWith && !v.startsWith(opts.startsWith)) problems.push(`should start with "${opts.startsWith}"`);
  if (opts.contains && !v.includes(opts.contains)) {
    problems.push(`is missing "${opts.contains}" — it may be truncated`);
  }
  if (opts.pattern && !opts.pattern.test(v)) problems.push('does not look like the right format');
  if (opts.expectLength && v.length !== opts.expectLength) {
    problems.push(`is ${v.length} characters, expected ${opts.expectLength}`);
  }

  return {
    name, present: true,
    ok: problems.length === 0,
    note: problems.length ? problems.join('; ') : `looks right (${v.length} characters)`,
  };
}

export async function GET(req: Request) {
  const expected = process.env.ADMIN_PASSCODE;
  const given = new URL(req.url).searchParams.get('passcode') ?? '';
  if (!expected || given !== expected) {
    return NextResponse.json({ ok: false, message: 'Passcode required.' }, { status: 401 });
  }

  const checks: Check[] = [
    // Neon appends &channel_binding=require after sslmode, so this must be a
    // "contains", not an "ends with" — the stricter rule was a false alarm.
    check('DATABASE_URL', { startsWith: 'postgres', contains: 'sslmode=require' }),
    check('GEMINI_API_KEY', { pattern: /^(AQ\.|AIza)[A-Za-z0-9_-]+$/ }),
    check('SMTP_USER', { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }),
    // Google app passwords are 16 characters, usually shown in four groups
    check('SMTP_APP_PASSWORD', { allowSpaces: true, pattern: /^[a-z\s]{16,19}$/i }),
    check('DIGEST_RECIPIENT', { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }),
    check('ADMIN_PASSCODE', {}),
    check('CRON_SECRET', { pattern: /^[A-Za-z0-9_-]{16,}$/ }),
    check('APIFY_TOKEN', { required: false }),
  ];

  const bad = checks.filter((c) => !c.ok);

  // an actual round trip, so a well-shaped but wrong key still shows up
  let gemini = 'not tested';
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
        'Content-Type': 'application/json',
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify({ model: 'gemini-3.8-flash', input: 'Reply with the single word: ok' }),
    });
    gemini = res.ok ? 'reachable, key accepted' : `rejected with HTTP ${res.status}`;
  } catch {
    // deliberately not echoing the error: that is how the key leaked last time
    gemini = 'the request could not even be built — the key is almost certainly malformed';
  }

  return NextResponse.json({
    ok: bad.length === 0 && gemini === 'reachable, key accepted',
    gemini,
    problems: bad.map((c) => `${c.name}: ${c.note}`),
    checks,
  });
}
