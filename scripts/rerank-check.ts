// Re-ranks the saved live run with the current formula. No API calls.
import { readFileSync } from 'node:fs';
import { rank } from '../src/lib/rank';
import { DEFAULT_CITIES, DEFAULT_FOCUS_AREAS, DEFAULT_WINDOW_DAYS } from '../src/config';
import type { Settings } from '../src/lib/types';

const r = JSON.parse(readFileSync('spike/out/local-run.json', 'utf8'));
const s: Settings = {
  cities: DEFAULT_CITIES, focus_areas: DEFAULT_FOCUS_AREAS,
  extra_sources: [], recipient: '', window_days: DEFAULT_WINDOW_DAYS,
};
rank(r.events, s).forEach((e: any, i: number) =>
  console.log(`  ${String(i + 1).padStart(2)}. [${e.score}/5] ${String(e.title).slice(0, 48).padEnd(50)} | ${e.focus_area || 'no match'}`)
);
