/**
 * Newsletter and industry feeds.
 *
 * These are NEWS feeds, not event listings. Measured across ETBFSI, Medianama,
 * Inc42, YourStory and Moneycontrol in one week: 78 items, one of which so
 * much as mentioned an event, and none of those was a BFSI event. Sending
 * every article to Gemini to ask "is this an event?" would have cost 78 calls
 * a week to find nothing.
 *
 * So the gate is plain code and runs first: an item must mention an event
 * format AND a BFSI term before it costs anything. In a typical week that
 * leaves zero items and the source costs nothing. When a feed does carry
 * "X announces its summit on Y", Gemini reads that one article.
 *
 * Nothing here parses a date. An article's publication date is not an event
 * date, and guessing one would break rule 6. Gemini reads the article and
 * returns a date only if the article states one.
 */

import { USER_AGENT } from '@/config';
import type { ScoutEvent, Settings } from '../types';
import { extractFromListing } from '../gemini';

/** Words that suggest an item is about a gathering rather than a news story. */
const EVENT_WORDS =
  /\b(summit|conference|conclave|roundtable|round table|meetup|forum|expo|symposium|workshop|masterclass|convention|congress|awards?\s+night|to\s+host|will\s+host|hosting|registrations?\s+open|save\s+the\s+date)\b/i;

/** At most this many articles per feed per run reach the model. */
const MAX_CANDIDATES = 4;

interface FeedItem {
  title: string;
  link: string;
  text: string;
}

const strip = (s: string): string =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pick = (block: string, tag: string): string => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? strip(m[1]) : '';
};

/** Parse RSS and Atom alike, in plain code. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out: FeedItem[] = [];

  for (const b of blocks) {
    const title = pick(b, 'title');
    // RSS puts the URL in <link>text</link>; Atom puts it in href=""
    const link =
      pick(b, 'link') ||
      (b.match(/<link[^>]+href=["']([^"']+)["']/i) || [, ''])[1] ||
      '';
    const body = `${pick(b, 'description')} ${pick(b, 'summary')} ${pick(b, 'content:encoded')}`.slice(0, 600);
    if (title && /^https?:\/\//.test(link)) {
      out.push({ title, link, text: `${title} ${body}` });
    }
  }
  return out;
}

/** Does this article plausibly announce an event in one of the focus areas? */
export function looksLikeAnEvent(text: string, settings: Settings): boolean {
  if (!EVENT_WORDS.test(text)) return false;

  // Build the topic test from the configured focus areas rather than hard-coding
  // it, so editing Settings changes what the feeds are scanned for.
  const terms = settings.focus_areas
    .flatMap((f) => f.name.toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length > 3 && !['and', 'the', 'large', 'core'].includes(w));
  const topic = terms.length
    ? new RegExp(`\\b(${terms.join('|')})`, 'i')
    : /\b(bank|payment|fintech|bfsi|financ)/i;

  return topic.test(text);
}

export async function fetchRss(
  sourceKey: string,
  url: string,
  today: string,
  settings: Settings
): Promise<{ events: ScoutEvent[]; scanned: number; candidates: number; tokens: number }> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const items = parseFeed(await res.text());
  const candidates = items
    .filter((i) => looksLikeAnEvent(i.text, settings))
    .slice(0, MAX_CANDIDATES);

  // The usual week: nothing survives the gate and the model is never called.
  if (!candidates.length) {
    return { events: [], scanned: items.length, candidates: 0, tokens: 0 };
  }

  const events: ScoutEvent[] = [];
  let tokens = 0;

  for (const c of candidates) {
    try {
      const r = await extractFromListing(c.link, today);
      tokens += r.tokens;
      for (const e of r.events) {
        if (!e.title) continue;
        events.push({
          source: sourceKey,
          // the article is the source link unless it names the event's own page
          source_url: e.event_url ?? c.link,
          title: e.title,
          start_date: e.start_date,
          end_date: e.end_date,
          city: e.city,
          venue: e.venue,
          format: e.format,
          registration_deadline: e.registration_deadline,
          organiser: e.organiser,
          audience_tag: e.audience_tag,
          summary: null,
        });
      }
    } catch {
      // One unreadable article must not cost the whole feed.
    }
  }

  return { events, scanned: items.length, candidates: candidates.length, tokens };
}
