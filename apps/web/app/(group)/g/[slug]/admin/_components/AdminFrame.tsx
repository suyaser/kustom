import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ADMIN_NAV_LABEL, backToGroupLabel } from '@/lib/admin/homeCopy';
import { ADMIN_READ_ONLY_LINE } from '@/lib/admin/readView';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { cn } from '@/lib/utils';

export interface AdminNavItem {
  label: string;
  href: Route;
  current: boolean;
}

/**
 * Every group admin page's frame (M14.22; M13.14): the link back to the group's own pages first (the
 * user's request), the admin pages as links styled as a segmented control (05-design 5.14: URL-owned,
 * `aria-current`, 44px, wrapping at 375), the page's one h1, and for the operator the hairline
 * `Read only. You are not an admin of this group.` A 2.0 root inside the group's shell.
 */
export function AdminFrame({
  group,
  title,
  nav,
  readOnly = false,
  wide = false,
  children,
}: {
  group: PageGroup;
  title: string;
  /** Empty for a state with nowhere else to go (signed out, the creator before pairing). */
  nav: readonly AdminNavItem[];
  readOnly?: boolean;
  /** A table page (Members): a wider reading column so its columns do not wrap at 1440. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex-1">
      <div
        className={cn(
          'mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 lg:py-8',
          wide ? '*:max-w-5xl' : '*:max-w-3xl',
        )}
      >
        {/* Wrapped so the column's `*:max-w-3xl` lands on the div and the link can truncate at 375. */}
        <div className="flex min-w-0">
          <BackLink href={`/g/${encodeURIComponent(group.slug)}` as Route}>
            {backToGroupLabel(group.name)}
          </BackLink>
        </div>
        {nav.length > 1 ? (
          <nav aria-label={ADMIN_NAV_LABEL}>
            <ul className="flex flex-wrap gap-2">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    prefetch="auto"
                    href={item.href}
                    aria-current={item.current ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-control border border-border-strong px-4 text-sm font-bold text-muted-foreground hover:bg-accent',
                      'aria-[current=page]:border-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <h1 className="font-display text-xl font-black tracking-[0.02em] font-stretch-70%">{title}</h1>
        {readOnly ? (
          <p className="border-y border-border py-2 text-sm text-muted-foreground">{ADMIN_READ_ONLY_LINE}</p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function BackLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      prefetch="auto"
      href={href}
      className="-ms-1 inline-flex min-h-11 w-fit max-w-full items-center gap-1 rounded-control px-1 text-sm font-bold text-foreground"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-5 shrink-0">
        <path
          d="m15 6-6 6 6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* One line: a long group name ellipsizes here (designer round 1); the top bar and the link's
          own text keep it in full for a screen reader. */}
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}
