// Shows the spoken script WITHOUT calling the TTS API.
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
const { upcomingEvents, calendarEvents } = await import('../src/lib/db');
const { buildDeadlineScript } = await import('../src/lib/tts');
const { todayISO } = await import('../src/lib/dates');
const today = todayISO();
const [events, cal] = await Promise.all([upcomingEvents(60), calendarEvents()]);
const script = buildDeadlineScript(events.slice(0, 15), cal, today);
if (!script) { console.log('No clip would be recorded — nothing urgent AND relevant.'); }
else {
  console.log(`${script.count} flagged and relevant, ~${Math.round(script.text.split(/\s+/).length / 2.6)}s spoken\n`);
  console.log(script.text);
}
