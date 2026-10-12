import { normaliseTitle, sameEventAcrossSources, mergeDuplicates } from '../src/lib/rank';
import type { ScoutEvent } from '../src/lib/types';
const ev = (o: Partial<ScoutEvent>): ScoutEvent => ({
  source: 'luma', source_url: 'https://x/' + (o.title ?? 'x'), title: 'T',
  start_date: '2026-11-05', end_date: null, city: 'Mumbai', venue: null, format: 'in-person',
  registration_deadline: null, organiser: null, audience_tag: null, summary: null, ...o,
});
const mum = ev({ title: 'Digital Payments Roadshow', source: 'linkedin', city: 'Mumbai' });
const blr = ev({ title: 'Digital Payments Roadshow', source: 'eventbrite', city: 'Bengaluru' });
console.log('cities case -> same?', sameEventAcrossSources(mum, blr), '| merged len', mergeDuplicates([mum, blr]).length);
const a = ev({ title: 'Fintech Summit', source: 'linkedin', city: null });
const b = ev({ title: 'Fintech Conference', source: 'eventbrite', city: null });
console.log('generic case -> normalised:', JSON.stringify(normaliseTitle(a.title)), JSON.stringify(normaliseTitle(b.title)));
console.log('   same?', sameEventAcrossSources(a, b), '| merged len', mergeDuplicates([a, b]).length);
