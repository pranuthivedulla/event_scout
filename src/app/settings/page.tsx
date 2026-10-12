import { Nav } from '../ui/Nav';
import { SettingsForm } from './SettingsForm';
import { getSettings, getSettingsUpdatedAt, hasDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SettingsPage() {
  if (!hasDatabase()) {
    return (
      <main className="page">
        <Nav here="/settings" />
        <section className="glass-lg panel">
          <h1 className="h1">Not connected yet</h1>
          <p className="sub">DATABASE_URL is not set, so there are no settings to edit.</p>
        </section>
      </main>
    );
  }

  const [settings, updatedAt] = await Promise.all([getSettings(), getSettingsUpdatedAt()]);

  return (
    <main className="page">
      <Nav here="/settings" />
      <div style={{ padding: '4px 4px 0' }}>
        <h1 className="h1">Settings</h1>
        <p className="sub">
          Set these once and edit them whenever your practice shifts.
          Changes apply from the next Monday run.
        </p>
      </div>
      <SettingsForm initial={settings} updatedAt={updatedAt} />
    </main>
  );
}
