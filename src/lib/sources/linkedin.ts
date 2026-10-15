/**
 * LinkedIn, via Apify post search.
 *
 * This replaces an actor that searched LinkedIn EVENTS and returned nothing.
 * Its own log said why — "No public LinkedIn events were found for this
 * input" — and Gemini's own web search agreed: there are no publicly indexed
 * LinkedIn Event objects for BFSI in these cities.
 *
 * That was the wrong object. The roundtable Vikram missed was POSTED on
 * LinkedIn, not published as a LinkedIn Event, and invite-only roundtables
 * usually are. Post search returns those: full text, author, date and URL,
 * in about eight seconds.
 *
 * Posts are not listings, so the pipeline is:
 *   1. Apify searches, with boolean queries built from Settings
 *   2. Plain code discards commentary, recaps and anything with no city
 *   3. Gemini structures what is left  <- §5's fourth job
 *
 * Step 2 matters because most of what a post search returns is congratulation
 * and thought leadership. Paying the model to read all of it would be the
 * same mistake as classifying every newsletter article.
 */

import type { ScoutEvent, Settings } from '../types';
import { structureLinkedInPosts, type LinkedInPost } from '../gemini';
import { CITY_ALIASES } from '@/config';

const ACTOR = process.env.APIFY_ACTOR ?? 'harvestapi~linkedin-post-search';

/** The actor answered in 8s; this is headroom, not an expectation. */
const ACTOR_TIMEOUT_S = 120;
/** Hard cap on billable posts per run. At $1.50/1000 this is about 9 cents. */
const MAX_POSTS = 60;
/**
 * Never hand the model more than this many posts in one run. The gate is
 * deliberately cheap and imperfect; deciding what is actually an event is the
 * model's job, and it needs enough candidates to find the one that matters.
 */
const MAX_TO_MODEL = 14;

/** Advertises a gathering, rather than discussing one. */
const EVENT_WORDS =
  /\b(summit|conference|conclave|roundtable|round table|meetup|forum|expo|symposium|workshop|masterclass|convention|congress|registrations? open|save the date|join us|we are hosting|hosting|will host|to host|invited to|invitation)\b/i;

/**
 * A recap of something that already happened is not an upcoming event.
 * "ElevenLabs held its first India Summit in Bengaluru this week" got through
 * the first version of this, so past-tense verbs are matched too, not just
 * the pleasantries that usually surround them.
 */
const LOOKS_PAST =
  /\b(was (a|an) (great|wonderful|fantastic|insightful)|thank(s| you) (all|everyone|to)|had (a|the) (great|wonderful|privilege)|recap|glimpses|highlights from|yesterday|last (week|month)|concluded|wrapped up|held (its|their|the|on|at)|was held|took place|hosted (its|their|our)|successfully (held|hosted|concluded))\b/i;

/**
 * What a post search returns in volume that is never an event, however often
 * it says "summit". Measured over 80 real posts: job ads for conference staff
 * ("Hiring | Conference Producer, BFSI Tech Innovation Summit"), appointment
 * announcements and published papers were most of what cleared the first gate.
 */
const NOT_AN_EVENT =
  /\b(hiring|we'?re hiring|job (opening|alert)|vacancy|apply now|recruit(ing|ment)?|open position|has been appointed|appointed as|joins us as|research paper|published (on|in)|ieee|congratulations|promoted to|we are looking for)\b/i;

export interface LinkedInResult {
  events: ScoutEvent[];
  fetched: number;
  candidates: number;
  tokens: number;
}

/**
 * Boolean queries from Settings, so changing focus areas or cities changes
 * what LinkedIn is searched for. The actor allows five boolean operators and
 * 500 characters per query, so this stays deliberately small.
 */
export function buildQueries(settings: Settings): string[] {
  // The actor allows FIVE boolean operators per query. An early version used
  // seven and the actor answered every one with nothing; the next used four
  // but spent them all on formats, leaving ONE topic word — "banking" — so a
  // payments roundtable or a BFSI conclave was never fetched at all. The gate
  // downstream is BFSI-wide, but it can only filter what the search returned.
  //
  // Budget per query: (A OR B OR C) AND (D OR E) AND "City" = 5 operators.
  // Three formats, two topics, one city. Two queries per city covers the
  // whole focus list without exceeding the limit on any single one.
  const formats = '("summit" OR "roundtable" OR "conclave")';

  // Distinctive words from the focus areas, highest priority first, plus the
  // sector's own shorthand. "bfsi" never appears in a focus-area name but is
  // what Indian organisers actually title these events.
  const ranked = [...settings.focus_areas].sort(
    (a, b) =>
      (a.level === 'High' ? 0 : a.level === 'Medium' ? 1 : 2) -
      (b.level === 'High' ? 0 : b.level === 'Medium' ? 1 : 2)
  );
  const terms = [
    ...new Set(
      ranked
        .flatMap((f) => f.name.toLowerCase().split(/[^a-z]+/))
        .filter((w) => w.length > 4 && !['large', 'technology', 'digital'].includes(w))
    ),
  ];
  if (!terms.includes('bfsi')) terms.push('bfsi');
  if (!terms.length) terms.push('banking');

  // Pair them up: each pair becomes one query, so every term gets searched.
  const pairs: string[][] = [];
  for (let i = 0; i < terms.length; i += 2) pairs.push(terms.slice(i, i + 2));

  const queries: string[] = [];
  for (const city of settings.cities.slice(0, 3)) {
    for (const pair of pairs) {
      const topic = pair.map((t) => `"${t}"`).join(' OR ');
      queries.push(`${formats} AND (${topic}) AND "${city}"`);
    }
  }
  return queries;
}

function mentionsATargetCity(text: string, cities: string[]): boolean {
  const hay = text.toLowerCase();
  return cities.some((c) => {
    const aliases = CITY_ALIASES[c.toLowerCase()] ?? [c.toLowerCase()];
    return aliases.some((a) => hay.includes(a));
  });
}

/** Worth paying the model to read? */
export function isWorthStructuring(content: string, cities: string[]): boolean {
  if (!content || content.length < 40) return false;
  if (!EVENT_WORDS.test(content)) return false;
  if (LOOKS_PAST.test(content)) return false;
  if (NOT_AN_EVENT.test(content)) return false;
  // Without a city we cannot place it, and the hard filter would drop it anyway.
  return mentionsATargetCity(content, cities);
}

interface ApifyPost {
  linkedinUrl?: string;
  content?: string;
  postedAt?: { date?: string } | string | null;
  author?: { name?: string } | null;
}

async function runActor(queries: string[], token: string): Promise<ApifyPost[]> {
  const started = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}` +
      `&timeout=${ACTOR_TIMEOUT_S}&memory=1024&maxItems=${MAX_POSTS}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchQueries: queries, maxPosts: MAX_POSTS, postedLimit: 'month' }),
    }
  );
  if (!started.ok) throw new Error(`Apify refused the run (${started.status})`);
  const { data } = (await started.json()) as { data: { id: string; defaultDatasetId: string } };

  // Poll rather than block: run-sync-get-dataset-items forces the actor to
  // answer inside one request, and an actor slower than that limit reports as
  // a timeout even when it would have succeeded. That is what made the
  // previous source look broken.
  const deadline = Date.now() + ACTOR_TIMEOUT_S * 1000;
  let status = 'RUNNING';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${data.id}?token=${encodeURIComponent(token)}`);
    if (!res.ok) break;
    status = ((await res.json()) as { data: { status: string } }).data.status;
    if (!['RUNNING', 'READY'].includes(status)) break;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ended as ${status}`);

  const items = await fetch(
    `https://api.apify.com/v2/datasets/${data.defaultDatasetId}/items?token=${encodeURIComponent(token)}&limit=${MAX_POSTS}`
  );
  if (!items.ok) throw new Error('could not read the Apify dataset');
  const json = (await items.json()) as unknown;
  return Array.isArray(json) ? (json as ApifyPost[]) : [];
}

export async function fetchLinkedIn(
  sourceKey: string,
  settings: Settings,
  today: string
): Promise<LinkedInResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('not configured');

  const posts = await runActor(buildQueries(settings), token);

  const candidates: LinkedInPost[] = posts
    .filter((p) => p.linkedinUrl && isWorthStructuring(String(p.content ?? ''), settings.cities))
    .slice(0, MAX_TO_MODEL)
    .map((p) => ({
      url: String(p.linkedinUrl),
      content: String(p.content ?? ''),
      postedAt: typeof p.postedAt === 'object' && p.postedAt ? (p.postedAt.date ?? null) : (p.postedAt ?? null),
      author: p.author?.name ?? null,
    }));

  if (!candidates.length) {
    return { events: [], fetched: posts.length, candidates: 0, tokens: 0 };
  }

  const { events: extracted, tokens } = await structureLinkedInPosts(candidates, today);

  const events: ScoutEvent[] = extracted.map((e) => ({
    source: sourceKey,
    // Register goes to a real registration link when the post gives one; the
    // post the event was actually read FROM is the fallback. Never an index
    // into the candidate list — that mis-attributed events to other people's
    // posts when the model skipped one.
    source_url: e.event_url ?? e.source_post_url,
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
  }));

  return { events, fetched: posts.length, candidates: candidates.length, tokens };
}
