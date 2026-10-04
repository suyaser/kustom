'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { ADMIN_TAB_LABEL, currentMainTab, groupHome, groupHref, mainTabs } from '@/lib/nav';
import { MAIN_NAV_LABEL, SIGN_IN_LABEL } from '@/lib/shellCopy';
import { cn } from '@/lib/utils';
import { TabIcon } from './TabIcon';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

export type ShellAccount = 'anonymous' | 'signed-in';

/**
 * The top bar (05-design.md 5.11; five sections since M14.7b). 60px, `--card`, a `--border` bottom
 * edge, not sticky.
 *
 * - Phone and tablet: the lockup only. `KUSTOM`, then the group's name, one link to the group's
 *   tonight page. The name is printed as typed and **wraps, never clipped**. No switcher, no tabs
 *   (they are the bottom bar). The Day / Night toggle (M14.47) sits at the far end.
 * - From 1024px: the lockup, then the same five sections as a `Main` nav (the bottom bar is hidden
 *   there): `Tonight · Board · Games · Stats` in the middle and, on the right, `Admin` for this group's
 *   admins and the bordered `You` button. Signed out, `Sign in` follows as a real POST form (no
 *   JavaScript needed). Account menus are banned (5.0); You is a page. The Day / Night
 *   toggle sits between the nav and `Sign in` (M14.47).
 */
export function TopBar({
  group,
  isAdmin,
  account,
}: {
  group: PageGroup;
  isAdmin: boolean;
  account: ShellAccount;
}) {
  const pathname = usePathname();
  const tabs = mainTabs(group);
  const sections = tabs.filter((tab) => tab.key !== 'you');
  const you = tabs.find((tab) => tab.key === 'you');
  const current = currentMainTab(pathname, group);
  const admin = isAdmin ? groupHref(group, { page: 'admin' }) : null;

  return (
    <header className="border-b border-border bg-card pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-(--topbar-h) w-full max-w-7xl items-center gap-x-6 px-(--gutter)">
        <Link
          href={groupHome(group)}
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-control py-2"
        >
          <Wordmark />{' '}
          <span className="min-w-0 border-s border-border ps-3 text-sm leading-snug font-bold hyphens-auto [overflow-wrap:anywhere]">
            {group.name}
          </span>
        </Link>

        <nav aria-label={MAIN_NAV_LABEL} className="hidden flex-1 items-center gap-2 self-stretch lg:flex">
          <div className="flex self-stretch">
            {sections.map((tab) => {
              const active = tab.key === current;
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center border-b-[3px] border-transparent px-3.5 font-bold text-muted-foreground hover:text-foreground',
                    'focus-visible:-outline-offset-4',
                    active && 'border-primary-text text-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <div className="ms-auto flex items-center gap-2">
            {admin === null ? null : (
              <Link
                href={admin}
                className="flex min-h-11 items-center rounded-control px-3 font-bold text-muted-foreground hover:text-foreground"
              >
                {ADMIN_TAB_LABEL}
              </Link>
            )}
            {you === undefined ? null : (
              <Link
                href={you.href}
                aria-current={current === 'you' ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-control border border-border-strong px-3 font-bold hover:bg-accent',
                  current === 'you' && 'shadow-[inset_0_-3px_0_var(--primary-text)]',
                )}
              >
                <TabIcon tab="you" active={current === 'you'} />
                {you.label}
              </Link>
            )}
          </div>
        </nav>

        {/* Day / Night at every width (M14.47): pushed to the end below 1024px, where the nav is hidden. */}
        <div className="ms-auto shrink-0 lg:ms-0">
          <ThemeToggle />
        </div>

        {account === 'anonymous' ? (
          <form action="/auth/signin" method="post" className="hidden lg:block">
            <input type="hidden" name="next" value={pathname} />
            <button
              type="submit"
              className="flex min-h-11 cursor-pointer items-center rounded-control bg-primary px-4 font-bold text-primary-foreground hover:bg-primary/90"
            >
              {SIGN_IN_LABEL}
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
