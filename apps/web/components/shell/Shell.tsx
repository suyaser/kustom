import type { ReactNode } from 'react';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { Footer } from './Footer';
import { SkipLink } from './SkipLink';
import { TabBar } from './TabBar';
import { type ShellAccount, TopBar } from './TopBar';

/**
 * The Kustom 2.0 shell for one group's pages (M14.7; STRATEGY 2.5, 05-design.md 5.11). Mounted by
 * `app/(group)/g/[slug]/layout.tsx`. The 1.0 shell (`app/_shell`, the `(site)` pages) is gone
 * (M14.25); only `app/_shell/PageGroup.tsx`, the group context, is left there.
 *
 * DOM order: the skip link, the bottom bar's `<nav aria-label="Main">` (fixed, so its place in the
 * source does not move it on screen), the top bar, `<main id="main">`, the footer. Exactly one h1 per
 * page and it is the page's: the shell has none (the wordmark is never the h1, 6.3).
 *
 * The outer box is only the page surface (`bg-page`, 7.3's glow) and the room the fixed bar needs.
 */
export interface ShellProps {
  children: ReactNode;
  group: PageGroup;
  /** Decided on the server from the session; draws `Admin`. The admin pages check again. */
  isAdmin: boolean;
  account: ShellAccount;
}

export function Shell({ children, group, isAdmin, account }: ShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-page pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] text-foreground lg:pb-0">
      <SkipLink />
      <TabBar group={group} />
      <TopBar group={group} isAdmin={isAdmin} account={account} />
      {/* tabIndex -1: the skip link moves focus here in browsers that only scroll to a fragment. */}
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <Footer inGroup />
    </div>
  );
}
