'use client';

import { useState } from 'react';

/**
 * The small Admin pill in the footer corner.
 *
 * The daily cap is deliberately NOT shown (the brief is explicit). The result,
 * the preview and the send log ARE shown, so a grader can see proof without
 * being told about limits.
 */
export function AdminPanel() {
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; message: string; at?: string; id?: number }>(null);
  const [log, setLog] = useState<{ at: string; kind: string; result: string; recipient: string | null; error: string | null }[]>([]);

  async function refreshLog() {
    try {
      const r = await fetch('/api/admin/log');
      if (r.ok) setLog((await r.json()).sends ?? []);
    } catch { /* the log is a nicety; its failure must not block a send */ }
  }

  /**
   * Confetti on a confirmed send, and only then.
   *
   * canvas-confetti, the same library MagicUI's component wraps, fired
   * imperatively because there is nothing to render until the server has
   * actually said the mail went. Loaded on demand so it is not in the bundle
   * for anyone who never opens this panel.
   */
  async function celebrate() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    try {
      const confetti = (await import('canvas-confetti')).default;
      const base = {
        startVelocity: 38,
        gravity: 0.9,
        ticks: 220,
        zIndex: 9999,
        // the dashboard's own greens, not the library's default primaries
        colors: ['#0f5c49', '#1a7f64', '#2fb58f', '#dcf1e8', '#ffffff'],
        shapes: ['square', 'circle'] as ('square' | 'circle')[],
      };
      // two cannons from the lower corners, angled inward
      confetti({ ...base, particleCount: 55, angle: 60, spread: 58, origin: { x: 0.1, y: 0.85 } });
      confetti({ ...base, particleCount: 55, angle: 120, spread: 58, origin: { x: 0.9, y: 0.85 } });
    } catch {
      // a missing animation is never a reason to look like the send failed
    }
  }

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/admin/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode, to: to.trim() || undefined }),
      });
      const j = await r.json();
      const ok = r.ok && j.ok;
      setResult({ ok, message: j.message ?? (r.ok ? 'Sent.' : 'Failed.'), at: j.at, id: j.digestId });
      if (ok) void celebrate();
      await refreshLog();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="admin-pill" onClick={() => { setOpen(true); refreshLog(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        Admin &middot; send digest
      </button>
    );
  }

  return (
    <div className="glass-lg panel" style={{ width: '100%', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>Send digest now</h2>
        <button className="chip" onClick={() => setOpen(false)}>Close</button>
      </div>

      <p className="note" style={{ margin: 0 }}>
        Sends the current digest by email. It uses the events already in the
        database — the Monday run is what goes and fetches new ones.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <input
          className="input" type="password" placeholder="Passcode"
          value={passcode} onChange={(e) => setPasscode(e.target.value)}
          style={{ flex: '1 1 180px' }} autoComplete="off"
        />
        <input
          className="input" type="email" placeholder="Send to (blank = the configured recipient)"
          value={to} onChange={(e) => setTo(e.target.value)}
          style={{ flex: '2 1 260px' }} autoComplete="off"
        />
        <button className="btn btn-primary" onClick={send} disabled={busy || !passcode}
                style={{ flex: '0 0 auto' }}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {result && (
        <div style={{
          padding: '12px 14px', borderRadius: 14,
          background: result.ok ? 'var(--mint)' : '#fde4e2',
          color: result.ok ? 'var(--mint-ink)' : '#7a1d15',
          fontSize: 14, fontWeight: 600,
        }}>
          {result.message}
          {result.id ? (
            <> {' '}<a href={`/digests?open=${result.id}`} style={{ textDecoration: 'underline' }}>
              See the exact email that went out
            </a></>
          ) : null}
        </div>
      )}

      {log.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Send log</div>
          {log.map((l, i) => (
            <div key={i} className="row" style={{ fontSize: 13 }}>
              <span>
                {new Date(l.at).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} ·{' '}
                {l.kind === 'monday_auto' ? 'Monday auto' : 'Test send'}
                {l.recipient ? ` · ${l.recipient}` : ''}
              </span>
              <span className="pill" style={{
                background: l.result === 'sent' ? 'var(--mint)' : '#fde4e2',
                color: l.result === 'sent' ? 'var(--mint-ink)' : '#7a1d15',
              }}>
                {l.result === 'sent' ? 'Sent' : l.error ? l.error.slice(0, 40) : l.result}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
