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
const { weeklyActivity, splits, listDigests, calendarEvents, recentSends } = await import('../src/lib/db');
const a = await weeklyActivity(4);
console.log('ACTIVITY CHARTS (what the dashboard draws)');
console.log('  events found per week    :', JSON.stringify(a.found));
console.log('  added to calendar per week:', JSON.stringify(a.added));
console.log('  emails sent per week     :', JSON.stringify(a.sent));
const s = await splits();
console.log('\nSPLITS');
console.log('  by city :', s.byCity.map(r => `${r.label} ${r.value}`).join(', '));
console.log('  by focus:', s.byFocus.map(r => `${r.label} ${r.value}`).join(' | '));
const d = await listDigests(10);
console.log(`\nDIGESTS ARCHIVE: ${d.length}`);
for (const x of d) console.log(`  #${x.id} ${x.sent_at.slice(0,16)} ${x.kind} -> ${x.recipient} (${x.new_count} new, ${x.calendar_count} cal)`);
const c = await calendarEvents();
console.log(`\nON YOUR CALENDAR: ${c.length}`);
for (const e of c) console.log(`  ${e.title} | ${e.city} | ${e.start_date}`);
const l = await recentSends(10);
console.log(`\nSEND LOG: ${l.length}`);
for (const x of l) console.log(`  ${x.at.slice(0,16)} ${x.kind} ${x.result}`);
