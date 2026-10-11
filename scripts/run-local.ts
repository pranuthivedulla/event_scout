/**
 * Runs the full pipeline against live sources and prints what came back.
 * No database, no email — just proof the chain produces real events.
 *
 *   npx tsx scripts/run-local.ts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CITIES, DEFAULT_FOCUS_AREAS, DEFAULT_WINDOW_DAYS } from '../src/config';
import { runPipeline } from '../src/lib/pipeline';
import { urgency, formatRange, todayISO } from '../src/lib/dates';
import type { Settings } from '../src/lib/types';

const ROOT = process.cwd();
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim();
  }
}

const settings: Settings = {
  cities: DEFAULT_CITIES,
  focus_areas: DEFAULT_FOCUS_AREAS,
  extra_sources: [],
  recipient: 'local@example.com',
  window_days: DEFAULT_WINDOW_DAYS,
};

async function main() {
const today = todayISO();
console.log(`Event Scout — local run, today is ${today}, window ${settings.window_days} days\n`);

const t0 = Date.now();
const result = await runPipeline(settings, { today, log: (m) => console.log(m) });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n================ SOURCES ================');
for (const s of result.sourceRuns) {
  console.log(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.source.padEnd(22)} ${s.ok ? `${s.found} events` : s.error}`);
}

console.log('\n================ FUNNEL =================');
const st = result.stats;
console.log(`  found ${st.found} -> merged ${st.afterMerge} -> pre-filter ${st.afterPreFilter} -> links ok ${st.afterLinkCheck} -> filtered ${st.afterFilter} -> final ${st.final}`);
console.log(`  dropped: ${JSON.stringify(st.drops)}`);
console.log(`  gemini tokens: ${st.tokens}   wall clock: ${secs}s`);

console.log('\n================ DIGEST =================');
if (!result.events.length) {
  console.log('  No new events this week. The email still sends and says so.');
} else {
  result.events.forEach((e, i) => {
    const u = urgency(e, today);
    console.log(`\n  ${i + 1}. ${e.title}`);
    console.log(`     ${e.city ?? '?'} · ${formatRange(e.start_date, e.end_date, today)} · ${e.format ?? 'format not stated'}${e.audience_tag ? ` · ${e.audience_tag}` : ''}`);
    if (e.summary) console.log(`     ${e.summary}`);
    console.log(`     fit ${e.score ?? '-'}/5 ${e.focus_area ? `(${e.focus_area})` : '(no focus area matched)'} — ${e.reason ?? 'not scored'}`);
    console.log(`     ${u.badge ? `[${u.badge}] ` : ''}${u.line}  ·  via ${e.source}`);
    console.log(`     ${e.source_url}`);
  });
}

mkdirSync(join(ROOT, 'spike', 'out'), { recursive: true });
writeFileSync(join(ROOT, 'spike', 'out', 'local-run.json'), JSON.stringify(result, null, 2));
console.log('\n-> spike/out/local-run.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
