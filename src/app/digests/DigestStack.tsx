'use client';

import { useEffect, useState } from 'react';
import { DISPLAY_TZ } from '@/config';

export interface DigestRow {
  id: number;
  sent_at: string;
  kind: 'monday_auto' | 'test_send';
  recipient: string;
  subject: string;
  new_count: number;
  calendar_count: number;
  closing_count: number;
  has_audio: boolean;
  audio_seconds: number | null;
}

/**
 * The archive as a swapping card stack: depth, perspective, and the front card
 * sliding away as the next one rises.
 *
 * Deliberately NOT auto-cycling, unlike the component this is modelled on. An
 * archive is a lookup tool — "what went out on the 12th?" — and a stack that
 * moves on its own takes the answer away while you are reading it. Nothing
 * moves here unless you move it.
 */
export function DigestStack({
  digests,
  selectedId,
  initialHtml,
}: {
  digests: DigestRow[];
  selectedId: number;
  initialHtml: string;
}) {
  const startIndex = Math.max(0, digests.findIndex((d) => d.id === selectedId));
  const [index, setIndex] = useState(startIndex);
  const [html, setHtml] = useState(initialHtml);
  const [loading, setLoading] = useState(false);

  const current = digests[index];

  /**
   * The preview follows the stack. It used to be server-rendered from the URL,
   * which meant swapping a card moved the stack and left the preview showing a
   * different digest — worse than the plain list it replaced.
   */
  useEffect(() => {
    if (!current || current.id === selectedId) { setHtml(initialHtml); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/digest/${current.id}/html`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.html) setHtml(j.html); })
      .catch(() => { /* leave the previous preview rather than blanking it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [current, selectedId, initialHtml]);

  if (!digests.length) return null;

  const go = (next: number) => setIndex((next + digests.length) % digests.length);

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: DISPLAY_TZ, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));

  // only a few cards are worth rendering behind the front one
  const DEPTH = 4;

  return (
    <div className="stack-wrap">
      <div className="stack" role="group" aria-label="Sent digests">
        {digests.map((d, i) => {
          // position relative to the front card, wrapping around
          let rel = i - index;
          if (rel < 0) rel += digests.length;
          const hidden = rel > DEPTH;

          return (
            <button
              key={d.id}
              type="button"
              className={`stack-card ${rel === 0 ? 'is-front' : ''}`}
              aria-current={rel === 0}
              aria-hidden={hidden}
              tabIndex={hidden ? -1 : 0}
              onClick={() => (rel === 0 ? null : go(i))}
              style={{
                transform: `translateY(${rel * 16}px) translateZ(${-rel * 70}px) scale(${1 - rel * 0.045})`,
                opacity: hidden ? 0 : 1 - rel * 0.16,
                zIndex: digests.length - rel,
                pointerEvents: hidden ? 'none' : 'auto',
              }}
            >
              <span className="stack-top">
                <strong>{fmt(d.sent_at)} IST</strong>
                <span className={`tag ${d.kind === 'test_send' ? 'tag-audience' : 'tag-format'}`}>
                  {d.kind === 'test_send' ? 'Test send' : 'Monday auto'}
                </span>
              </span>
              <span className="stack-subject">{d.subject}</span>
              <span className="stack-meta">
                {d.new_count} new {d.new_count === 1 ? 'event' : 'events'} ·{' '}
                {d.calendar_count} on calendar · {d.closing_count} flagged
              </span>
              <span className="stack-to">to {d.recipient}</span>
              {d.has_audio && (
                <span className="tag tag-format" style={{ alignSelf: 'flex-start' }}>
                  Voice note · {Math.round(d.audio_seconds ?? 0)}s
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="stack-controls">
        <button className="chip" onClick={() => go(index - 1)} aria-label="Previous digest">←</button>
        <span className="note">{index + 1} of {digests.length}</span>
        <button className="chip" onClick={() => go(index + 1)} aria-label="Next digest">→</button>
        {current?.has_audio && (
          <a className="chip" href={`/listen/${current.id}`}>Play the voice note →</a>
        )}
      </div>

      <section className="glass-lg panel" style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 className="h2">Email preview</h2>
          <span className="note">{loading ? 'Loading…' : 'The exact HTML that was delivered'}</span>
        </div>
        <iframe
          title={current?.subject ?? 'Digest preview'}
          srcDoc={html}
          style={{
            width: '100%', height: 720, marginTop: 12, border: '1px solid rgba(255,255,255,.9)',
            borderRadius: 16, background: '#fff', opacity: loading ? 0.55 : 1,
            transition: 'opacity .2s ease',
          }}
        />
      </section>
    </div>
  );
}
