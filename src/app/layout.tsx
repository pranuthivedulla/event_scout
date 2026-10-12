import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Event Scout',
  description: 'Industry events worth Vikram’s Monday, found and ranked.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="blobs" aria-hidden>
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <div className="blob blob-4" />
        </div>
        {children}
      </body>
    </html>
  );
}
