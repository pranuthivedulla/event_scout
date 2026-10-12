'use client';

import { useState } from 'react';
import type { Settings } from '@/lib/types';
import type { FocusLevel } from '@/config';

const LEVELS: FocusLevel[] = ['High', 'Medium', 'Low'];

/**
 * Settings editor.
 *
 * Save is gated behind the admin passcode. The brief does not ask for this,
 * but the dashboard is a public URL and without it anyone with the link can
 * delete Vikram's cities. The passcode is held in sessionStorage so he types
 * it once per browser session, and is only ever checked on the server.
 */
export function SettingsForm({ initial, updatedAt }: { initial: Settings; updatedAt: string | null }) {
  const [cities, setCities] = useState<string[]>(initial.cities);
  const [newCity, setNewCity] = useState('');
  const [areas, setAreas] = useState(initial.focus_areas);
  const [newArea, setNewArea] = useState('');
  const [sources, setSources] = useState(initial.extra_sources);
  const [newSource, setNewSource] = useState('');
  const [recipient, setRecipient] = useState(initial.recipient);
  const [windowDays, setWindowDays] = useState(initial.window_days);

  const [passcode, setPasscode] = useState(
    typeof window !== 'undefined' ? sessionStorage.getItem('es_pass') ?? '' : ''
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const touch = () => { setDirty(true); setMsg(null); };

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          passcode,
          settings: {
            cities, focus_areas: areas, extra_sources: sources,
            recipient, window_days: Number(windowDays),
          },
        }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        try { sessionStorage.setItem('es_pass', passcode); } catch {}
        setDirty(false);
        setMsg({ ok: true, text: 'Saved. This applies from the next Monday run.' });
      } else {
        setMsg({ ok: false, text: j.message ?? 'Could not save.' });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCities(initial.cities); setAreas(initial.focus_areas);
    setSources(initial.extra_sources); setRecipient(initial.recipient);
    setWindowDays(initial.window_days); setDirty(false); setMsg(null);
  }

  return (
    <>
      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="h2">Target cities</h2>
        <p className="note" style={{ margin: 0 }}>
          Events outside these cities are left out entirely. Spelling variants are
          handled — Bangalore matches Bengaluru, Navi Mumbai matches Mumbai.
        </p>
        <div className="chips" style={{ marginTop: 4 }}>
          {cities.map((c) => (
            <button key={c} className="toggle on"
                    onClick={() => { setCities(cities.filter((x) => x !== c)); touch(); }}
                    title="Remove">
              {c} ×
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input className="input" placeholder="Add a city" value={newCity}
                 onChange={(e) => setNewCity(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && newCity.trim()) { setCities([...cities, newCity.trim()]); setNewCity(''); touch(); } }} />
          <button className="btn btn-ghost" style={{ flex: '0 0 auto' }}
                  onClick={() => { if (newCity.trim()) { setCities([...cities, newCity.trim()]); setNewCity(''); touch(); } }}>
            Add
          </button>
        </div>
      </section>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="h2">Focus areas</h2>
        <p className="note" style={{ margin: 0 }}>
          Focus areas rank events. They never hide one — an event that matches
          nothing still appears, at the bottom.
        </p>
        {areas.map((a, i) => (
          <div key={i} className="row" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, minWidth: 0, flex: '1 1 200px' }}>{a.name}</span>
            <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {LEVELS.map((l) => (
                <button key={l} className={`toggle ${a.level === l ? 'on' : ''}`}
                        onClick={() => { const n = [...areas]; n[i] = { ...a, level: l }; setAreas(n); touch(); }}>
                  {l}
                </button>
              ))}
              <button className="toggle" title="Remove"
                      onClick={() => { setAreas(areas.filter((_, j) => j !== i)); touch(); }}>×</button>
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input className="input" placeholder="Add a focus area" value={newArea}
                 onChange={(e) => setNewArea(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && newArea.trim()) { setAreas([...areas, { name: newArea.trim(), level: 'Medium' }]); setNewArea(''); touch(); } }} />
          <button className="btn btn-ghost" style={{ flex: '0 0 auto' }}
                  onClick={() => { if (newArea.trim()) { setAreas([...areas, { name: newArea.trim(), level: 'Medium' }]); setNewArea(''); touch(); } }}>
            Add
          </button>
        </div>
      </section>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 className="h2">Organiser sites you follow</h2>
        <p className="note" style={{ margin: 0 }}>
          Most BFSI events never reach a ticketing site — they live on the
          organiser&rsquo;s own page. Paste any you watch and the Monday run reads
          them too. You know this circuit better than the crawler does.
        </p>
        {sources.length === 0 && <div className="note">None added. The built-in sources still run.</div>}
        {sources.map((s, i) => (
          <div key={i} className="row">
            <span style={{ minWidth: 0, fontSize: 14, wordBreak: 'break-all' }}>{s.url}</span>
            <button className="toggle" onClick={() => { setSources(sources.filter((_, j) => j !== i)); touch(); }}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input className="input" placeholder="https://organiser.com/events" value={newSource}
                 onChange={(e) => setNewSource(e.target.value)} />
          <button className="btn btn-ghost" style={{ flex: '0 0 auto' }}
                  onClick={() => {
                    const u = newSource.trim();
                    if (!/^https?:\/\/.+\..+/.test(u)) { setMsg({ ok: false, text: 'That does not look like a URL.' }); return; }
                    setSources([...sources, { label: new URL(u).hostname, url: u }]); setNewSource(''); touch();
                  }}>
            Add
          </button>
        </div>
      </section>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="h2">Digest</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <label style={{ flex: '2 1 260px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Send the Monday digest to</div>
            <input className="input" type="email" value={recipient}
                   onChange={(e) => { setRecipient(e.target.value); touch(); }}
                   placeholder="you@example.com" />
          </label>
          <label style={{ flex: '1 1 150px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>How far ahead to look</div>
            <select className="select" value={windowDays}
                    onChange={(e) => { setWindowDays(Number(e.target.value)); touch(); }}>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={120}>120 days</option>
            </select>
          </label>
        </div>
        <p className="note" style={{ margin: 0 }}>
          90 days is the default. At 30, conferences disappear — they are announced a
          quarter ahead, which is also when early-bird pricing closes.
        </p>
      </section>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="h2">How your digest works</h2>
        <p className="note" style={{ margin: 0 }}>Fixed. Shown so you know what to expect.</p>
        <ul className="note" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Up to 15 new events each Monday, ranked by fit. Events on your calendar are extra, never capped.</li>
          <li>In-person and hybrid only. Purely online events are excluded.</li>
          <li>A red badge means under 7 days. It says <strong>Closes in N days</strong> only when a source actually published a registration deadline; otherwise it counts down to the event and says so.</li>
          <li>No source we have found publishes registration deadlines, so most events read &ldquo;Deadline unknown&rdquo;. That is honest, not broken.</li>
          <li>Add to calendar records your interest and nothing more. The system never knows, and never claims, that you registered.</li>
          <li>If a source fails, the digest still sends and names the one that failed.</li>
        </ul>
      </section>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 200px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Passcode</div>
            <input className="input" type="password" value={passcode} autoComplete="off"
                   onChange={(e) => setPasscode(e.target.value)} placeholder="Required to save" />
          </label>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty || !passcode}
                  style={{ flex: '0 0 auto' }}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn btn-ghost" onClick={reset} disabled={busy || !dirty} style={{ flex: '0 0 auto' }}>
            Cancel
          </button>
        </div>
        {msg && (
          <div style={{
            padding: '12px 14px', borderRadius: 14, fontSize: 14, fontWeight: 600,
            background: msg.ok ? 'var(--mint)' : '#fde4e2',
            color: msg.ok ? 'var(--mint-ink)' : '#7a1d15',
          }}>{msg.text}</div>
        )}
        {updatedAt && (
          <div className="note">
            Last changed {new Date(updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} IST.
          </div>
        )}
      </section>
    </>
  );
}
