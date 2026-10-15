// Is the zero honest? Replay the posts we already bought through the current
// gate, show what survives, and ask Gemini about those exact posts.
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
const { isWorthStructuring } = await import('../src/lib/sources/linkedin');
const { structureLinkedInPosts } = await import('../src/lib/gemini');
const { todayISO } = await import('../src/lib/dates');

const cities = ['Bengaluru', 'Mumbai', 'Hyderabad'];
const raw = JSON.parse(readFileSync(join(ROOT, 'spike/out/apify-posts-tuned.json'), 'utf8'));
const posts = raw.flatMap((q: any) => q.keep ?? []);
console.log(`replaying ${posts.length} already-purchased posts\n`);

const keep = posts.filter((p: any) => isWorthStructuring(String(p.content ?? ''), cities));
console.log(`${keep.length} clear the current gate:`);
keep.forEach((p: any, i: number) =>
  console.log(`\n  [${i + 1}] ${String(p.content).replace(/\s+/g, ' ').slice(0, 220)}`)
);

if (!keep.length) { console.log('\nnothing to ask the model about.'); process.exit(0); }

const { events, tokens } = await structureLinkedInPosts(
  keep.slice(0, 10).map((p: any) => ({
    url: p.linkedinUrl, content: String(p.content ?? ''),
    postedAt: p.postedAt?.date ?? null, author: p.author?.name ?? null,
  })),
  todayISO()
);
console.log(`\n\nGemini says: ${events.length} event(s), ${tokens} tokens`);
for (const e of events) console.log(`  - ${e.title} | ${e.city} | ${e.start_date} | ${e.event_url ?? ''}`);
