import { Nav } from './ui/Nav';
import { EventBoard } from './ui/EventBoard';
import { AdminPanel } from './ui/AdminPanel';
import {
  hasDatabase, upcomingEvents, calendarEvents, clickedEventIds,
  latestSourceRuns, latestRun, weeklyActivity, splits, getSettings,
} from '@/lib/db';
import { todayISO, urgency, formatDay, daysBetween, isISODate } from '@/lib/dates';
import { sortForDisplay } from '@/lib/rank';
import type { ScoutEvent } from '@/lib/types';
import { DISPLAY_TZ } from '@/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ThisWeek() {
  const today = todayISO();

  if (!hasDatabase()) {
    return (
      <main className="page">
        <Nav here="/" />
        <section className="glass-lg panel">
          <h1 className="h1">Not connected yet</h1>
          <p className="sub">
            DATABASE_URL is not set, so there is nothing to show. This page never
            displays sample data — if there are no rows, it says so.
          </p>
        </section>
      </main>
    );
  }

  const [stored, calendar, clicked, sources, run, activity, split, settings] = await Promise.all([
    upcomingEvents(60), calendarEvents(), clickedEventIds(),
    latestSourceRuns(), latestRun(), weeklyActivity(4), splits(), getSettings(),
  ]);

  // Urgency changes daily, so the order is worked out now, not read from the
  // database. Anything flagged AND relevant comes first.
  const events = sortForDisplay(stored, today);

  // 0/5 events are never hidden (the brief forbids it) but they sit below,
  // so the top of the page stays worth reading.
  const ranked = events.filter((e) => (e.score ?? 0) > 0);
  const alsoFound = events.filter((e) => (e.score ?? 0) === 0);
  const closingSoon = events.filter((e) => urgency(e, today).flagged);

  const lastRunAt = run?.started_at
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: DISPLAY_TZ, weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(String(run.started_at)))
    : null;

  return (
    <main className="page">
      <Nav here="/" />

      <div style={{ padding: '4px 4px 0' }}>
        <h1 className="h1">Good morning, Vikram</h1>
        <p className="sub">
          {lastRunAt
            ? <>Last checked {lastRunAt} IST. The digest goes out every Monday morning.</>
            : <>No run yet. The digest goes out every Monday morning.</>}
        </p>
      </div>

      <SourceStrip sources={sources} />

      <div className="cols">
        <EventBoard
          events={events}
          calendar={calendar}
          clickedIds={[...clicked]}
          cities={settings.cities}
          today={today}
        />

        <aside className="col-side">
          <MiniCalendar events={events} today={today} />

          <section className="glass-lg panel">
            <h2 className="h2" style={{ fontSize: 20 }}>On your calendar</h2>
            <p className="note" style={{ marginTop: 4, marginBottom: 12 }}>
              Stays in every Monday email until it closes. Added to calendar is not a registration —
              you register on the organiser&rsquo;s page.
            </p>
            {calendar.length === 0 ? (
              <div className="note">Nothing yet. Add to calendar on an event to keep it here.</div>
            ) : (
              calendar.map((e) => {
                const u = urgency(e, today);
                return (
                  <div key={e.id} className="row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.city}</div>
                    </div>
                    <span className="pill" style={{
                      background: u.flagged ? 'var(--red)' : 'var(--mint)',
                      color: u.flagged ? '#fff' : 'var(--mint-ink)',
                    }}>
                      {e.registration_deadline
                        ? `Closes ${formatDay(e.registration_deadline, today)}`
                        : formatDay(e.start_date, today)}
                    </span>
                  </div>
                );
              })
            )}
          </section>

          <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h2 className="h2" style={{ fontSize: 20 }}>Activity</h2>
            <Bars title="Events found per week" data={activity.found} />
            <Bars title="Added to calendar per week" data={activity.added} />
            <Bars title="Emails sent per week" data={activity.sent} />
          </section>

          <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="h2" style={{ fontSize: 20 }}>By city and focus</h2>
            <Meters rows={[...split.byCity, ...split.byFocus]} />
          </section>
        </aside>
      </div>

      <div className="footer">
        <span>
          Event Scout runs every Monday morning. Vercel&rsquo;s schedule fires within its hour,
          so the exact minute varies.
        </span>
        <AdminPanel />
      </div>
    </main>
  );
}

// --------------------------------------------------------------------------

function Stat({ value, label, note, red }: { value: number; label: string; note: string; red?: boolean }) {
  return (
    <div className="glass statcard">
      <div className="statnum" style={{ color: red && value > 0 ? 'var(--red)' : 'var(--green)' }}>{value}</div>
      <div>
        <div className="statlabel">{label}</div>
        <div className="statnote">{note}</div>
      </div>
    </div>
  );
}

function SourceStrip({ sources }: { sources: { source: string; ok: boolean; error: string | null; found: number }[] }) {
  return (
    <div className="glass sources">
      <strong style={{ color: 'var(--ink)' }}>Sources last run</strong>
      {sources.length === 0 && <span className="note">No run recorded yet.</span>}
      {sources.map((s) => (
        <span key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`dot ${s.ok ? 'dot-ok' : s.error === 'not configured' ? 'dot-off' : 'dot-bad'}`} />
          <span>
            <strong>{s.source}</strong>{' '}
            {s.ok ? `${s.found} events` : s.error === 'not configured' ? 'not connected' : `failed: ${s.error}`}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Red = a stated registration deadline. Green ring = the event itself. */
function MiniCalendar({ events, today }: { events: ScoutEvent[]; today: string }) {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday-first
  const start = new Date(first.getTime() - offset * 86400000);

  const closes = new Set(events.map((e) => e.registration_deadline).filter(isISODate));
  const days = new Set(events.map((e) => e.start_date).filter(isISODate));

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    return {
      iso,
      n: d.getUTCDate(),
      inMonth: d.getUTCMonth() === m - 1,
      isToday: iso === today,
      closes: closes.has(iso),
      event: days.has(iso),
    };
  });

  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, 1)));

  return (
    <section className="glass-lg panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{monthName}</h2>
        <span className="note">Your events</span>
      </div>
      <div className="cal-grid cal-head">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((c) => (
          <div key={c.iso} className="cal-day"
               title={c.closes ? 'Registration closes' : c.event ? 'Event day' : undefined}
               style={{
                 background: c.isToday ? 'var(--green)' : c.closes && c.inMonth ? 'var(--red)' : 'transparent',
                 color: c.isToday || (c.closes && c.inMonth) ? '#fff' : c.inMonth ? 'var(--ink)' : '#8aa39a',
                 boxShadow: c.event && c.inMonth && !c.isToday ? 'inset 0 0 0 2px #0f8a6a' : undefined,
               }}>
            {c.n}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--red)' }} />Registration closes</span>
        <span><i className="swatch" style={{ boxShadow: 'inset 0 0 0 2px #0f8a6a' }} />Event day</span>
        <span><i className="swatch" style={{ background: 'var(--green)' }} />Today</span>
      </div>
    </section>
  );
}

function Bars({ title, data }: { title: string; data: { label: string; value: number }[] }) {
  if (!data.length) return (
    <div><div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div className="note">No data yet.</div></div>
  );
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      <div className="bars">
        {data.map((d) => (
          <div key={d.label} className="bar-col">
            <div className="bar-v">{d.value}</div>
            <div className="bar" style={{ height: Math.max(8, Math.round((d.value / max) * 70)) }} />
            <div className="bar-l">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meters({ rows }: { rows: { label: string; value: number }[] }) {
  if (!rows.length) return <div className="note">No data yet.</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 5 }}>
            <span>{r.label}</span><span>{r.value}</span>
          </div>
          <div className="meter"><div style={{ width: `${Math.round((r.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </>
  );
}
