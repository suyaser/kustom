import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/adminPage';
import { WORDMARK } from '@/lib/nav';
import { ThemeToggle } from '../../_shell/ThemeToggle';
import { AdminNav } from '../_components/AdminNav';

export const dynamic = 'force-dynamic';

/**
 * The gate. Every page in this route group is admin-only, checked here, server-side, against
 * `players.is_admin` — never in the browser and never from anything the request supplied.
 *
 * The route group `(dashboard)` keeps `/admin/login` out of it while leaving the URLs alone:
 * this layout wraps `/admin`, `/admin/players`, `/admin/tokens`, `/admin/games`,
 * `/admin/discord` and `/admin/seasons`.
 */
export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const who = admin.discordName ?? admin.displayName ?? admin.puuid;

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          <span className="cn-wordmark-bar" aria-hidden="true" />
          <span className="cn-display admin-brand-mark">{WORDMARK}</span>
          <span className="admin-brand-chip">admin</span>
        </Link>

        <AdminNav />

        <div className="admin-identity">
          <p className="admin-identity-name">signed in as {who}</p>
          <p className="admin-muted admin-identity-meta">(discord {admin.discordId})</p>
          <div className="admin-identity-actions">
            <ThemeToggle />
            <form method="post" action="/auth/signout">
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="admin-content">{children}</div>
    </div>
  );
}
