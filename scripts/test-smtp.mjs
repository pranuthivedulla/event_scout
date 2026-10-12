#!/usr/bin/env node
/**
 * Checks SMTP credentials WITHOUT sending anything.
 *
 *   node scripts/test-smtp.mjs
 *
 * Looks up the domain's MX records first (so we know whether smtp.gmail.com
 * is even the right server), then authenticates. Never prints the password,
 * and scrubs it from any error text before showing it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';

const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}

const user = process.env.SMTP_USER ?? '';
const raw = process.env.SMTP_APP_PASSWORD ?? '';
const pass = raw.replace(/\s+/g, '');

if (!user || !pass) {
  console.error('SMTP_USER or SMTP_APP_PASSWORD is empty in .env');
  process.exit(1);
}

const scrub = (s) => String(s).split(pass).join('***').split(raw).join('***');
const domain = user.split('@')[1] ?? '';

console.log(`account : ${user.replace(/^(.{2}).*(@.*)$/, '$1***$2')}`);
console.log(`password: ${pass.length} characters (a Google app password is 16)\n`);

// --- who actually handles mail for this domain? ----------------------------
let provider = 'unknown';
try {
  const mx = await dns.resolveMx(domain);
  mx.sort((a, b) => a.priority - b.priority);
  console.log(`MX records for ${domain}:`);
  for (const r of mx) console.log(`  ${String(r.priority).padStart(3)}  ${r.exchange}`);
  const all = mx.map((m) => m.exchange.toLowerCase()).join(' ');
  if (/google|googlemail/.test(all)) provider = 'google';
  else if (/outlook|microsoft|protection\.outlook/.test(all)) provider = 'microsoft';
  else if (/zoho/.test(all)) provider = 'zoho';
  console.log(`\n  -> mail is handled by: ${provider}`);
  if (provider !== 'google') {
    console.log('  -> smtp.gmail.com is NOT the right server for this domain.');
  }
} catch (e) {
  console.log(`MX lookup failed for ${domain}: ${e.message}`);
}

// --- try to authenticate ---------------------------------------------------
const hosts = provider === 'microsoft'
  ? [['smtp.office365.com', 587, false]]
  : provider === 'zoho'
  ? [['smtp.zoho.in', 465, true], ['smtp.zoho.com', 465, true]]
  : [['smtp.gmail.com', 465, true], ['smtp.gmail.com', 587, false]];

for (const [host, port, secure] of hosts) {
  process.stdout.write(`\nauthenticating against ${host}:${port} ... `);
  const transport = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await transport.verify();
    console.log('OK — credentials accepted, nothing sent.');
    console.log(`\nUse host=${host} port=${port} secure=${secure}`);
    process.exit(0);
  } catch (e) {
    console.log('FAILED');
    console.log(`  ${scrub(e.message).split('\n')[0]}`);
    if (e.responseCode) console.log(`  SMTP code: ${e.responseCode}`);
  } finally {
    transport.close();
  }
}

console.log('\nNo host accepted these credentials.');
process.exit(2);
