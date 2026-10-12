// How does the current matcher cope with the same event titled differently
// on two platforms? Realistic variations, no API calls.
import { fingerprint, mergeDuplicates } from '../src/lib/rank';
import type { ScoutEvent } from '../src/lib/types';

const ev = (title: string, source: string, start_date: string | null): ScoutEvent => ({
  source, source_url: `https://${source}.example/${encodeURIComponent(title)}`,
  title, start_date, end_date: null, city: 'Mumbai', venue: null, format: 'in-person',
  registration_deadline: null, organiser: null, audience_tag: null, summary: null,
});

const pairs: [string, ScoutEvent, ScoutEvent][] = [
  ['same title, same date',        ev('Digital Payments Summit 2026','linkedin','2026-11-05'), ev('The Digital Payments Summit','eventbrite','2026-11-05')],
  ['venue suffix after a pipe',    ev('ETBFSI Converge 2026','linkedin','2026-12-10'),         ev('ETBFSI Converge 2026 | Jio World Centre','eventbrite','2026-12-10')],
  ['bracketed city suffix',        ev('BFSI Tech Summit','linkedin','2026-11-20'),             ev('BFSI Tech Summit (Mumbai)','eventbrite','2026-11-20')],
  ['one platform has no date',     ev('Core Banking Roundtable','linkedin',null),              ev('Core Banking Roundtable','eventbrite','2026-11-12')],
  ['dates differ by one day',      ev('Fintech Leaders Forum','linkedin','2026-11-05'),        ev('Fintech Leaders Forum','eventbrite','2026-11-06')],
  ['trailing dash subtitle',       ev('NBFC Connect - Day 1','linkedin','2026-11-08'),         ev('NBFC Connect','eventbrite','2026-11-08')],
  ['DIFFERENT events, same series',ev('Startup Mixer','luma','2026-11-05'),                    ev('Startup Mixer','luma','2026-12-05')],
];

console.log('case                              merged?  expected  fingerprints');
for (const [label, a, b] of pairs) {
  const merged = mergeDuplicates([a, b]).length === 1;
  const shouldMerge = !label.startsWith('DIFFERENT');
  const ok = merged === shouldMerge ? '   ' : ' <-';
  console.log(
    `${label.padEnd(33)} ${String(merged).padEnd(8)} ${String(shouldMerge).padEnd(9)}${ok}`
  );
  if (merged !== shouldMerge) {
    console.log(`      a: ${fingerprint(a)}`);
    console.log(`      b: ${fingerprint(b)}`);
  }
}
