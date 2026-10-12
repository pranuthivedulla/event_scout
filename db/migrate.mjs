#!/usr/bin/env node
/**
 * Applies db/schema.sql to the Neon database in DATABASE_URL.
 *
 * Idempotent: every statement is CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
 * NOT EXISTS / ON CONFLICT DO NOTHING, so running it twice is safe and it will
 * not drop anything that already exists.
 *
 *   node db/migrate.mjs            apply
 *   node db/migrate.mjs --check    connect and list tables, change nothing
 *
 * Uses the WebSocket Client rather than the HTTP driver so the whole schema
 * runs as one multi-statement transaction: either all of it lands or none.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, neonConfig } from '@neondatabase/serverless';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Node 18+ has a global WebSocket; the driver needs to be told to use it.
neonConfig.webSocketConstructor = globalThis.WebSocket;

// minimal .env loader; on Vercel the environment is already populated
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
      'Run: node scripts/set-secret.mjs DATABASE_URL\n' +
      'See .env.example.'
  );
  process.exit(1);
}

const check = process.argv.includes('--check');
const client = new Client(url);

const LIST_TABLES = `
  SELECT table_name,
         (SELECT count(*) FROM information_schema.columns c
           WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS cols
  FROM information_schema.tables t
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;

try {
  await client.connect();

  const where = await client.query('SELECT current_database() AS db, version() AS v');
  console.log(`Connected to database "${where.rows[0].db}"`);
  console.log(`  ${String(where.rows[0].v).split(',')[0]}\n`);

  if (check) {
    const { rows } = await client.query(LIST_TABLES);
    if (!rows.length) console.log('No tables yet. Run without --check to create them.');
    else {
      console.log(`${rows.length} tables:`);
      for (const r of rows) console.log(`  ${r.table_name} (${r.cols} columns)`);
    }
  } else {
    const schema = readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8');

    // One transaction: all of it lands, or none of it does.
    await client.query('BEGIN');
    try {
      await client.query(schema);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }

    const { rows } = await client.query(LIST_TABLES);
    console.log(`Schema applied. ${rows.length} tables:`);
    for (const r of rows) console.log(`  ${r.table_name.padEnd(16)} ${r.cols} columns`);

    const s = await client.query('SELECT cities, window_days, jsonb_array_length(focus_areas) AS areas FROM settings WHERE id = 1');
    if (s.rows[0]) {
      const row = s.rows[0];
      console.log(`\nSettings seeded: cities ${row.cities.join(', ')} | ${row.areas} focus areas | ${row.window_days}-day window`);
    }
  }
} catch (e) {
  // never print the connection string, it contains the password
  console.error('\nMigration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
