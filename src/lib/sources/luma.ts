/**
 * Luma: the one source with clean structured data.
 *
 * Parsed by plain code from JSON-LD, falling back to __NEXT_DATA__. No model
 * involved, so dates and cities are exact and cost nothing. Luma states no
 * registration deadline — registration stays open until the event begins —
 * so registration_deadline is always null here, correctly.
 */

import { USER_AGENT, DISPLAY_TZ } from '@/config';
import type { EventFormat, ScoutEvent } from '../types';

/** A timestamp from a feed -> the calendar date it falls on in IST. */
export function toDisplayDate(ts: string | null | undefined): string | null {
  if (!ts || typeof ts !== 'string') return null;
  // already a plain date
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function modeToFormat(mode: unknown, locationType?: unknown): EventFormat | null {
  const s = String(mode ?? '').toLowerCase();
  if (s.includes('offline')) return 'in-person';
  if (s.includes('mixed')) return 'hybrid';
  if (s.includes('online')) return 'online';
  const lt = String(locationType ?? '').toLowerCase();
  if (lt === 'offline') return 'in-person';
  if (lt === 'online') return 'online';
  if (lt === 'hybrid') return 'hybrid';
  return null;
}

function extractObject(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
}

type AnyRec = Record<string, unknown>;

/** Walk any JSON-LD shape and collect every @type: Event. */
function eventsFromJsonLd(blocks: unknown[]): AnyRec[] {
  const out: AnyRec[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const rec = o as AnyRec;
    if (/Event/.test(String(rec['@type'] ?? ''))) out.push(rec);
    for (const v of Object.values(rec)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  blocks.forEach(walk);
  return out;
}

export async function fetchLuma(sourceKey: string, url: string): Promise<ScoutEvent[]> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-IN,en;q=0.9' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const out: ScoutEvent[] = [];
  const seen = new Set<string>();

  for (const e of eventsFromJsonLd(jsonLdBlocks(html))) {
    const href = typeof e.url === 'string' ? e.url : null;
    if (!href || seen.has(href)) continue;
    const loc = e.location as AnyRec | undefined;
    const addr = loc?.address as AnyRec | undefined;
    seen.add(href);
    out.push({
      source: sourceKey,
      source_url: href,
      title: String(e.name ?? '').trim(),
      start_date: toDisplayDate(e.startDate as string),
      end_date: toDisplayDate(e.endDate as string),
      city: (addr?.addressLocality as string) ?? (loc?.name as string) ?? null,
      venue: (loc?.name as string) ?? null,
      format: modeToFormat(e.eventAttendanceMode),
      // Luma has no registration-close field. Correctly null, never guessed.
      registration_deadline: null,
      organiser: ((e.organizer as AnyRec)?.name as string) ?? null,
      audience_tag: null,
      summary: null,
    });
  }

  // Fallback: the city pages also carry a richer blob that survives JSON-LD changes.
  if (!out.length) {
    const nd = extractObject(html, '__NEXT_DATA__') as AnyRec | null;
    const found: AnyRec[] = [];
    const walk = (o: unknown, depth = 0) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
      const rec = o as AnyRec;
      if (rec.event && typeof rec.event === 'object') found.push(rec.event as AnyRec);
      for (const v of Object.values(rec)) walk(v, depth + 1);
    };
    walk(nd);
    for (const e of found) {
      const slug = typeof e.url === 'string' ? e.url : null;
      if (!slug) continue;
      const href = /^https?:/.test(slug) ? slug : `https://luma.com/${slug}`;
      if (seen.has(href)) continue;
      seen.add(href);
      const geo = e.geo_address_info as AnyRec | undefined;
      out.push({
        source: sourceKey,
        source_url: href,
        title: String(e.name ?? '').trim(),
        start_date: toDisplayDate(e.start_at as string),
        end_date: toDisplayDate(e.end_at as string),
        city: (geo?.city_state as string) ?? (geo?.city as string) ?? null,
        venue: (geo?.address as string) ?? null,
        format: modeToFormat(null, e.location_type),
        registration_deadline: null,
        organiser: null,
        audience_tag: null,
        summary: null,
      });
    }
  }

  return out.filter((e) => e.title && e.source_url);
}
