import type { Route } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * A picker that is links, styled as a segmented control (docs/05-design.md 5.0, "Tabs / ToggleGroup:
 * ban as state; borrow the look"; redesign/nav/proposal.md `seg-links`). Every option is a URL with
 * `aria-current`, so it works with no JavaScript and survives a reload. 44px options, equal widths,
 * the current one on `--raised` with a 3px `--primary-text` underline (shape and weight, not colour
 * alone). Shared by the Games filters and, from M14.17, the Stats segments.
 */
export interface SegLink {
  label: string;
  href: string;
  current: boolean;
}

export function SegLinks({
  label,
  items,
  className,
}: {
  /** The group's accessible name (`Date`, `Mode`). */
  label: string;
  items: readonly SegLink[];
  className?: string | undefined;
}) {
  return (
    <nav aria-label={label} className={cn('min-w-0', className)}>
      <ul className="grid auto-cols-fr grid-flow-col gap-1 rounded-control border border-border-strong bg-background p-1">
        {items.map((item) => (
          <li key={item.href} className="flex min-w-0">
            <Link
              prefetch="auto"
              href={item.href as Route}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                'flex min-h-11 w-full items-center justify-center rounded-chip px-2.5 text-center text-base leading-tight font-bold text-muted-foreground no-underline',
                'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:text-foreground',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'aria-[current=page]:bg-raised aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-3px_0_var(--primary-text)]',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
