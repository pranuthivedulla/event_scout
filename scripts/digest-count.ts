import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL!);
const n = await sql.query(`SELECT count(*)::int AS n, max(id) AS newest FROM digests`) as any[];
console.log(`digests: ${n[0].n} rows, newest id ${n[0].newest}`);
const r = await sql.query(
  `SELECT id, to_char(sent_at AT TIME ZONE 'Asia/Kolkata','DD Mon HH24:MI') AS t, kind, new_count,
          (audio IS NOT NULL) AS audio
     FROM digests ORDER BY id DESC LIMIT 4`) as any[];
for (const x of r) console.log(`  #${x.id} ${x.t} ${x.kind} ${x.new_count} new audio=${x.audio}`);
