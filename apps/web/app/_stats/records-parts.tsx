import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HOW_THESE_COUNT } from '@/lib/stats/copy';
import { funRoast } from '@/lib/stats/funCopy';
import { cn } from '@/lib/utils';

/**
 * The Records segment's parts (M14.17 design round 1, the Records ruling): every section is a
 * native `<details>` showing its name and how many lines it holds (One game is open by default),
 * every record is **one row link of at most two lines** (title and the mono value, then holder ·
 * date · duration), and each section explains its rules once, in a `How these count` disclosure,
 * instead of under every row. No cap and no per-record disclosure.
 */

export interface RecordRule {
  title: string;
  rule: string;
}

export function RecordSection({
  id,
  title,
  count,
  open = false,
  intro,
  rules,
  roasts,
  children,
}: {
  id: string;
  title: string;
  /** How many rows the section holds: shown on the closed summary. */
  count: number;
  open?: boolean;
  intro?: string | undefined;
  rules?: readonly RecordRule[] | undefined;
  /** `StatsLinks.roasts`: the Arabic roast line for the original group only (M14.42). */
  roasts: boolean;
  children: ReactNode;
}) {
  const roast = roasts ? funRoast(title) : null;
  const explain = rules?.filter((rule) => rule.rule.trim() !== '') ?? [];
  return (
    <details
      id={id}
      open={open}
      className="group/section mb-4 scroll-mt-20 break-inside-avoid overflow-hidden rounded-card border border-border bg-card lg:mb-5"
    >
      <summary
        className={cn(
          'flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-(--card-pad) py-2 [&::-webkit-details-marker]:hidden',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-md leading-tight font-bold text-balance">{title}</h2>
          {roast === null ? null : (
            <span lang="ar" dir="rtl" className="text-xs text-muted-foreground">
              {roast}
            </span>
          )}
        </span>
        <span className="num text-sm text-muted-foreground">{count}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-(--dur-base) group-open/section:rotate-180"
        >
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </summary>
      {intro === undefined ? null : (
        <p className="border-t border-border px-(--card-pad) py-2 text-sm text-pretty text-muted-foreground">
          {intro}
        </p>
      )}
      {children}
      {explain.length === 0 ? null : (
        <details className="group/how border-t border-border">
          <summary
            className={cn(
              'flex min-h-11 cursor-pointer list-none items-center px-(--card-pad) text-sm font-bold text-primary-text [&::-webkit-details-marker]:hidden',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
            )}
          >
            {HOW_THESE_COUNT}
          </summary>
          <dl className="flex flex-col gap-2 px-(--card-pad) pb-3 text-sm">
            {explain.map((rule) => (
              <div key={`${rule.title}|${rule.rule}`}>
                <dt className="font-bold">{rule.title}</dt>
                <dd className="text-pretty text-muted-foreground">{rule.rule}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </details>
  );
}

/** A role or sub-list label inside a section. */
export function RecordGroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-t border-border px-(--card-pad) pt-2.5 pb-1 text-xs font-bold text-muted-foreground">
      {children}
    </h3>
  );
}

export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border border-t border-border">{children}</ul>;
}

/**
 * One record: a single link (or plain row with nowhere to go), at most two lines. `rule` is the
 * row's `title` (the section's `How these count` says it for touch).
 */
export function RecordRow({
  title,
  value,
  line,
  href,
  rule,
  muted = false,
  truncateTo,
}: {
  title: ReactNode;
  /**
   * A one-line title (By role's names, 05-design §5.14a): truncated with an ellipsis, the full
   * text in the cell's `title`, so a long Riot ID never breaks mid-token.
   */
  truncateTo?: string | undefined;
  value?: ReactNode;
  line?: ReactNode;
  href?: string | null | undefined;
  rule?: string | undefined;
  muted?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          'min-w-0 text-sm font-bold',
          truncateTo === undefined ? '[overflow-wrap:break-word]' : 'truncate',
          muted && 'font-normal text-muted-foreground',
        )}
        title={truncateTo}
      >
        {title}
      </span>
      {value === undefined ? (
        <span />
      ) : (
        <span className="num text-end text-sm whitespace-nowrap">{value}</span>
      )}
      {line === undefined || line === null ? null : (
        <span className="col-span-2 text-xs text-pretty text-muted-foreground [overflow-wrap:break-word]">
          {line}
        </span>
      )}
    </>
  );
  const className =
    'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] content-center gap-x-3 px-(--card-pad) py-1';
  return (
    <li>
      {href === undefined || href === null ? (
        <div className={className} title={rule}>
          {body}
        </div>
      ) : (
        <Link
          href={href as Route}
          title={rule}
          className={cn(
            className,
            'text-foreground no-underline transition-colors duration-(--dur-fast) hover:bg-accent active:bg-accent',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          )}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
