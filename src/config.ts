/**
 * Every tunable in one place.
 *
 * Exam rule: the Gemini model id lives in ONE constant and nowhere else.
 */

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
export const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions';
/** Interactions API revision pin. Verified against ai.google.dev, 11 Oct 2026. */
export const GEMINI_API_REVISION = '2026-05-20';

/** Display timezone. Everything is STORED in UTC. */
export const DISPLAY_TZ = 'Asia/Kolkata';

/**
 * How far ahead we look. Raised from the brief's 30 days to 90 after spike 7:
 * 30 days filtered out the single most relevant event the system found
 * (ETBFSI Converge, Mumbai, BFSI, in-person) and the digest went out empty.
 * See DECISIONS.md.
 */
export const DEFAULT_WINDOW_DAYS = 90;

/** Up to 15 NEW events per digest. Carried-over calendar events are NOT capped. */
export const MAX_NEW_EVENTS = 15;

/** Red badge threshold, in days. The brief's number, unchanged. */
export const URGENCY_DAYS = 7;

/**
 * Admin "Send digest now" cap: 10 per day, shared by everyone.
 * The Monday auto-send does NOT consume one and is never blocked by it
 * (components map note 2; the build prompt §7 says otherwise — see DECISIONS.md).
 */
export const DAILY_SEND_CAP = 10;

export type FocusLevel = 'High' | 'Medium' | 'Low';

/** Ranking weights. Focus areas RANK events; they never filter one out. */
export const LEVEL_WEIGHT: Record<FocusLevel, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

export const DEFAULT_CITIES = ['Bengaluru', 'Mumbai', 'Hyderabad'];

export const DEFAULT_FOCUS_AREAS: { name: string; level: FocusLevel }[] = [
  { name: 'Banking and core banking technology', level: 'High' },
  { name: 'Payments and digital payments', level: 'High' },
  { name: 'Fintech and BFSI at large', level: 'Medium' },
];

/**
 * City aliases. A page may say "Bangalore", "Bengaluru, India" or "Navi Mumbai".
 * Matching is substring-based on the normalised form, so these are the roots.
 */
export const CITY_ALIASES: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'bengalooru'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai'],
  hyderabad: ['hyderabad', 'secunderabad', 'cyberabad'],
};

export type SourceKind = 'structured' | 'page' | 'rss' | 'apify';

export interface SourceDef {
  key: string;
  label: string;
  /**
   * structured = code parses embedded JSON (fast, exact, free)
   * page       = Gemini url_context reads prose (organiser sites have no JSON-LD)
   * rss        = feed of articles; events surface as announcements
   * apify      = third-party scraper; optional, must never break the run
   */
  kind: SourceKind;
  url: string;
  /** Built in but off until proven; Settings can enable. */
  enabled: boolean;
}

/**
 * Starting source set: ETBFSI + Nasscom + Luma (decided 11 Oct 2026).
 * Eventbrite is deliberately absent — spike 4 showed its search ignores the
 * query and returns Java-training listings for "banking". See DECISIONS.md.
 * Organiser sites below are built in but disabled; enable one at a time.
 */
export const BUILT_IN_SOURCES: SourceDef[] = [
  { key: 'luma-bengaluru', label: 'Luma Bengaluru', kind: 'structured', url: 'https://luma.com/bengaluru', enabled: true },
  { key: 'luma-mumbai', label: 'Luma Mumbai', kind: 'structured', url: 'https://luma.com/mumbai', enabled: true },
  { key: 'etbfsi', label: 'ETBFSI events', kind: 'page', url: 'https://bfsi.economictimes.indiatimes.com/events', enabled: true },
  { key: 'nasscom', label: 'Nasscom events', kind: 'page', url: 'https://nasscom.in/events', enabled: true },

  // Proven fetchable in spike 6, off until each is checked against real output.
  { key: 'exito', label: 'Exito Media', kind: 'page', url: 'https://www.exito-e.com/upcoming-events', enabled: false },
  { key: 'ubs-forums', label: 'UBS Forums', kind: 'page', url: 'https://www.ubsforums.com/', enabled: false },
  { key: 'entraine', label: 'Entraine', kind: 'page', url: 'https://entraine.com/', enabled: false },
  { key: 'gff', label: 'Global Fintech Fest', kind: 'page', url: 'https://globalfintechfest.com/', enabled: false },
  { key: 'etbfsi-rss', label: 'ETBFSI news feed', kind: 'rss', url: 'https://bfsi.economictimes.indiatimes.com/rss/topstories', enabled: false },

  // Needs APIFY_TOKEN. Absent token = reported as not configured, run continues.
  { key: 'linkedin', label: 'LinkedIn', kind: 'apify', url: '', enabled: false },
];

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
