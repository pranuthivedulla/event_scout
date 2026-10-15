import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}
const { getSettings } = await import('../src/lib/db');
const { fetchLinkedIn, buildQueries } = await import('../src/lib/sources/linkedin');
const { todayISO } = await import('../src/lib/dates');

const settings = await getSettings();
console.log('queries built from Settings:');
for (const q of buildQueries(settings)) console.log('  ' + q);

const t0 = Date.now();
const r = await fetchLinkedIn('linkedin', settings, todayISO());
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  posts fetched      : ${r.fetched}   (cost ~$${(r.fetched * 0.0015).toFixed(3)})`);
console.log(`  worth structuring  : ${r.candidates}`);
console.log(`  events extracted   : ${r.events.length}`);
console.log(`  gemini tokens      : ${r.tokens}`);
for (const e of r.events) {
  console.log(`\n  ${e.title}`);
  console.log(`    ${e.city ?? '?'} | ${e.start_date ?? 'no date'} | ${e.format ?? '?'} | deadline ${e.registration_deadline ?? 'not stated'}`);
  console.log(`    organiser: ${e.organiser ?? '?'}  audience: ${e.audience_tag ?? '-'}`);
  console.log(`    ${e.source_url}`);
}
writeFileSync(join(ROOT, 'spike', 'out', 'linkedin-live.json'), JSON.stringify(r, null, 2));
