'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
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
 * The archive as a CardSwap stack (ReactBits, via superdev), adopted to this
 * dashboard's glass and greens.
 *
 * The motion is theirs and is the whole point of using it: the front card
 * drops straight down out of the stack, the rest promote on a stagger that
 * starts while it is still falling, and only then does the dropped card fly
 * back to the rear slot. Elastic easing throughout. An earlier hand-rolled
 * CSS version moved every card to its new slot at once, which reads as a
 * shuffle rather than a swap — the drop-and-return is what makes it legible.
 *
 * ONE deliberate departure: no auto-cycle. The original advances on a timer,
 * which is right for a showcase and wrong for an archive. This is a lookup
 * tool, the front card drives the email preview below it, and a stack that
 * advanced on its own would change the answer while you were reading it.
 */

const SLOT_X = 44;   // cardDistance
const SLOT_Y = 40;   // verticalDistance
const SKEW = 4;      // skewAmount
const DROP = 420;    // how far the ejected card falls before it returns

const EASE = 'elastic.out(0.6,0.9)';
const DUR_DROP = 1.1;
const DUR_MOVE = 1.1;
const DUR_RETURN = 1.1;
const PROMOTE_OVERLAP = 0.9;
const RETURN_DELAY = 0.05;

interface Slot { x: number; y: number; z: number; zIndex: number }

const makeSlot = (i: number, total: number, sx: number, sy: number): Slot => ({
  x: i * sx,
  y: -i * sy,
  z: -i * sx * 1.5,
  zIndex: total - i,
});

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

  const refs = useMemo(
    () => digests.map(() => ({ current: null as HTMLDivElement | null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [digests.length]
  );
  /** Front-to-back order of card indices, mutated by the swap as in the original. */
  const order = useRef<number[]>(digests.map((_, i) => i));
  const timeline = useRef<gsap.core.Timeline | null>(null);

  const [frontIndex, setFrontIndex] = useState(startIndex);
  const [html, setHtml] = useState(initialHtml);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(false);

  const front = digests[frontIndex];

  // tighter spacing on a phone, where the fan would otherwise run off the edge
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const sx = compact ? 22 : SLOT_X;
  const sy = compact ? 24 : SLOT_Y;

  /** Put every card in its resting slot without animating. */
  const place = useCallback(() => {
    const total = refs.length;
    order.current.forEach((cardIdx, pos) => {
      const el = refs[cardIdx]?.current;
      if (!el) return;
      const slot = makeSlot(pos, total, sx, sy);
      gsap.set(el, {
        x: slot.x, y: slot.y, z: slot.z,
        xPercent: -50, yPercent: -50,
        skewY: SKEW,
        transformOrigin: 'center center',
        zIndex: slot.zIndex,
        force3D: true,
      });
    });
  }, [refs, sx, sy]);

  useEffect(() => {
    // open with the selected digest at the front
    order.current = digests.map((_, i) => (i + startIndex) % digests.length);
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, digests.length]);

  /**
   * The swap, lifted from the original timeline: drop the front card, promote
   * the rest on a stagger that begins while it is still falling, then send the
   * dropped card round to the back.
   */
  const swap = useCallback(() => {
    if (order.current.length < 2) return;
    if (timeline.current?.isActive()) return;

    const total = refs.length;
    const [frontCard, ...rest] = order.current;
    const elFront = refs[frontCard]?.current;
    if (!elFront) return;

    const tl = gsap.timeline();
    timeline.current = tl;

    tl.to(elFront, { y: `+=${DROP}`, duration: DUR_DROP, ease: EASE });

    tl.addLabel('promote', `-=${DUR_DROP * PROMOTE_OVERLAP}`);
    rest.forEach((cardIdx, i) => {
      const el = refs[cardIdx]?.current;
      if (!el) return;
      const slot = makeSlot(i, total, sx, sy);
      tl.set(el, { zIndex: slot.zIndex }, 'promote');
      tl.to(el, { x: slot.x, y: slot.y, z: slot.z, duration: DUR_MOVE, ease: EASE },
        `promote+=${i * 0.15}`);
    });

    const back = makeSlot(total - 1, total, sx, sy);
    tl.addLabel('return', `promote+=${DUR_MOVE * RETURN_DELAY}`);
    tl.call(() => { gsap.set(elFront, { zIndex: back.zIndex }); }, undefined, 'return');
    tl.to(elFront, { x: back.x, y: back.y, z: back.z, duration: DUR_RETURN, ease: EASE }, 'return');

    tl.call(() => { order.current = [...rest, frontCard]; });

    // The preview changes straight away. Waiting out a 1.1s elastic would make
    // the thing you actually came to read feel slow.
    setFrontIndex(rest[0]);
  }, [refs, sx, sy]);

  /** Clicking a card behind brings it forward, one swap at a time. */
  const bringForward = useCallback((cardIdx: number) => {
    const pos = order.current.indexOf(cardIdx);
    if (pos <= 0) return;
    for (let n = 0; n < pos; n++) window.setTimeout(swap, n * 240);
  }, [swap]);

  /** The email preview follows whichever card is in front. */
  useEffect(() => {
    if (!front || front.id === selectedId) { setHtml(initialHtml); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/digest/${front.id}/html`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.html) setHtml(j.html); })
      .catch(() => { /* keep the previous preview rather than blanking it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [front, selectedId, initialHtml]);

  if (!digests.length) return null;

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: DISPLAY_TZ, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));

  const position = order.current.indexOf(frontIndex);

  return (
    <div className="stack-wrap">
      <div className="swap-stage" style={{ height: compact ? 250 : 290 }} role="group" aria-label="Sent digests">
        <div className="swap-3d">
          {digests.map((d, i) => (
            <div
              key={d.id}
              ref={(el) => { refs[i].current = el; }}
              className={`swap-card ${d.id === front?.id ? 'is-front' : ''}`}
              style={{ width: compact ? 248 : 356, height: compact ? 170 : 184 }}
              onClick={() => bringForward(i)}
              role="button"
              tabIndex={0}
              aria-current={d.id === front?.id}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bringForward(i); }
              }}
            >
              <div className="swap-top">
                <strong>{fmt(d.sent_at)} IST</strong>
                <span className={`tag ${d.kind === 'test_send' ? 'tag-audience' : 'tag-format'}`}>
                  {d.kind === 'test_send' ? 'Test send' : 'Monday auto'}
                </span>
              </div>
              <div className="swap-subject">{d.subject}</div>
              <div className="swap-meta">
                {d.new_count} new {d.new_count === 1 ? 'event' : 'events'} ·{' '}
                {d.calendar_count} on calendar · {d.closing_count} flagged
              </div>
              <div className="swap-to">to {d.recipient}</div>
              {d.has_audio && (
                <span className="tag tag-format" style={{ alignSelf: 'flex-start' }}>
                  Voice note · {Math.round(d.audio_seconds ?? 0)}s
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="stack-controls">
        <button className="chip" onClick={swap} aria-label="Next digest">Swap →</button>
        <span className="note">{position >= 0 ? position + 1 : 1} of {digests.length}</span>
        {front?.has_audio && (
          <a className="chip" href={`/listen/${front.id}`}>Play the voice note →</a>
        )}
      </div>

      <section className="glass-lg panel" style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 className="h2">Email preview</h2>
          <span className="note">{loading ? 'Loading…' : 'The exact HTML that was delivered'}</span>
        </div>
        <iframe
          title={front?.subject ?? 'Digest preview'}
          srcDoc={html}
          style={{
            width: '100%', height: 720, marginTop: 12,
            border: '1px solid rgba(255,255,255,.9)', borderRadius: 16,
            background: '#fff', opacity: loading ? 0.55 : 1, transition: 'opacity .2s ease',
          }}
        />
      </section>
    </div>
  );
}
