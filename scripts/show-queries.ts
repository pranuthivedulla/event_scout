import { buildQueries } from '../src/lib/sources/linkedin';
import { DEFAULT_CITIES, DEFAULT_FOCUS_AREAS, DEFAULT_WINDOW_DAYS } from '../src/config';
const s = { cities: DEFAULT_CITIES, focus_areas: DEFAULT_FOCUS_AREAS, extra_sources: [], recipient: '', window_days: DEFAULT_WINDOW_DAYS };
const qs = buildQueries(s);
console.log(`${qs.length} queries:\n`);
for (const q of qs) {
  const ops = (q.match(/\b(AND|OR|NOT)\b/g) ?? []).length;
  console.log(`  [${ops} ops] ${q}`);
}
const covered = new Set<string>();
for (const q of qs) for (const m of q.matchAll(/"([a-z]+)"/g)) covered.add(m[1]);
console.log(`\ntopic words searched: ${[...covered].filter(w => !['summit','roundtable','conclave'].includes(w) && !DEFAULT_CITIES.map(c=>c.toLowerCase()).includes(w)).join(', ')}`);
