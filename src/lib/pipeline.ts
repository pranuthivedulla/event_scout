/**
 * The Monday run, as discrete stages.
 *
 * Each stage is small enough to finish inside a Vercel Hobby function and
 * hands its output to the next, so the cron route can chain them with progress
 * saved to Neon in between. Nothing here filters, ranks or does date
 * arithmetic with a model — that is all plain code in filters.ts / rank.ts /
 * dates.ts, covered by tests.
 */

import { BUILT_IN_SOURCES, MAX_NEW_EVENTS, type SourceDef } from '@/config';
import type { ScoutEvent, Settings, SourceRun } from './types';
import { todayISO } from './dates';
import { hardFilter, dropSummary, type FilterResult } from './filters';
import { mergeDuplicates, rank, applyCap, fingerprint } from './rank';
import { fetchLuma } from './sources/luma';
import { fetchPageSource } from './sources/page';
import { checkLinks } from './linkcheck';
import { enrichEvents, scoreEvents } from './gemini';

export interface PipelineStats {
  found: number;
  afterMerge: number;
  afterPreFilter: number;
  afterLinkCheck: number;
  afterFilter: number;
  final: number;
  tokens: number;
  drops: Record<string, number>;
}

export interface PipelineResult {
  events: ScoutEvent[];
  sourceRuns: SourceRun[];
  stats: PipelineStats;
}

type Log = (msg: string) => void;

/** Sources enabled in config, plus whatever Vikram added in Settings. */
export function activeSources(settings: Settings): SourceDef[] {
  const builtIn = BUILT_IN_SOURCES.filter((s) => s.enabled);
  const extra: SourceDef[] = (settings.extra_sources ?? [])
    .filter((s) => s?.url)
    .map((s, i) => ({
      key: `custom-${i + 1}`,
      label: s.label || s.url,
      kind: 'page' as const,
      url: s.url,
      enabled: true,
    }));
  return [...builtIn, ...extra];
}

// -------------------------------------------------------------- stage: fetch

export async function stageFetch(
  settings: Settings,
  today: string,
  log: Log = () => {}
): Promise<{ events: ScoutEvent[]; sourceRuns: SourceRun[]; tokens: number }> {
  const sources = activeSources(settings);
  const events: ScoutEvent[] = [];
  const sourceRuns: SourceRun[] = [];
  let tokens = 0;

  for (const src of sources) {
    const ran_at = new Date().toISOString();
    try {
      if (src.kind === 'apify') {
        // LinkedIn. Deferred until APIFY_TOKEN exists. Reported, never fatal.
        if (!process.env.APIFY_TOKEN) {
          sourceRuns.push({ source: src.label, ok: false, error: 'not configured', found: 0, ran_at });
          log(`  ${src.label}: not configured`);
          continue;
        }
        sourceRuns.push({ source: src.label, ok: false, error: 'not implemented yet', found: 0, ran_at });
        continue;
      }

      let found: ScoutEvent[] = [];
      if (src.kind === 'structured') {
        found = await fetchLuma(src.key, src.url);
      } else if (src.kind === 'page') {
        const r = await fetchPageSource(src.key, src.url, today);
        tokens += r.tokens;
        if (!r.readable) throw new Error('page could not be read');
        found = r.events;
      } else {
        sourceRuns.push({ source: src.label, ok: false, error: 'source kind not implemented', found: 0, ran_at });
        continue;
      }

      events.push(...found);
      sourceRuns.push({ source: src.label, ok: true, error: null, found: found.length, ran_at });
      log(`  ${src.label}: ${found.length} events`);
    } catch (e) {
      // A failing source must never break the run. It is reported instead.
      const msg = e instanceof Error ? e.message : String(e);
      sourceRuns.push({ source: src.label, ok: false, error: msg, found: 0, ran_at });
      log(`  ${src.label}: FAILED (${msg})`);
    }
  }

  return { events, sourceRuns, tokens };
}

// ---------------------------------------------------------- stage: linkcheck

export async function stageLinkCheck(events: ScoutEvent[], log: Log = () => {}): Promise<ScoutEvent[]> {
  const results = await checkLinks(events.map((e) => e.source_url));
  let dead = 0;
  const out = events.map((e) => {
    const r = results.get(e.source_url);
    if (r && !r.ok) dead++;
    return {
      ...e,
      // follow redirects: lu.ma/x -> luma.com/x
      source_url: r?.ok && r.finalUrl ? r.finalUrl : e.source_url,
      link_ok: r ? r.ok : false,
      link_status: r?.status ?? null,
    };
  });
  log(`  ${dead} of ${events.length} source links did not resolve`);
  return out;
}

// ------------------------------------------------------------- stage: enrich

export async function stageEnrich(
  events: ScoutEvent[],
  today: string,
  batchSize = 4,
  log: Log = () => {}
): Promise<{ events: ScoutEvent[]; tokens: number }> {
  let tokens = 0;
  const byUrl = new Map(events.map((e) => [e.source_url, { ...e }]));

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    try {
      const { enrichments, tokens: t } = await enrichEvents(batch, today);
      tokens += t;
      for (const en of enrichments) {
        const target = byUrl.get(en.source_url);
        if (!target) continue;
        target.summary = en.summary ?? target.summary;
        target.audience_tag = en.audience_tag ?? target.audience_tag;
        // a deadline is only ever ADDED, never overwritten with null
        if (en.registration_deadline) target.registration_deadline = en.registration_deadline;
        target.format = target.format ?? en.format;
        target.city = target.city ?? en.city;
      }
      log(`  enriched ${Math.min(i + batchSize, events.length)}/${events.length}`);
    } catch (e) {
      // Enrichment is additive. Losing a batch costs summaries, not events.
      log(`  enrich batch ${i / batchSize + 1} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { events: [...byUrl.values()], tokens };
}

// -------------------------------------------------------------- stage: score

export async function stageScore(
  events: ScoutEvent[],
  settings: Settings,
  batchSize = 10,
  log: Log = () => {}
): Promise<{ events: ScoutEvent[]; tokens: number }> {
  let tokens = 0;
  const out = events.map((e) => ({ ...e }));

  for (let i = 0; i < out.length; i += batchSize) {
    const batch = out.slice(i, i + batchSize);
    try {
      const { scorings, tokens: t } = await scoreEvents(batch, settings);
      tokens += t;
      for (const s of scorings) {
        const target = batch[s.index - 1];
        if (!target) continue;
        target.score = s.score;
        target.reason = s.reason;
        target.focus_area = s.focus_area;
      }
      log(`  scored ${Math.min(i + batchSize, out.length)}/${out.length}`);
    } catch (e) {
      // Unscored events rank at the bottom rather than disappearing.
      log(`  score batch ${i / batchSize + 1} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { events: out, tokens };
}

// ------------------------------------------------------------- the whole run

export async function runPipeline(
  settings: Settings,
  opts: { today?: string; log?: Log } = {}
): Promise<PipelineResult> {
  const today = opts.today ?? todayISO();
  const log = opts.log ?? (() => {});
  let tokens = 0;

  log('fetch');
  const fetched = await stageFetch(settings, today, log);
  tokens += fetched.tokens;

  log('merge');
  const merged = mergeDuplicates(fetched.events).map((e) => ({ ...e, fingerprint: fingerprint(e) }));

  log('pre-filter');
  // Cheap drops first, so we never pay to enrich an event we were going to bin.
  const pre: FilterResult = hardFilter(merged, settings, today, { allowUnknownCity: true });
  log(`  ${pre.kept.length} kept, ${pre.dropped.length} dropped ${JSON.stringify(dropSummary(pre.dropped))}`);

  log('link check');
  const checked = await stageLinkCheck(pre.kept, log);
  const alive = checked.filter((e) => e.link_ok);

  log('enrich');
  const enriched = await stageEnrich(alive, today, 4, log);
  tokens += enriched.tokens;

  log('filter');
  const final: FilterResult = hardFilter(enriched.events, settings, today);
  log(`  ${final.kept.length} kept, ${final.dropped.length} dropped ${JSON.stringify(dropSummary(final.dropped))}`);

  log('score');
  const scored = await stageScore(final.kept, settings, 10, log);
  tokens += scored.tokens;

  log('rank + cap');
  const ranked = applyCap(rank(scored.events, settings), MAX_NEW_EVENTS);

  return {
    events: ranked,
    sourceRuns: fetched.sourceRuns,
    stats: {
      found: fetched.events.length,
      afterMerge: merged.length,
      afterPreFilter: pre.kept.length,
      afterLinkCheck: alive.length,
      afterFilter: final.kept.length,
      final: ranked.length,
      tokens,
      drops: { ...dropSummary(pre.dropped), ...dropSummary(final.dropped) },
    },
  };
}
