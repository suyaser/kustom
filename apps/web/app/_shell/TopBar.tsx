'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isCurrentTab, NAV_ITEMS, WORDMARK } from '@/lib/nav';
import { ThemeToggle } from './ThemeToggle';

/**
 * The top bar (05-design.md, "The app shell"): identity on the left, destinations in the
 * middle, theme on the right. The live pill still belongs to the status strip. The theme
 * choice is this device's and is the one piece of chrome the bar is allowed to hold.
 *
 * A client component for one reason: the current tab is the one the reader is on, and that is
 * `usePathname()`. Everything it renders is server-rendered first, so the bar is in the first
 * paint of a WhatsApp link with no JavaScript needed to read it.
 *
 * Phone: two 44px rows, wordmark then tabs. Desktop: one row. Not sticky — a sticky bar costs
 * 88px of a 700px screen on the one page people read in full.
 */
export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="cn-topbar">
      <div className="cn-topbar-inner">
        <Link className="cn-wordmark" href="/">
          {/* The 3px amber bar is the lamp, and it is the entire logo. No image, no crest. */}
          <span className="cn-wordmark-bar" aria-hidden="true" />
          <span className="cn-display cn-wordmark-text">{WORDMARK}</span>
        </Link>

        <ThemeToggle />

        <nav className="cn-tabs" aria-label="Sections">
          {NAV_ITEMS.map((item) => {
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
            const current = isCurrentTab(item, pathname);
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
