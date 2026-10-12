import { Nav } from '../ui/Nav';
import { DigestStack } from './DigestStack';
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
        <section className="glass-lg col-main">
          <h2 className="h2">Sent digests</h2>
          <p className="note" style={{ marginTop: -4 }}>
            Click a card behind, or use the arrows, to bring it forward. The
            preview below follows whichever card is in front.
          </p>
          {/* The stack owns the preview: a card swap that left the preview on a
              different digest would be worse than the plain list it replaced. */}
          <DigestStack
            digests={digests}
            selectedId={selectedId!}
            initialHtml={selected?.html ?? ''}
          />
        </section>
      )}
    </main>
  );
}
