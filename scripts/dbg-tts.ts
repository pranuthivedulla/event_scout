import { buildDeadlineScript } from '../src/lib/tts';
import type { ScoutEvent } from '../src/lib/types';
const ev = (o: Partial<ScoutEvent>): ScoutEvent => ({
  source: 'luma', source_url: 'https://example.com/e/' + (o.title ?? 'x'), title: 'T',
  start_date: '2026-11-20', end_date: null, city: 'Bengaluru', venue: null,
  format: 'in-person', registration_deadline: null, organiser: null,
  audience_tag: null, summary: null, ...o,
});
const TODAY = '2026-10-12';
const r1 = buildDeadlineScript(
  [ev({ title: 'Swift Bengaluru x Okta', score: 0, start_date: '2026-10-14' }),
   ev({ title: 'Payments Roundtable', score: 4, start_date: '2026-10-15' })], [], TODAY);
console.log('case 1 ->', r1 ? JSON.stringify(r1) : 'null');
const r2 = buildDeadlineScript(
  [ev({ title: '-1 to Swiggy with Nandan Reddy | South Park Commons (BLR)', score: 3, start_date: '2026-10-15' })], [], TODAY);
console.log('\ncase 2 ->', r2 ? r2.text : 'null');
