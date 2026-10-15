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
  `SELECT id, audio_seconds, audio_script, (audio IS NOT NULL) AS has_audio FROM digests WHERE id = 6`
) as any[];
const d = rows[0];
console.log(`digest #6  audio=${d?.has_audio}  ${d?.audio_seconds ?? '-'}s`);
if (d?.audio_script) console.log(`\nTRANSCRIPT\n  ${d.audio_script}`);

const ev = await sql.query(
  `SELECT title, city, start_date::text AS d, score, source, registration_deadline::text AS dl
     FROM events WHERE start_date >= CURRENT_DATE
     ORDER BY rank_value DESC NULLS LAST, start_date LIMIT 6`) as any[];
console.log('\nTOP OF THE DIGEST');
for (const e of ev) console.log(`  [${e.score ?? '-'}/5] ${String(e.title).slice(0,44).padEnd(46)} ${e.city} ${e.d} via ${e.source}`);
const li = await sql.query(`SELECT title, city, start_date::text AS d FROM events WHERE source LIKE '%linkedin%'`) as any[];
console.log(`\nfrom LinkedIn in the database: ${li.length}`);
for (const e of li) console.log(`  ${e.title} | ${e.city} | ${e.d}`);
