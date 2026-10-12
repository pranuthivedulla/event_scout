import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}
const { upcomingEvents, latestSourceRuns } = await import('../src/lib/db');
const evs = await upcomingEvents(60);
console.log('source       score  start_date   deadline     title');
for (const e of evs) {
  console.log(
    `${e.source.slice(0,12).padEnd(13)}${String(e.score ?? '-').padStart(3)}    ${String(e.start_date).padEnd(12)} ${String(e.registration_deadline ?? '—').padEnd(12)} ${String(e.title).slice(0,46)}`
  );
}
console.log('\nsources:');
for (const s of await latestSourceRuns()) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.source.padEnd(20)} ${s.found}`);
