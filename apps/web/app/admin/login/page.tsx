import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SkipLink } from '@/components/shell/SkipLink';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { Wordmark } from '@/components/shell/Wordmark';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SIGN_IN_WITH_DISCORD_LABEL } from '@/lib/shellCopy';
import { loginViewer } from './adminGroup';
import {
  ADMIN_LOGIN_DENIED,
  ADMIN_LOGIN_DENIED_HELP,
  ADMIN_LOGIN_ERROR,
  ADMIN_LOGIN_LEAD,
  ADMIN_LOGIN_PUBLIC,
  ADMIN_LOGIN_SIGNED_IN,
  ADMIN_LOGIN_TITLE,
  OPEN_ADMIN_LABEL,
  PUBLIC_HOME_LABEL,
  USE_ANOTHER_ACCOUNT_LABEL,
} from './copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in · Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * `/admin/login`, 2.0 (M14.23 follow-up): the bare shell's look (wordmark, one card, Riot's notice
 * in the layout's footer), Direction C.
 *
 * - Signed out: `Sign in with Discord` as a plain POST form (no JavaScript), coming back here.
 * - Signed in and running a group: a link to that group's admin (`/g/<slug>/admin`), never the
 *   bare `/admin`, which only knows the original group.
 * - Signed in and running no group: the denied line, the way to fix it (an admin adds you on the
 *   group's Members page), and `Sign out`.
 * - Signed in, not linked yet, and the creator of a group (M14.51): straight to that group's admin.
 *
 * `?error=` (the OAuth round trip refused) is printed as an alert. Nothing here writes.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; denied?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const viewer = await loginViewer();
  // M14.51: the creator before they link has no other door to their admin home; send them there,
  // the same landing `/new` gave them. (Outside any try: `redirect` throws by design.)
  if (viewer.kind === 'creator-unlinked') redirect(viewer.href);
  const denied =
    viewer.kind === 'denied' || (viewer.kind === 'anonymous' && typeof params.denied === 'string');

  return (
    <div className="flex flex-1 flex-col">
      <SkipLink />
      <header className="border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex min-h-(--topbar-h) w-full max-w-7xl items-center justify-between gap-3 px-(--gutter)">
          <Link href="/" className="flex min-h-11 items-center rounded-control">
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-(--gutter) py-8 lg:py-16"
      >
        <Card className="w-full max-w-md">
          <div className="flex flex-col gap-4 p-(--card-pad)">
            <h1 className="text-xl font-bold text-balance">{ADMIN_LOGIN_TITLE}</h1>

            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {ADMIN_LOGIN_ERROR(error)}
              </p>
            )}

            {viewer.kind === 'runs-group' ? (
              <>
                <p className="text-base">{ADMIN_LOGIN_SIGNED_IN}</p>
                <Button asChild className="w-full md:w-auto md:self-start">
                  <Link href={viewer.href}>{OPEN_ADMIN_LABEL}</Link>
                </Button>
              </>
            ) : denied ? (
              <>
                <p role="alert" className="text-base font-bold">
                  {ADMIN_LOGIN_DENIED}
                </p>
                <p className="text-sm text-pretty text-muted-foreground">{ADMIN_LOGIN_DENIED_HELP}</p>
                {viewer.kind === 'denied' ? (
                  <form method="post" action="/auth/signout">
                    <input type="hidden" name="next" value="/admin/login" />
                    <Button type="submit" variant="secondary" className="w-full md:w-auto">
                      {USE_ANOTHER_ACCOUNT_LABEL}
                    </Button>
                  </form>
                ) : null}
              </>
            ) : null}

            {viewer.kind === 'anonymous' ? (
              <>
                {denied ? null : <p className="text-base text-pretty">{ADMIN_LOGIN_LEAD}</p>}
                <form method="post" action="/auth/signin">
                  <input type="hidden" name="next" value="/admin/login" />
                  <Button type="submit" className="w-full md:w-auto">
                    {SIGN_IN_WITH_DISCORD_LABEL}
                  </Button>
                </form>
              </>
            ) : null}

            <p className="border-t border-border pt-4 text-sm text-pretty text-muted-foreground">
              {ADMIN_LOGIN_PUBLIC}{' '}
              <Link href="/" className="font-bold text-foreground underline underline-offset-3">
                {PUBLIC_HOME_LABEL}
              </Link>
            </p>
          </div>
        </Card>
      </main>
    </div>
  );
}
