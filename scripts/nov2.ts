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
const runs = await sql.query(
  `SELECT id, to_char(started_at AT TIME ZONE 'Asia/Kolkata','DD Mon HH24:MI') AS t,
          status, stage, error, stats
     FROM runs WHERE started_at > now() - interval '3 days' ORDER BY started_at`) as any[];
console.log('RUNS in the last 3 days');
for (const r of runs) {
  const s = r.stats ?? {};
  console.log(`  #${r.id} ${r.t} ${r.status}/${r.stage} dryRun=${s.dryRun ?? false} found=${s.found ?? '-'} final=${s.final ?? '-'}${r.error ? '  ERR '+r.error : ''}`);
}
const log = await sql.query(
  `SELECT to_char(at AT TIME ZONE 'Asia/Kolkata','DD Mon HH24:MI') AS t, kind, result, recipient, error
     FROM send_log WHERE at > now() - interval '3 days' ORDER BY at`) as any[];
console.log(`\nSEND LOG in the last 3 days: ${log.length} entries`);
for (const l of log) console.log(`  ${l.t} ${l.kind} ${l.result}${l.error ? ' — '+String(l.error).slice(0,70) : ''} ${l.recipient ?? ''}`);
