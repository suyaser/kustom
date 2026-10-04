import Link from 'next/link';
import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { SkipLink } from './SkipLink';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

/**
 * The Kustom-level shell (STRATEGY 2.5): the wordmark, no group and no tabs, and the footer (Riot's notice on every page). Used
 * where no group is known: the root 404, an unknown group, the root error page.
 */
export function BareShell({ children, headerEnd }: { children: ReactNode; headerEnd?: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-page text-foreground">
      <SkipLink />
      <header className="border-b border-border bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex min-h-(--topbar-h) w-full max-w-7xl items-center justify-between gap-3 px-(--gutter)">
          <Link href="/" className="flex min-h-11 items-center rounded-control">
            <Wordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {/* Day / Night on every page (M14.47). */}
            <ThemeToggle />
            {/* Kustom's own pages put `Sign in` here (STRATEGY 2.5: wordmark, sign-in, no tabs). */}
            {headerEnd}
          </div>
        </div>
      </header>
      {/* tabIndex -1: the skip link moves focus here in browsers that only scroll to a fragment. */}
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <Footer />
    </div>
  );
}
