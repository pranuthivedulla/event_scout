// Re-scores events already in Neon. No fetching, no enrichment.
// Used to restore scores wiped by a run that could not reach Gemini.
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
const { getSettings, upcomingEvents, upsertEvents, createRun, updateRun } = await import('../src/lib/db');
const { stageScore } = await import('../src/lib/pipeline');
const { rank } = await import('../src/lib/rank');
const { todayISO } = await import('../src/lib/dates');

const today = todayISO();
const settings = await getSettings();
const events = await upcomingEvents(200);
console.log(`${events.length} events in Neon, re-scoring...\n`);

const runId = await createRun('test_send');
const scored = await stageScore(events, settings, 10, (m) => console.log(m));
const ranked = rank(scored.events, settings, today);
await upsertEvents(ranked, runId);
await updateRun(runId, { stage: 'done', status: 'done', stats: { rescore: true, tokens: scored.tokens } });

const after = await upcomingEvents(200);
const dist: Record<string, number> = {};
for (const e of after) dist[String(e.score ?? 'null')] = (dist[String(e.score ?? 'null')] ?? 0) + 1;
console.log(`\ntokens: ${scored.tokens}`);
console.log('score distribution:', JSON.stringify(dist));
console.log('\ntop 5:');
for (const e of after.slice(0, 5))
  console.log(`  [${e.score ?? '-'}/5] ${String(e.title).slice(0, 44).padEnd(46)} ${e.focus_area ?? 'no match'}`);
