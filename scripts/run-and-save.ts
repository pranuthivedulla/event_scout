/**
 * Runs the pipeline and saves everything to Neon.
 * This is what the Monday cron route will call, minus the email.
 *
 *   npx tsx scripts/run-and-save.ts
 */

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

const { getSettings, createRun, updateRun, upsertEvents, recordSourceRuns, upcomingEvents } =
  await import('../src/lib/db');
const { runPipeline } = await import('../src/lib/pipeline');
const { todayISO, urgency } = await import('../src/lib/dates');

const today = todayISO();
const settings = await getSettings();
console.log(`Settings from Neon: ${settings.cities.join(', ')} | ${settings.focus_areas.length} focus areas | ${settings.window_days}-day window\n`);

const runId = await createRun('test_send');
console.log(`run #${runId} started\n`);

try {
  const result = await runPipeline(settings, { today, log: (m) => console.log(m) });

  await updateRun(runId, { stage: 'persist' });
  await recordSourceRuns(runId, result.sourceRuns);
  const fresh = await upsertEvents(result.events, runId);
  await updateRun(runId, { stage: 'done', status: 'done', stats: result.stats });

  console.log('\n================ SAVED =================');
  console.log(`  run #${runId}`);
  console.log(`  ${result.events.length} events written, ${fresh.size} of them new`);
  console.log(`  ${result.sourceRuns.length} source results recorded`);
  console.log(`  ${result.stats.tokens} Gemini tokens`);

  const upcoming = await upcomingEvents(10);
  console.log(`\n  Top of the dashboard list, read back from Neon:`);
  upcoming.slice(0, 5).forEach((e, i) => {
    const u = urgency(e, today);
    console.log(`   ${i + 1}. [${e.score ?? '-'}/5] ${String(e.title).slice(0, 44).padEnd(46)} ${e.city ?? '?'} ${e.start_date ?? '?'} ${u.badge ? `[${u.badge}]` : ''}`);
  });
} catch (e) {
  await updateRun(runId, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
  console.error('\nRun failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
