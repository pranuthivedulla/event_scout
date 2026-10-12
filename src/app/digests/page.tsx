import { Nav } from '../ui/Nav';
import { listDigests, digestHtml, hasDatabase } from '@/lib/db';
import { DISPLAY_TZ } from '@/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ, weekday: 'short', day: 'numeric', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));

export default async function Digests({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  if (!hasDatabase()) {
    return (
      <main className="page">
        <Nav here="/digests" />
        <section className="glass-lg panel">
          <h1 className="h1">Not connected yet</h1>
          <p className="sub">DATABASE_URL is not set, so there is no archive to show.</p>
        </section>
      </main>
    );
  }

  const { open } = await searchParams;
  const digests = await listDigests(40);
  const selectedId = open ? Number(open) : digests[0]?.id;
  const selected = selectedId ? await digestHtml(selectedId) : null;

  return (
    <main className="page">
      <Nav here="/digests" />

      <div style={{ padding: '4px 4px 0' }}>
        <h1 className="h1">Digest archive</h1>
        <p className="sub">
          Every digest ever sent, kept so nothing gets lost — and so you can see
          exactly what went out on any Monday.
        </p>
      </div>

      {digests.length === 0 ? (
        <section className="glass-lg panel">
          <div className="empty">
            No digests sent yet. The first Monday run, or a send from the Admin
            panel, will appear here with the exact email that was delivered.
          </div>
        </section>
      ) : (
        <div className="cols">
          <section className="glass-lg col-main" style={{ flex: '1 1 340px' }}>
            <h2 className="h2">Sent digests</h2>
            {digests.map((d) => {
              const on = d.id === selectedId;
              return (
                <a key={d.id} href={`/digests?open=${d.id}`}
                   className="ev" style={{
                     padding: '14px 16px',
                     background: on ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.55)',
                     borderColor: on ? '#0f7a60' : 'rgba(255,255,255,.9)',
                   }}>
                  <div className="ev-body" style={{ gap: 5 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <strong style={{ fontSize: 15 }}>{fmt(d.sent_at)} IST</strong>
                      <span className="tag" style={{
                        background: d.kind === 'test_send' ? '#fde9c8' : '#e3ecf7',
                        color: d.kind === 'test_send' ? '#8a5600' : '#26486e',
                      }}>
                        {d.kind === 'test_send' ? 'Test send' : 'Monday auto'}
                      </span>
                      <span className="tag tag-format">Sent</span>
                    </div>
                    <div className="note">
                      {d.new_count} new {d.new_count === 1 ? 'event' : 'events'},{' '}
                      {d.calendar_count} on calendar, {d.closing_count} flagged
                    </div>
                    <div className="via">to {d.recipient}</div>
                  </div>
                </a>
              );
            })}
          </section>

          <section className="glass-lg panel" style={{ flex: '999 1 520px', minWidth: 0 }}>
            <h2 className="h2">Email preview</h2>
            <p className="note" style={{ marginTop: 4, marginBottom: 12 }}>
              The exact HTML that was delivered, not a re-render.
            </p>
            {selected ? (
              <iframe
                title={selected.subject}
                srcDoc={selected.html}
                style={{
                  width: '100%', height: 760, border: '1px solid rgba(255,255,255,.9)',
                  borderRadius: 16, background: '#fff',
                }}
              />
            ) : (
              <div className="empty">Pick a digest on the left.</div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
