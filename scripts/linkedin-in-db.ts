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
const li = await sql.query(
  `SELECT title, city, start_date::text AS d, registration_deadline::text AS dl, score, source, source_url, link_ok
     FROM events WHERE source LIKE '%linkedin%' ORDER BY start_date`) as any[];
console.log(`LinkedIn events in the database: ${li.length}`);
for (const e of li) {
  console.log(`\n  ${e.title}`);
  console.log(`    ${e.city} | ${e.d} | deadline ${e.dl ?? 'none'} | fit ${e.score ?? '-'}/5 | link_ok ${e.link_ok}`);
  console.log(`    ${e.source_url}`);
}
const d = await sql.query(`SELECT id, sent_at, new_count, calendar_count, kind FROM digests ORDER BY id DESC LIMIT 2`) as any[];
console.log('\nlatest digests:');
for (const x of d) console.log(`  #${x.id} ${String(x.sent_at).slice(0,24)} ${x.kind} (${x.new_count} new)`);
