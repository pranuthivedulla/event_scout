// Newsletters are news, not events. How many items per week even MENTION an
// event? That decides whether a feed is worth a Gemini call.
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' };

const EVENTY = /\b(summit|conference|conclave|roundtable|round table|meetup|forum|expo|symposium|workshop|masterclass|convention|congress|fest|awards?\s+night|to\s+host|will\s+host|hosts|announces?\s+(the\s+)?\w*\s*(summit|conference|event)|registrations?\s+open|save\s+the\s+date)\b/i;
const BFSI = /\b(bank|payment|fintech|bfsi|financ|lending|insur|nbfc|credit|wealth|treasur|regtech|upi|capital market)\w*/i;

const feeds = [
  ['ETBFSI',       'https://bfsi.economictimes.indiatimes.com/rss/topstories'],
  ['Medianama',    'https://www.medianama.com/feed/'],
  ['Inc42',        'https://inc42.com/feed/'],
  ['YourStory',    'https://yourstory.com/feed'],
  ['Moneycontrol', 'https://www.moneycontrol.com/rss/business.xml'],
];

const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

let totals = { items: 0, eventy: 0, both: 0 };
for (const [name, url] of feeds) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    const xml = await r.text();
    const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map(m => m[0]);
    let eventy = 0, both = 0;
    const hits = [];
    for (const b of blocks) {
      const title = strip((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]);
      const desc = strip((b.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [, ''])[1]).slice(0, 400);
      const text = `${title} ${desc}`;
      const e = EVENTY.test(text), f = BFSI.test(text);
      if (e) eventy++;
      if (e && f) { both++; hits.push(title.slice(0, 76)); }
    }
    totals.items += blocks.length; totals.eventy += eventy; totals.both += both;
    console.log(`${name.padEnd(14)} ${String(blocks.length).padStart(3)} items  ${String(eventy).padStart(2)} mention an event  ${String(both).padStart(2)} also BFSI`);
    hits.forEach(h => console.log(`     -> ${h}`));
  } catch (e) {
    console.log(`${name.padEnd(14)} FAILED ${String(e.message).slice(0, 40)}`);
  }
}
console.log(`\nTOTAL  ${totals.items} items -> ${totals.eventy} eventy -> ${totals.both} eventy AND BFSI`);
console.log(`Gemini calls if we classified every item : ${totals.items}`);
console.log(`Gemini calls with a plain-code word gate : ${totals.both}`);
