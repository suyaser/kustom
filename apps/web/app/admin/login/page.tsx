import type { Metadata } from 'next';
import Link from 'next/link';
import { currentAdminOrNull } from '@/lib/adminPage';
import { WORDMARK } from '@/lib/nav';
import { readParam, type SearchParams } from '../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * The only ungated page under `/admin`.
 *
 * A plain form posting to `/auth/signin`, so signing in needs no client JavaScript. It also
 * doubles as the "you are signed in but you are not an admin" page — bouncing that case
 * anywhere else would loop — which is where the bootstrap story surfaces: a session whose
 * Discord id matches no player says so, and the fix is `BOOTSTRAP_ADMIN_DISCORD_ID` or another
 * admin linking the id on `/admin/players`.
 */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const denied = readParam(params, 'denied');
  const error = readParam(params, 'error');

  const session = await currentAdminOrNull();
  const isAdmin = session?.ok === true;
  // A 403 is the only status that means "there is a session"; 401 means there is none.
  const signedInButNotAdmin = session !== null && !session.ok && session.status === 403;

  return (
    <div className="admin-login">
      <main className="admin-card admin-login-card">
        <div className="admin-card-head">
          <Link href="/" className="admin-brand">
            <span className="cn-wordmark-bar" aria-hidden="true" />
            <span className="cn-display admin-brand-mark">{WORDMARK}</span>
            <span className="admin-brand-chip">admin</span>
          </Link>
        </div>
        <div className="admin-card-body">
          <h1>Kustom admin</h1>

          {error === null ? null : (
            <p className="admin-error" role="alert">
              Sign-in failed: {error}
            </p>
          )}
          {denied === null ? null : (
            <p className="admin-error" role="alert">
              {denied}. If nobody has linked your Discord account to your player yet, ask an admin to do it on
              the players page.
            </p>
          )}

          {session === null ? (
            <p className="admin-error" role="alert">
              The server could not check the session. Check the Supabase environment variables.
            </p>
          ) : null}

          {isAdmin ? (
            <p>
              You are signed in as an admin. <Link href="/admin">Go to the admin area</Link>.
            </p>
          ) : (
            <form method="post" action="/auth/signin">
              <input type="hidden" name="next" value="/admin" />
              <button type="submit" className="admin-primary">
                Sign in with Discord
              </button>
            </form>
          )}

          {signedInButNotAdmin ? (
            <form method="post" action="/auth/signout">
              <button type="submit">Sign out</button>
            </form>
          ) : null}

          <p className="admin-muted">
            Everything else on this site is public and needs no account. <Link href="/">Tonight</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
