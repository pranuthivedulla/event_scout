// One-off: remove a leaked secret from stored error text.
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

const before = await sql.query(
  `SELECT count(*)::int AS n FROM source_runs WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`
) as any[];
console.log(`source_runs rows holding a secret: ${before[0].n}`);

await sql.query(
  `UPDATE source_runs
      SET error = 'Gemini call failed (original message withheld: it contained a secret)'
    WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`
);
const r2 = await sql.query(
  `SELECT count(*)::int AS n FROM runs WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`
) as any[];
if (r2[0].n) {
  await sql.query(`UPDATE runs SET error = '[withheld: contained a secret]' WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`);
}
const r3 = await sql.query(
  `SELECT count(*)::int AS n FROM send_log WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`
) as any[];
if (r3[0].n) {
  await sql.query(`UPDATE send_log SET error = '[withheld: contained a secret]' WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%'`);
}
const after = await sql.query(
  `SELECT (SELECT count(*) FROM source_runs WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%')
        + (SELECT count(*) FROM runs        WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%')
        + (SELECT count(*) FROM send_log    WHERE error ILIKE '%ADMIN_PASSCODE%' OR error ILIKE '%AQ.%') AS n`
) as any[];
console.log(`remaining anywhere: ${after[0].n}`);
