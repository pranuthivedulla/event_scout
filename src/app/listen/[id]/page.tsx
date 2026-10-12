import { Nav } from '../../ui/Nav';
import { getDigestAudio, digestSummary, hasDatabase } from '@/lib/db';
import { DISPLAY_TZ } from '@/config';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * The player the Monday email links to.
 *
 * Audio cannot play inside an email — Gmail and Outlook strip <audio> and all
 * script — so the email carries a link and the sound lives here. The written
 * transcript sits underneath, so the page is useful with the sound off and
 * readable by anyone who cannot or would rather not listen.
 */
export default async function Listen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const digestId = Number(id);

  if (!hasDatabase() || !Number.isInteger(digestId)) {
    return (
      <main className="page">
        <Nav here="/digests" />
        <section className="glass-lg panel">
          <h1 className="h1">Nothing to play</h1>
          <p className="sub">That link does not point at a digest.</p>
        </section>
      </main>
    );
  }

  const [audio, meta] = await Promise.all([getDigestAudio(digestId), digestSummary(digestId)]);

  if (!audio || !meta) {
    return (
      <main className="page">
        <Nav here="/digests" />
        <section className="glass-lg panel">
          <h1 className="h1">No voice note for this digest</h1>
          <p className="sub">
            One is only recorded when something is actually closing or starting within
            seven days. That week, nothing was.
          </p>
          <p style={{ marginTop: 14 }}>
            <Link className="btn btn-ghost" href="/digests" style={{ display: 'inline-flex' }}>
              Back to the archive
            </Link>
          </p>
        </section>
      </main>
    );
  }

  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ, weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(meta.sent_at));

  return (
    <main className="page">
      <Nav here="/digests" />

      <div style={{ padding: '4px 4px 0' }}>
        <h1 className="h1">What needs you this week</h1>
        <p className="sub">{when} IST · {Math.round(audio.seconds)} seconds</p>
      </div>

      <section className="glass-lg panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript is below, in full */}
        <audio
          controls
          preload="metadata"
          src={`/api/digest/${digestId}/audio`}
          style={{ width: '100%' }}
        >
          Your browser cannot play audio. The transcript is below.
        </audio>

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Transcript</div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: 'var(--ink)' }}>
            {audio.script}
          </p>
        </div>

        <p className="note" style={{ margin: 0 }}>
          Read from the same rows as the email. Dates and counts are worked out in
          code; the model only reads the finished script aloud, so it cannot
          introduce a date nobody published.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <Link className="btn btn-primary" href="/" style={{ flex: '0 0 auto' }}>
            See the events
          </Link>
          <Link className="btn btn-ghost" href={`/digests?open=${digestId}`} style={{ flex: '0 0 auto' }}>
            Read the full digest
          </Link>
        </div>
      </section>
    </main>
  );
}
