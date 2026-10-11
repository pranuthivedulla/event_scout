/**
 * 'page' sources: organiser and industry sites that carry no structured data.
 *
 * Spike 6 checked Exito, UBS Forums, Entraine, ETBFSI, Nasscom and others:
 * zero JSON-LD between them, dates in prose. Code cannot parse these, so
 * Gemini url_context reads them — which is the brief's original §5 design and
 * is the right tool for exactly these sources.
 */

import { extractFromListing } from '../gemini';
import type { ScoutEvent } from '../types';

/** Resolve a possibly relative href against the listing page. */
function absolutise(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export async function fetchPageSource(
  sourceKey: string,
  url: string,
  today: string
): Promise<{ events: ScoutEvent[]; readable: boolean; tokens: number }> {
  const { events, readable, tokens } = await extractFromListing(url, today);

  const out: ScoutEvent[] = events
    .filter((e) => e.title)
    .map((e) => ({
      source: sourceKey,
      // If the model gave no link for the event, the listing page itself is a
      // real, working source link to where it was found. It is never fabricated,
      // and the link check still has to pass.
      source_url: absolutise(e.event_url, url) ?? url,
      title: e.title.trim(),
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

  return { events: out, readable, tokens };
}
