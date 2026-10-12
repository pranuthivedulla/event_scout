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
const { upcomingEvents } = await import('../src/lib/db');
const { mergeDuplicates, normaliseTitle } = await import('../src/lib/rank');
const evs = await upcomingEvents(200);
const merged = mergeDuplicates(evs);
console.log(`  ${evs.length} stored -> ${merged.length} after merge (${evs.length - merged.length} collapsed)`);
const multi = merged.filter(e => String(e.source).includes(','));
console.log(`  events credited to more than one source: ${multi.length}`);
for (const m of multi) console.log(`    ${m.title.slice(0,46)} <- ${m.source}`);
const byTitle = new Map<string, number>();
for (const e of evs) byTitle.set(normaliseTitle(e.title), (byTitle.get(normaliseTitle(e.title)) ?? 0) + 1);
const collide = [...byTitle].filter(([, n]) => n > 1);
console.log(`  normalised titles appearing more than once: ${collide.length}`);
for (const [t, n] of collide) console.log(`    "${t}" x${n}`);
