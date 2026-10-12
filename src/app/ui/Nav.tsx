import Link from 'next/link';

const TABS = [
  { href: '/', label: 'This week' },
  { href: '/settings', label: 'Settings' },
  { href: '/digests', label: 'Digests' },
];

export function Nav({ here }: { here: string }) {
  return (
    <header className="glass topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M8 3v4M16 3v4M3 10h18" />
          </svg>
        </div>
        <div className="brand-name">Event Scout</div>
      </div>
      <nav className="nav" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={t.href === here ? 'on' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="who">
        <div className="avatar">V</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Vikram</div>
      </div>
    </header>
  );
}
