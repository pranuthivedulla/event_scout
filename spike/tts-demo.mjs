// Generates a sample clip with the CURRENT logic, so the voice and the
// wording can be judged by ear. Uses a realistic urgent+relevant week,
// because the live data has nothing both urgent and relevant right now.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const l of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const k = t.slice(0, t.indexOf('=')).trim();
  if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
}
const { buildDeadlineScript, synthesise } = await import('../src/lib/tts.ts');

const TODAY = '2026-10-12';
const mk = (o) => ({ source: 'luma', source_url: 'https://x/' + o.title, end_date: null,
  venue: null, format: 'in-person', registration_deadline: null, organiser: null,
  audience_tag: null, summary: null, city: 'Mumbai', ...o });

const events = [
  mk({ title: 'Core Banking Modernisation Roundtable', city: 'Bengaluru', score: 5,
       registration_deadline: '2026-10-16', start_date: '2026-10-28' }),
  mk({ title: 'ETBFSI Converge 2026', city: 'Mumbai', score: 5, start_date: '2026-10-17' }),
  mk({ title: 'BitGo x Giottus | Crypto Custody in Action (BLR)', city: 'Bengaluru',
       score: 4, start_date: '2026-10-18' }),
  mk({ title: 'Embedded Swift: From Code to Hardware', city: 'Bengaluru', score: 0,
       start_date: '2026-10-13' }),
];

const script = buildDeadlineScript(events, [], TODAY);
if (!script) { console.log('nothing to say'); process.exit(0); }
console.log(`${script.count} flagged and relevant\n`);
console.log(script.text + '\n');
const spoken = await synthesise(script.text);
writeFileSync(join(ROOT, 'spike', 'out', 'voice-note-sample.wav'), spoken.wav);
console.log(`-> spike/out/voice-note-sample.wav  (${spoken.seconds}s, ${(spoken.wav.length/1024).toFixed(0)} KB)`);
