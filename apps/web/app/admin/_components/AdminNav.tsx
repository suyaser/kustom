'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Destinations inside `/admin`. A client component for one reason: the current
 * item is the path the reader is on, and that is `usePathname()`.
 *
 * `/admin` matches only itself — every other admin path would otherwise light
 * the index. Tonight is a way out, not a current tab.
 */

const ITEMS: readonly { href: Route; label: string }[] = [
  { href: '/admin', label: 'Admin' },
  { href: '/admin/players', label: 'Players' },
  { href: '/admin/tokens', label: 'Tokens' },
  { href: '/admin/games', label: 'Games' },
  { href: '/admin/discord', label: 'Discord' },
  { href: '/admin/seasons', label: 'Seasons' },
];

function isCurrent(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Admin">
      {ITEMS.map((item) => {
        const current = isCurrent(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={current ? 'admin-nav-link admin-nav-link-on' : 'admin-nav-link'}
            aria-current={current ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
      <Link href="/" className="admin-nav-link">
        Tonight
      </Link>
    </nav>
  );
}
