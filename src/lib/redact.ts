/**
 * Strips secrets out of anything that might be shown, logged or stored.
 *
 * The brief: "Never put keys, the passcode, or the SMTP password in the repo,
 * logs, client bundle or error messages."
 *
 * This exists because that rule was broken in production. A GEMINI_API_KEY
 * pasted into Vercel with a trailing newline carried the next line of the
 * .env file with it, so fetch() threw "Headers.append: <key>\nADMIN_PASSCODE=
 * ... is an invalid header value" — and the raw message went into the HTTP
 * response, into source_runs, and would have gone into the digest email.
 *
 * Nothing that came from an exception is safe to display. Everything that
 * might reach a human goes through here first.
 */

const SECRET_VARS = [
  'GEMINI_API_KEY',
  'DATABASE_URL',
  'SMTP_APP_PASSWORD',
  'SMTP_USER',
  'ADMIN_PASSCODE',
  'CRON_SECRET',
  'APIFY_TOKEN',
] as const;

/** Values short enough to appear by coincidence are matched too literally. */
const MIN_LEN = 6;

export function redactSecrets(input: unknown): string {
  let text = input instanceof Error ? input.message : String(input ?? '');

  for (const name of SECRET_VARS) {
    const value = process.env[name];
    if (!value || value.length < MIN_LEN) continue;

    // the value itself, and the whitespace-stripped form we actually use
    for (const variant of new Set([value, value.replace(/\s+/g, '')])) {
      if (variant.length < MIN_LEN) continue;
      text = text.split(variant).join(`[${name} redacted]`);
    }

    // a connection string also leaks its password on its own
    if (name === 'DATABASE_URL') {
      const pw = value.match(/\/\/[^:]+:([^@]+)@/)?.[1];
      if (pw && pw.length >= MIN_LEN) text = text.split(pw).join('[password redacted]');
    }
  }

  // Belt and braces: anything shaped like a key, even one we do not hold.
  text = text
    .replace(/\bAQ\.[A-Za-z0-9_-]{10,}/g, '[key redacted]')
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, '[key redacted]')
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, '[connection string redacted]')
    // "SOMETHING_SECRET=value" smuggled in by a bad paste
    .replace(/\b([A-Z][A-Z0-9_]{3,})=\S+/g, '$1=[redacted]');

  return text;
}

/** A short, safe one-liner for display. */
export function safeMessage(input: unknown, max = 200): string {
  const t = redactSecrets(input).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
