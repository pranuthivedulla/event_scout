// What happens to the two LinkedIn events once the hard filters run?
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
const { getSettings } = await import('../src/lib/db');
const { hardFilter } = await import('../src/lib/filters');
const { urgency, todayISO } = await import('../src/lib/dates');

const r = JSON.parse(readFileSync(join(ROOT, 'spike/out/linkedin-live.json'), 'utf8'));
const settings = await getSettings();
const today = todayISO();
const { kept, dropped } = hardFilter(r.events, settings, today);

console.log(`today ${today}\n`);
for (const e of r.events) {
  const u = urgency(e, today);
  const gone = dropped.find((d: any) => d.event.title === e.title);
  console.log(`  ${e.title}`);
  console.log(`    city ${e.city} | event ${e.start_date} | stated deadline ${e.registration_deadline ?? 'none'}`);
  console.log(`    badge: ${u.badge ?? '(none)'} — ${u.line}`);
  console.log(`    ${gone ? `DROPPED: ${gone.reason}` : 'KEPT, would reach the digest'}\n`);
}
console.log(`kept ${kept.length}, dropped ${dropped.length}`);
