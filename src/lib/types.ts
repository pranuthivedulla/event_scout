import type { FocusLevel } from '@/config';

export type EventFormat = 'in-person' | 'hybrid' | 'online';

/** One event, as it exists anywhere in the system. */
export interface ScoutEvent {
  id?: number;
  /** Source key from BUILT_IN_SOURCES, or a user-added source. */
  source: string;
  /** The organiser's own page. Register links go straight here. */
  source_url: string;
  title: string;
  /** ISO yyyy-mm-dd. Null means the page did not state one. */
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  venue: string | null;
  format: EventFormat | null;
  /**
   * ISO yyyy-mm-dd, and ONLY if a page explicitly stated a registration or
   * early-bird closing date. Never the event date, never inferred.
   * Fifteen sites were checked and almost none state one. See DECISIONS.md.
   */
  registration_deadline: string | null;
  organiser: string | null;
  /** Only when the page names its audience. Never inferred from the topic. */
  audience_tag: string | null;
  /** Gemini's two-line summary. */
  summary: string | null;

  // --- set by the scoring step ---
  /** 0-5 fit, from Gemini. */
  score?: number | null;
  /** One-line reason, from Gemini. */
  reason?: string | null;
  /** Which configured focus area it matched, verbatim, or null. */
  focus_area?: string | null;

  // --- set by code ---
  /** Deterministic rank value computed in code, never by the model. */
  rank_value?: number;
  /** HTTP check result. An event with link_ok === false is never shown. */
  link_ok?: boolean;
  link_status?: number | null;
  /** Stable hash used for duplicate detection and "is this new?". */
  fingerprint?: string;
  first_seen?: string;
}

export interface Settings {
  cities: string[];
  focus_areas: { name: string; level: FocusLevel }[];
  /** User-added organiser URLs, read every Monday alongside the built-ins. */
  extra_sources: { label: string; url: string }[];
  recipient: string;
  window_days: number;
}

export interface SourceRun {
  source: string;
  ok: boolean;
  error: string | null;
  found: number;
  ran_at: string;
}

/**
 * What drives the red badge.
 *
 * 'deadline'   a page actually stated a registration deadline  -> "Closes in N days"
 * 'event-date' no deadline was stated anywhere                 -> "Event in N days"
 *
 * These two must never be shown with the same wording. The system cannot claim
 * a registration closes when no source said so.
 */
export interface Urgency {
  kind: 'deadline' | 'event-date' | 'none';
  days: number | null;
  flagged: boolean;
  /** Red badge text, or null when nothing is urgent. */
  badge: string | null;
  /** The always-shown plain line, e.g. "Deadline unknown". */
  line: string;
}
