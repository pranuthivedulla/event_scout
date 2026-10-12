import type { ScoutEvent } from '@/lib/types';
import { urgency, formatRange, googleCalendarUrl } from '@/lib/dates';

/**
 * One event, as the dashboard shows it.
 *
 * The red badge says "Closes in N days" ONLY when a source stated a
 * registration deadline. Otherwise it counts down to the event and says so.
 * The two never share wording — the system cannot claim a registration closes
 * on a date nobody published.
 */
export function EventCard({
  ev,
  rank,
  onCalendar,
  today,
}: {
  ev: ScoutEvent;
  rank?: number;
  onCalendar?: boolean;
  today: string;
}) {
  const u = urgency(ev, today);
  const hasCal = Boolean(googleCalendarUrl(ev));

  return (
    <article className="ev">
      {rank !== undefined && <div className="ev-rank">{rank}</div>}

      <div className="ev-body">
        <h3 className="ev-title">{ev.title}</h3>

        <div className="ev-meta">
          {ev.city && <strong>{ev.city}</strong>}
          {ev.city && <span aria-hidden>·</span>}
          <span>{formatRange(ev.start_date, ev.end_date, today)}</span>
          {ev.format && <span className="tag tag-format">{ev.format}</span>}
          {/* A short stated audience reads as a chip ("CIO roundtable"); a long
              one is a sentence and gets its own line below, never a chip. */}
          {ev.audience_tag && ev.audience_tag.length <= 34 && (
            <span className="tag tag-audience">{ev.audience_tag}</span>
          )}
          {onCalendar && (
            <span className="tag tag-format" title="You clicked add to calendar. Not a registration.">
              On your calendar
            </span>
          )}
        </div>

        {ev.audience_tag && ev.audience_tag.length > 34 && (
          <div style={{ fontSize: 13, color: 'var(--amber-ink)', background: 'var(--amber)',
                        padding: '6px 10px', borderRadius: 10, lineHeight: 1.45 }}>
            <strong>Audience:</strong> {ev.audience_tag}
          </div>
        )}

        {ev.summary && <p className="ev-summary" style={{ margin: 0 }}>{ev.summary}</p>}

        {ev.reason && (
          <div className="ev-fit">
            Fit {ev.score ?? '-'}/5
            {ev.focus_area ? ` · ${ev.focus_area}` : ' · no focus area matched'} — {ev.reason}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 2 }}>
          {u.badge ? <span className="badge-red">{u.badge}</span> : null}
          <span className="deadline-plain">{u.line}</span>
          <span className="via">via {ev.source}</span>
        </div>
      </div>

      <div className="ev-actions">
        <a className="btn btn-primary" href={ev.source_url} target="_blank" rel="noopener noreferrer">
          Register
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 17L17 7M8 7h9v9" />
          </svg>
        </a>
        {hasCal && ev.id && (
          <a className="btn btn-ghost" href={`/api/calendar/${ev.id}`} target="_blank" rel="noopener noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f4b3c"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="18" height="16" rx="3" />
              <path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4" />
            </svg>
            Add to calendar
          </a>
        )}
      </div>
    </article>
  );
}
