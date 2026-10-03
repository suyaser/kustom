'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { groupHome, groupNavItems, isCurrentTab, WORDMARK } from '@/lib/nav';
import { ThemeToggle } from './ThemeToggle';

/**
 * The top bar (05-design.md, "The app shell"): identity on the left, destinations in the
 * middle, theme on the right. The live pill still belongs to the status strip. The theme
 * choice is this device's and is the one piece of chrome the bar is allowed to hold.
 *
 * **The identity is a lockup** (05-design.md, "The group in the shell", M13.7): `▍KUSTOM` on row
 * one, the group's name under it on row two, aligned with the `K`, one link to the group's
 * tonight page. Not `/`: that resolves through a cookie to whichever group was opened last, and
 * every link on `/g/a/*` must start with `/g/a/` (M13.9). The name is printed as text, as
 * somebody typed it, never upper-cased; it is not a switcher and has no chevron.
 *
 * A client component for one reason: the current tab is the one the reader is on, and that is
 * `usePathname()`. Everything it renders is server-rendered first, so the bar is in the first
 * paint of a WhatsApp link with no JavaScript needed to read it.
 *
 * Phone: two 44px rows, lockup then tabs. Desktop: one row. Not sticky — a sticky bar costs
 * 88px of a 700px screen on the one page people read in full.
 */
export function TopBar({ group, isAdmin }: { group: PageGroup; isAdmin: boolean }) {
  const pathname = usePathname();
  const items = groupNavItems(group, { isAdmin });

  return (
    <header className="cn-topbar">
      <div className="cn-topbar-inner">
        <Link className="cn-wordmark" href={groupHome(group)}>
          {/* The 3px amber bar is the lamp, and it is the entire logo. No image, no crest. */}
          <span className="cn-wordmark-bar" aria-hidden="true" />
          <span className="cn-display cn-wordmark-text">{WORDMARK}</span>
          {/* The link reads `KUSTOM Customs Night`: a space, not an `aria-label`. A whitespace
              node in a grid container is not laid out, so it costs nothing on screen. */}{' '}
          <span className="cn-wordmark-group">{group.name}</span>
        </Link>

        <ThemeToggle />

        <nav className="cn-tabs" aria-label="Sections">
          {items.map((item) => {
            if (item.external === true) {
              return (
                <a
                  key={item.label}
                  className="cn-tab"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {item.label}
                </a>
              );
            }
            const current = isCurrentTab(item, pathname, group);
            return (
              <Link
                key={item.label}
                className={current ? 'cn-tab cn-tab-on' : 'cn-tab'}
                href={item.href}
                aria-current={current ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
