import type { Route } from 'next';
import Link from 'next/link';
import { WINDOW_PICKER_LABEL, windowLabel } from '@/lib/board/copy';
import { WINDOW_ORDER, windowHref } from '@/lib/board/window';
import type { WindowKind } from '@/lib/night';
import { cn } from '@/lib/utils';

/**
 * The window picker, 2.0 (05-design 5.14, 5.0 "Tabs: ban as state; borrow the look"): three links
 * styled as a segmented control, 44px, one row at 375 (wrapping if a reset label runs long), the current one marked with
 * `aria-current="page"` and by weight and an underline, never colour alone. URL-owned state: each
 * link is a full URL, so the page works without JavaScript and a copied link says which board.
 *
 * `query` carries the rest of the page's state (the sort) across a window change. `resetDay` (M14.18):
 * once the group has reset its ratings, `All time` reads `Since 1 Nov`.
 */
export function WindowChips({
  path,
  selected,
  query = {},
  resetDay = null,
}: {
  path: string;
  selected: WindowKind;
  query?: Record<string, string>;
  resetDay?: string | null;
}) {
  return (
    <nav aria-label={WINDOW_PICKER_LABEL}>
      <ul className="flex flex-wrap gap-2">
        {WINDOW_ORDER.map((kind) => {
          const current = kind === selected;
          return (
            <li key={kind}>
              <Link
                href={windowHref(path, kind, query) as Route}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-control border border-border-strong bg-card px-3 text-sm whitespace-nowrap',
                  'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:bg-accent active:scale-[.98]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  current &&
                    'border-foreground bg-raised font-bold text-foreground shadow-[inset_0_-3px_0_var(--primary-text)]',
                )}
              >
                {windowLabel(kind, resetDay)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
