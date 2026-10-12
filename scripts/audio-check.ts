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
const rows = await sql.query(
  `SELECT id, sent_at, kind, audio_seconds, (audio IS NOT NULL) AS has_audio,
          left(coalesce(audio_script,''), 60) AS script
     FROM digests ORDER BY sent_at DESC`) as any[];
for (const r of rows)
  console.log(`  #${r.id}  ${String(r.sent_at).slice(0,16)}  audio=${r.has_audio}  ${r.audio_seconds ?? '-'}s  ${r.script || ''}`);
