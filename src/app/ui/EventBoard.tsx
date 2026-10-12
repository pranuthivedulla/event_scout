'use client';

import { useMemo, useState } from 'react';
import { EventCard } from './EventCard';
import { RippleButton } from './RippleButton';
import { urgency, formatDay } from '@/lib/dates';
import type { ScoutEvent } from '@/lib/types';

type Filter = 'all' | 'flagged' | 'calendar';

/**
 * The three summary cards double as filters for the list below them.
 *
 * The 7-day flag is the point of the digest, so "Closing or starting in 7
 * days" has to lead somewhere. Clicking it shows every flagged event —
 * including the ones matching no focus area, which are flagged on event-date
 * proximity and never promoted into the ranked list.
 */
export function EventBoard({
  events,
  calendar,
  clickedIds,
  cities,
  today,
}: {
  events: ScoutEvent[];
  calendar: ScoutEvent[];
  clickedIds: number[];
  cities: string[];
  today: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const clicked = useMemo(() => new Set(clickedIds), [clickedIds]);

  const flagged = useMemo(
    () => events.filter((e) => urgency(e, today).flagged),
    [events, today]
  );
  const ranked = useMemo(() => events.filter((e) => (e.score ?? 0) > 0), [events]);
  const alsoFound = useMemo(() => events.filter((e) => (e.score ?? 0) === 0), [events]);

  const shown =
    filter === 'flagged' ? flagged : filter === 'calendar' ? calendar : ranked;

  const heading =
    filter === 'flagged'
      ? 'Closing or starting within 7 days'
      : filter === 'calendar'
      ? 'On your calendar'
      : 'Ranked for you';

  const note =
    filter === 'flagged'
      ? 'Every flagged event, soonest first — including ones that match no focus area.'
      : filter === 'calendar'
      ? 'You clicked add to calendar on these. They stay in every Monday email until they close.'
      : flagged.some((e) => (e.score ?? 0) > 0)
      ? 'Closing or starting within 7 days first, then by fit'
      : `${ranked.length} matched your focus areas, ordered by fit`;

  const sorted =
    filter === 'flagged'
      ? [...shown].sort((a, b) => (urgency(a, today).days ?? 99) - (urgency(b, today).days ?? 99))
      : shown;

  return (
    <>
      <div className="cards">
        <Card
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          value={events.length}
          label="Events ahead"
          note={`Across ${cities.join(', ')}`}
        />
        <Card
          active={filter === 'flagged'}
          onClick={() => setFilter('flagged')}
          value={flagged.length}
          label="Closing or starting in 7 days"
          note={filter === 'flagged' ? 'Showing these below' : 'Click to see them'}
          red
        />
        <Card
          active={filter === 'calendar'}
          onClick={() => setFilter('calendar')}
          value={calendar.length}
          label="On your calendar"
          note={filter === 'calendar' ? 'Showing these below' : 'Click to see them'}
        />
      </div>

      <section className="glass-lg col-main" style={{ flex: '999 1 560px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 className="h2">{heading}</h2>
          <span className="note">{note}</span>
        </div>

        {filter !== 'all' && (
          <button className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setFilter('all')}>
            ← Back to all events
          </button>
        )}

        {/* keyed on the filter so the drop-in replays on every switch */}
        <div className="filter-panel" key={filter} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sorted.length === 0 ? (
          <div className="empty">
            {filter === 'flagged'
              ? 'Nothing is closing or starting within seven days.'
              : filter === 'calendar'
              ? 'Nothing on your calendar yet. Use Add to calendar on any event to keep it here.'
              : 'Nothing matched your focus areas yet.'}
          </div>
        ) : (
          sorted.map((e, i) => (
            <EventCard
              key={e.id ?? e.source_url}
              ev={e}
              rank={filter === 'all' ? i + 1 : undefined}
              today={today}
              onCalendar={e.id ? clicked.has(e.id) : false}
            />
          ))
        )}

        </div>

        {filter === 'all' && alsoFound.length > 0 && (
          <>
            <div style={{ marginTop: 10 }}>
              <div className="eyebrow">Also found this week</div>
              <p className="note" style={{ marginTop: 4 }}>
                No focus-area match. Shown so nothing is hidden from you.
              </p>
            </div>
            {alsoFound.map((e) => {
              const u = urgency(e, today);
              return (
                <div key={e.id ?? e.source_url} className="row">
                  <div style={{ minWidth: 0 }}>
                    <a href={e.source_url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 14, fontWeight: 700 }}>{e.title}</a>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {[e.city, formatDay(e.start_date, today)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className="pill" style={{
                    background: u.flagged ? 'var(--red)' : 'var(--mint)',
                    color: u.flagged ? '#fff' : 'var(--mint-ink)',
                  }}>
                    {u.flagged ? u.badge : `${e.score ?? 0}/5`}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </section>
    </>
  );
}

function Card({
  value, label, note, onClick, active, red,
}: {
  value: number; label: string; note: string;
  onClick: () => void; active: boolean; red?: boolean;
}) {
  return (
    <RippleButton
      onClick={onClick}
      active={active}
      ariaPressed={active}
      title={`Show ${label.toLowerCase()}`}
      className="glass statcard card-button"
      rippleColor={red ? 'rgba(180,35,24,0.25)' : 'rgba(15,92,73,0.18)'}
    >
      <span className="statnum" style={{ color: red && value > 0 ? 'var(--red)' : 'var(--green)' }}>
        {value}
      </span>
      <span style={{ textAlign: 'left' }}>
        <span className="statlabel" style={{ display: 'block' }}>{label}</span>
        <span className="statnote" style={{ display: 'block' }}>{note}</span>
      </span>
    </RippleButton>
  );
}
