'use client';

import { useEffect, useMemo, useState } from 'react';
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
 * The archive as a row of digests that glides sideways and stops when you
 * point at it.
 *
 * The pause is not decoration. A row that keeps moving under the cursor means
 * you reach for a card and it slides away — the same fault as an archive that
 * advances on a timer. It halts on hover AND on keyboard focus, so tabbing
 * through it is not a moving target either.
 *
 * The track holds the digests twice. The animation travels exactly one
 * copy-width and restarts, which reads as an endless row rather than a list
 * that snaps back. The second copy is hidden from assistive tech so the same
 * digest is not announced twice.
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
  const [openId, setOpenId] = useState<number | null>(null);
  const [html, setHtml] = useState(initialHtml);
  const [loading, setLoading] = useState(false);

  const open = useMemo(() => digests.find((d) => d.id === openId) ?? null, [digests, openId]);

  /** Load the email only when one is actually opened. */
  useEffect(() => {
    if (!open) return;
    if (open.id === selectedId) { setHtml(initialHtml); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/digest/${open.id}/html`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.html) setHtml(j.html); })
      .catch(() => { /* keep whatever was there rather than blanking it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, selectedId, initialHtml]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!digests.length) return null;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: DISPLAY_TZ, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));

  // Long enough that the row drifts rather than scrolls, and scaled to the
  // number of cards so adding digests does not speed it up.
  const seconds = Math.max(28, digests.length * 9);

  const card = (d: DigestRow, copy: number) => (
    <button
      key={`${d.id}-${copy}`}
      type="button"
      className="glide-card"
      aria-hidden={copy === 1}
      tabIndex={copy === 1 ? -1 : 0}
      onClick={() => setOpenId(d.id)}
    >
      <span className="glide-top">
        <strong>{fmt(d.sent_at)} IST</strong>
        <span className={`tag ${d.kind === 'test_send' ? 'tag-audience' : 'tag-format'}`}>
          {d.kind === 'test_send' ? 'Test send' : 'Monday auto'}
        </span>
      </span>
      <span className="glide-subject">{d.subject}</span>
      <span className="glide-meta">
        {d.new_count} new {d.new_count === 1 ? 'event' : 'events'} ·{' '}
        {d.calendar_count} on calendar · {d.closing_count} flagged
      </span>
      <span className="glide-to">to {d.recipient}</span>
      <span className="glide-foot">
        {d.has_audio && (
          <span className="tag tag-format">Voice note · {Math.round(d.audio_seconds ?? 0)}s</span>
        )}
        <span className="glide-cta">Open the email →</span>
      </span>
    </button>
  );

  return (
    <div className="stack-wrap">
      <div className="glide-rail">
        <div className="glide-track" style={{ animationDuration: `${seconds}s` }}>
          {digests.map((d) => card(d, 0))}
          {digests.map((d) => card(d, 1))}
        </div>
      </div>

      {open && (
        <div
          className="preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Email preview: ${open.subject}`}
          onClick={() => setOpenId(null)}
        >
          <div className="preview-sheet" onClick={(e) => e.stopPropagation()}>
            <header className="preview-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="h2" style={{ fontSize: 20 }}>{open.subject}</h2>
                <p className="note" style={{ margin: '4px 0 0' }}>
                  {fmt(open.sent_at)} IST · to {open.recipient} ·{' '}
                  {loading ? 'loading…' : 'the exact HTML that was delivered'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {open.has_audio && (
                  <a className="chip" href={`/listen/${open.id}`}>Voice note →</a>
                )}
                <button className="chip" onClick={() => setOpenId(null)} aria-label="Close preview">
                  Close ✕
                </button>
              </div>
            </header>
            <iframe
              title={open.subject}
              srcDoc={html}
              className="preview-frame"
              style={{ opacity: loading ? 0.5 : 1 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
