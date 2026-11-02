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
const r = await sql.query(`SELECT id, subject, html FROM digests ORDER BY id DESC LIMIT 1`) as any[];
const d = r[0];
const text = String(d.html).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
console.log(`digest #${d.id}: ${d.subject}\n`);
console.log('  contains the LinkedIn event   :', text.includes('National Cooperative Banks Carnival'));
console.log('  credits LinkedIn as the source:', /via\s+linkedin/i.test(text));
console.log('  source status line            :', (text.match(/Sources:[^.]{0,150}\./) || ['not found'])[0].trim());
const pos = text.indexOf('National Cooperative Banks Carnival');
if (pos > 0) console.log('\n  as it appears:\n   ', text.slice(pos - 10, pos + 230).trim());
