import Link from 'next/link';
import { DISPLAY_TZ } from '@/config';

/**
 * The spoken deadline note, on the dashboard.
 *
 * It was previously reachable only from a link inside the email, which meant
 * there was nowhere on the site to play it. It plays here directly, and the
 * panel still says something useful on the weeks when no clip exists — which
 * is most weeks, by design.
 */
export function VoiceNote({
  note,
}: {
  note: { id: number; seconds: number; script: string; sent_at: string } | null;
}) {
  if (!note) {
    return (
      <section className="glass-lg panel">
        <h2 className="h2" style={{ fontSize: 20 }}>Voice note</h2>
        <p className="note" style={{ marginTop: 6, marginBottom: 0 }}>
          Nothing recorded. A note is only made when something is both closing
          or starting within seven days <em>and</em> matches one of your focus
          areas. This week nothing is — the relevant events are further out,
          and the near ones match nothing.
        </p>
      </section>
    );
  }

  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(note.sent_at));

  return (
    <section className="glass-lg panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>Voice note</h2>
        <span className="note">{Math.round(note.seconds)}s</span>
      </div>
      <p className="note" style={{ marginTop: 4, marginBottom: 12 }}>
        What needs you this week, for the commute. {when} IST.
      </p>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transcript below */}
      <audio controls preload="none" src={`/api/digest/${note.id}/audio`} style={{ width: '100%' }}>
        Your browser cannot play audio. The transcript is below.
      </audio>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
          Read the transcript instead
        </summary>
        <p className="note" style={{ marginTop: 8, lineHeight: 1.7 }}>{note.script}</p>
      </details>

      <Link href={`/listen/${note.id}`} className="chip" style={{ display: 'inline-block', marginTop: 12 }}>
        Open the full page →
      </Link>
    </section>
  );
}
