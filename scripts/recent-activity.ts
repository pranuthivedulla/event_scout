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
const d = await sql.query(
  `SELECT id, to_char(sent_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS t, kind, recipient, new_count
     FROM digests ORDER BY sent_at DESC LIMIT 8`) as any[];
console.log('DIGESTS SENT (IST)');
for (const x of d) console.log(`  #${x.id}  ${x.t}  ${x.kind.padEnd(12)} ${x.new_count} new  -> ${x.recipient}`);
const r = await sql.query(
  `SELECT id, kind, status, stage, to_char(started_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS t, error
     FROM runs ORDER BY started_at DESC LIMIT 8`) as any[];
console.log('\nRUNS (IST)');
for (const x of r) console.log(`  #${x.id}  ${x.t}  ${x.kind.padEnd(12)} ${x.status.padEnd(7)} ${x.stage}${x.error? '  ERR '+String(x.error).slice(0,50):''}`);
