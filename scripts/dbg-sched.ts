import { parseScheduleText } from '../src/lib/sources/apify';
for (const s of ['Oct 24, 2026','October 24 2026','24 Oct 2026','2026-10-24T18:30:00Z','Thu, Oct 24, 2026, 6:30 PM','Next Thursday evening','Feb 30, 2026'])
  console.log(JSON.stringify(s).padEnd(32), '->', parseScheduleText(s));
