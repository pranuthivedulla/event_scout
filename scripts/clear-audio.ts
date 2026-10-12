// Removes the stored voice note from a digest, keeping the digest itself.
//   npx tsx scripts/clear-audio.ts <digestId> [...]
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
const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (!ids.length) { console.error('give at least one digest id'); process.exit(1); }

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL!);

const before = await sql.query(
  `SELECT id, audio_seconds, left(coalesce(audio_script,''),70) AS script
     FROM digests WHERE id = ANY($1) AND audio IS NOT NULL`, [ids]) as any[];
if (!before.length) { console.log('nothing to clear'); process.exit(0); }
for (const r of before) console.log(`clearing #${r.id}  ${r.audio_seconds}s  "${r.script}…"`);

await sql.query(
  `UPDATE digests SET audio = NULL, audio_script = NULL, audio_seconds = NULL
    WHERE id = ANY($1)`, [ids]);

const left = await sql.query(`SELECT count(*)::int AS n FROM digests WHERE audio IS NOT NULL`) as any[];
console.log(`\ndone. digests still holding audio: ${left[0].n}`);
