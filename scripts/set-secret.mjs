#!/usr/bin/env node
/**
 * Writes a secret into .env without it appearing anywhere else.
 *
 *   node scripts/set-secret.mjs DATABASE_URL
 *
 * Paste the value when prompted and press Enter. The value is written to .env,
 * which is gitignored. It is never echoed back, never logged, and never
 * printed — you only get a confirmation of its length.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

const ALLOWED = [
  'DATABASE_URL',
  'SMTP_USER',
  'SMTP_APP_PASSWORD',
  'DIGEST_RECIPIENT',
  'GEMINI_API_KEY',
  'APIFY_TOKEN',
  'ADMIN_PASSCODE',
  'CRON_SECRET',
];

const key = process.argv[2];
if (!key || !ALLOWED.includes(key)) {
  console.log('Usage: node scripts/set-secret.mjs <KEY>\n\nKeys you can set:');
  for (const k of ALLOWED) console.log('  ' + k);
  process.exit(key ? 1 : 0);
}

const ENV = join(process.cwd(), '.env');
if (!existsSync(ENV)) {
  console.error('No .env found. Run this from C:\\Users\\vedul\\Projects\\event-scout');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`\nPaste the value for ${key} and press Enter.`);
console.log('(Right-click pastes in most Windows terminals, or Ctrl+Shift+V.)\n');

rl.question(`${key}= `, (answer) => {
  rl.close();

  // strip quotes, stray whitespace, and a pasted "KEY=" prefix
  let value = String(answer).trim();
  value = value.replace(new RegExp(`^${key}\\s*=\\s*`), '');
  value = value.replace(/^['"]|['"]$/g, '').trim();

  if (!value) {
    console.error('\nNothing pasted. .env not changed.');
    process.exit(1);
  }

  const lines = readFileSync(ENV, 'utf8').split(/\r?\n/);
  let replaced = false;
  const out = lines.map((l) => {
    if (l.startsWith(key + '=')) { replaced = true; return `${key}=${value}`; }
    return l;
  });
  if (!replaced) out.push(`${key}=${value}`);
  writeFileSync(ENV, out.join('\n'));

  // confirm WITHOUT revealing the value
  const shape =
    key === 'DATABASE_URL'
      ? `  host looks like: ${(value.match(/@([^/]+)\//) || [, '???'])[1]}\n` +
        `  database name:   ${(value.match(/\/([^/?]+)(\?|$)/) || [, '???'])[1]}\n` +
        `  pooled:          ${value.includes('-pooler') ? 'yes' : 'NO - see note below'}`
      : `  length: ${value.length} characters`;

  console.log(`\n${key} saved to .env (${value.length} chars).`);
  console.log(shape);
  if (key === 'DATABASE_URL' && !value.includes('-pooler')) {
    console.log('\n  Note: this is the DIRECT connection, not the pooled one.');
    console.log('  It will work now but can fail under load on Vercel.');
    console.log('  Switch "Pooled connection" on in Neon and re-run this to replace it.');
  }
});
