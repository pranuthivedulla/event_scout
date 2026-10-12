import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL!);
const rows = await sql.query(
  `SELECT title, start_date, start_date::text AS as_text FROM events WHERE title LIKE 'ETBFSI%' OR title LIKE 'Structuring%' LIMIT 3`
) as any[];
for (const r of rows) {
  console.log(`${String(r.title).slice(0,28).padEnd(30)}`);
  console.log(`   stored (::text)   : ${r.as_text}`);
  console.log(`   driver returns    : ${typeof r.start_date} ${r.start_date instanceof Date ? '(Date)' : ''} -> ${String(r.start_date)}`);
  if (r.start_date instanceof Date) {
    console.log(`   .toISOString()    : ${r.start_date.toISOString().slice(0,10)}   <-- what asDate() used`);
    console.log(`   local components  : ${r.start_date.getFullYear()}-${String(r.start_date.getMonth()+1).padStart(2,'0')}-${String(r.start_date.getDate()).padStart(2,'0')}`);
  }
}
console.log(`\nprocess TZ offset: UTC${-new Date().getTimezoneOffset()/60}`);
