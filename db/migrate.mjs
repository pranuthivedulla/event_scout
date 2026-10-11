#!/usr/bin/env node
/**
 * Applies db/schema.sql to the Neon database in DATABASE_URL.
 *
 * Idempotent: every statement is CREATE TABLE IF NOT EXISTS / ON CONFLICT DO
 * NOTHING, so running it twice is safe and running it against an existing
 * database will not drop anything.
 *
 *   node db/migrate.mjs            apply
 *   node db/migrate.mjs --check    connect and list tables, change nothing
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// minimal .env loader; the app itself uses Vercel's env, this is for local use
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    const v = t.slice(t.indexOf('=') + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Create a Neon project, copy its connection string into .env, then re-run.\n' +
      'See .env.example.'
  );
  process.exit(1);
}

const sql = neon(url);
const check = process.argv.includes('--check');

/** Split on semicolons that are not inside a quoted string or a dollar-quote. */
function statements(text) {
  const out = [];
  let buf = '';
  let inLine = false, inBlock = false, quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; buf += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (!quote && c === '-' && n === '-') { inLine = true; continue; }
    if (!quote && c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (quote) { buf += c; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; buf += c; continue; }
    if (c === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const listTables = async () => {
  const rows = await sql`
    SELECT table_name,
           (SELECT count(*) FROM information_schema.columns c
             WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS cols
    FROM information_schema.tables t
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  return rows;
};

try {
  if (check) {
    const rows = await listTables();
    console.log(rows.length ? 'Tables present:' : 'No tables yet. Run without --check to create them.');
    for (const r of rows) console.log(`  ${r.table_name} (${r.cols} columns)`);
    process.exit(0);
  }

  const schema = readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8');
  const stmts = statements(schema);
  console.log(`Applying ${stmts.length} statements...`);

  for (const [i, s] of stmts.entries()) {
    const label = s.replace(/\s+/g, ' ').slice(0, 68);
    try {
      await sql.query(s);
      console.log(`  ${String(i + 1).padStart(2)}. ok   ${label}`);
    } catch (e) {
      console.error(`  ${String(i + 1).padStart(2)}. FAIL ${label}\n      ${e.message}`);
      throw e;
    }
  }

  const rows = await listTables();
  console.log(`\nDone. ${rows.length} tables:`);
  for (const r of rows) console.log(`  ${r.table_name} (${r.cols} columns)`);
} catch (e) {
  // never print the connection string, it contains the password
  console.error('\nMigration failed:', e.message);
  process.exit(1);
}
