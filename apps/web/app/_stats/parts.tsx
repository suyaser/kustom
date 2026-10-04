import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RoleIcon } from '@/app/_icons/RoleIcon';
import type { HistoryGame } from '@/lib/games/types';
import {
  moreGamesLabel,
  SHOW_FEWER,
  STATS_OPENINGS_SHOWN,
  STATS_ROWS_SHOWN,
  seeGamesLabel,
  showAllLabel,
} from '@/lib/stats/copy';
import { funRoast, THIS_GAME } from '@/lib/stats/funCopy';
import type { PlayerRef } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { cn } from '@/lib/utils';
import { versusRoast } from '@/lib/versus/copy';

/**
 * The 2.0 parts every Stats segment is built from (M14.17; docs/05-design.md 5.2, 5.7). Server
 * components, no client JavaScript.
 *
 * **Why the page is small now.** 1.0's `/fun` opened every record into both scoreboards inline
 * (a `<details>` holding a whole match sheet), for every game behind every row, which is how all
 * time reached 58 MB. Here a game is a **link to its game page**, a list shows its first
 * {@link STATS_ROWS_SHOWN} rows with `Show all` for the rest of that one list, and a row lists its
 * first {@link STATS_OPENINGS_SHOWN} games with the rest one tap away on the Games list.
 */

/** Every link a segment prints, built by the page from the group (`lib/nav.ts`). */
export interface StatsLinks {
  /** A player's page, or `null` where this group has none yet. */
  player: (puuid: string) => string | null;
  /** `/g/<slug>/games/<id>`. */
  game: (gameId: string) => string;
  /** The Games list filtered to one player, all time: where a row's other games are. */
  playerGames: (puuid: string) => string;
  /** This segment's URL with `?all=<listId>`: that one list uncapped. */
  showAll: (listId: string) => string;
  /** This segment's URL without `?all=`, back to the list. */
  showFewer: (listId: string) => string;
  /** The list `?all=` names, or `null`. */
  expanded: string | null;
  /**
   * Whether section titles carry the Egyptian Arabic roast line. Not a link, but it rides here
   * because every section's caller already holds this object. The roasts were the original
   * group's own request (decision row 2026-09-12), so only `customs` gets them, by id
   * (`isOriginalGroup`, M14.42); every other group sees the English heading alone.
   */
  roasts: boolean;
}

/**
 * A titled card (05-design 5.0 Card): h2, the 1.0 roast line in Arabic when the title has one and
 * the group gets roasts ({@link StatsLinks.roasts}).
 */
export function StatSection({
  id,
  title,
  intro,
  rule,
  roasts,
  children,
}: {
  id: string;
  title: string;
  intro?: string | undefined;
  rule?: string | undefined;
  /** {@link StatsLinks.roasts}. Required, so no section can forget to ask. */
  roasts: boolean;
  children: ReactNode;
}) {
  const roast = roasts ? (funRoast(title) ?? versusRoast(title)) : null;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 overflow-hidden rounded-card border border-border bg-card"
    >
      <header className="flex flex-col gap-1 px-(--card-pad) pt-(--card-pad) pb-3">
        <h2 id={`${id}-title`} className="text-md leading-tight font-bold text-balance">
          {title}
        </h2>
        {roast === null ? null : (
          <p lang="ar" dir="rtl" className="text-xs text-muted-foreground">
            {roast}
          </p>
        )}
        {intro === undefined ? null : <p className="text-sm text-pretty text-muted-foreground">{intro}</p>}
      </header>
      {children}
      {rule === undefined ? null : (
        <p className="border-t border-border px-(--card-pad) py-2.5 text-xs text-pretty text-muted-foreground">
          {rule}
        </p>
      )}
    </section>
  );
}

/** A titled block inside a card: h3, its own rule line under it. */
export function SubBlock({
  title,
  rule,
  roasts,
  children,
  icon,
}: {
  title: string;
  rule?: string | undefined;
  /** {@link StatsLinks.roasts}. */
  roasts: boolean;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const roast = roasts ? (funRoast(title) ?? versusRoast(title)) : null;
  return (
    <div className="border-t border-border">
      <div className="flex flex-col gap-0.5 px-(--card-pad) pt-3 pb-1">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          {icon}
          {title}
        </h3>
        {roast === null ? null : (
          <p lang="ar" dir="rtl" className="text-xs text-muted-foreground">
            {roast}
          </p>
        )}
      </div>
      {children}
      {rule === undefined ? null : (
        <p className="px-(--card-pad) pb-3 text-xs text-pretty text-muted-foreground">{rule}</p>
      )}
    </div>
  );
}

/** The role word with its icon (the icon never alone, 05-design 5.1). */
export function RoleTitle({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono font-stretch-75%">
      <RoleIcon role={role as Parameters<typeof RoleIcon>[0]['role']} size={16} />
      {role}
    </span>
  );
}

/** A section's or block's one-sentence empty state (05-design 5.7), inside the card. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-(--card-pad) py-3 text-sm text-muted-foreground">{children}</p>;
}

/** A name, linked to their page when the group has one. Wraps, never truncates (6.6). */
export function PlayerName({ player, links }: { player: PlayerRef; links: StatsLinks }) {
  const name = renderWebName(player.name);
  const href = links.player(player.puuid);
  // Inline vertical padding widens the tap target to 44px without moving the line (6.7).
  const className = 'font-bold [overflow-wrap:break-word]';
  if (href === null) return <span className={className}>{name}</span>;
  return (
    <Link
      href={href as Route}
      className={cn(
        className,
        'py-[11px] text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {name}
    </Link>
  );
}

/** The first rows of a list, unless `?all=` names it. */
export function capRows<T>(
  rows: readonly T[],
  listId: string,
  links: StatsLinks,
): { shown: readonly T[]; total: number } {
  const all = links.expanded === listId;
  return { shown: all ? rows : rows.slice(0, STATS_ROWS_SHOWN), total: rows.length };
}

/** `Show all 23` under a capped list, `Show fewer` under an expanded one, nothing otherwise. */
export function ShowAll({ listId, total, links }: { listId: string; total: number; links: StatsLinks }) {
  if (total <= STATS_ROWS_SHOWN) return null;
  const expanded = links.expanded === listId;
  return (
    <p className="border-t border-border px-(--card-pad)">
      <Link
        href={(expanded ? links.showFewer(listId) : links.showAll(listId)) as Route}
        className="inline-flex min-h-11 items-center text-sm font-bold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {expanded ? SHOW_FEWER : showAllLabel(total)}
      </Link>
    </p>
  );
}

/** A ranked list's container. Rows are divided by a hairline (2.5). */
export function Rows({ children, ordered = true }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className="divide-y divide-border border-t border-border">{children}</Tag>;
}

/**
 * One row: who on the left (wrapping), the number on the right in mono, and anything under it
 * (a detail line, a game link, the games behind the number) across the row.
 */
export function Row({
  who,
  value,
  detail,
  gameHref,
  children,
}: {
  who: ReactNode;
  value?: ReactNode;
  detail?: ReactNode;
  /**
   * The one game this number came from: the detail line (`22 Aug · 23 min`, or `This game`
   * when there is none) becomes the link to its game page, so a record is one row, not two.
   */
  gameHref?: string | undefined;
  children?: ReactNode;
}) {
  const line = detail === undefined || detail === null ? (gameHref === undefined ? null : THIS_GAME) : detail;
  return (
    <li className="flex min-h-(--row-min-h) flex-col justify-center gap-1 px-(--card-pad) py-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
        <div className="min-w-0 text-base [overflow-wrap:break-word]">{who}</div>
        {value === undefined ? (
          <span />
        ) : (
          <div className="num max-w-[16ch] text-end text-sm text-pretty sm:max-w-none">{value}</div>
        )}
      </div>
      {line === null ? null : gameHref === undefined ? (
        <p className="text-xs text-pretty text-muted-foreground">{line}</p>
      ) : (
        <p className="text-xs text-pretty">
          <Link
            href={gameHref as Route}
            className="py-3 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {line}
          </Link>
        </p>
      )}
      {children}
    </li>
  );
}

const LINK = cn(
  'inline-flex min-h-11 items-center text-sm text-foreground underline underline-offset-4',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
);

/** `This game`: the one custom a number came from, on its game page. */
export function GameLink({ game, links }: { game: Pick<HistoryGame, 'id'>; links: StatsLinks }) {
  return (
    <Link href={links.game(game.id) as Route} className={cn(LINK, 'w-fit')}>
      {THIS_GAME}
    </Link>
  );
}

export interface OpeningItem {
  gameId: string;
  label: string;
  detail?: string | null | undefined;
}

/**
 * The games behind a number: a native `<details>` (05-design 5.0) with the first
 * {@link STATS_OPENINGS_SHOWN} as links to their game pages, and the rest on the Games list
 * filtered to the row's player. One game is a plain `This game` link.
 */
export function Openings({
  items,
  playerPuuid,
  links,
}: {
  items: readonly OpeningItem[];
  playerPuuid: string;
  links: StatsLinks;
}) {
  if (items.length === 0) return null;
  if (items.length === 1 && items[0] !== undefined)
    return <GameLink game={{ id: items[0].gameId }} links={links} />;
  const shown = items.slice(0, STATS_OPENINGS_SHOWN);
  const more = items.length - shown.length;
  return (
    <details className="group">
      <summary
        className={cn(
          LINK,
          'cursor-pointer list-none font-bold no-underline [&::-webkit-details-marker]:hidden',
          'before:me-1.5 before:inline-block before:transition-transform before:content-["▸"] group-open:before:rotate-90',
        )}
      >
        {seeGamesLabel(items.length)}
      </summary>
      <ul className="flex flex-col">
        {shown.map((item) => (
          <li key={item.gameId}>
            <Link
              href={links.game(item.gameId) as Route}
              className={cn(LINK, 'flex-wrap gap-x-2 no-underline hover:underline')}
            >
              <span className="underline underline-offset-4">{item.label}</span>
              {item.detail === undefined || item.detail === null ? null : (
                <span className="text-xs text-muted-foreground">{item.detail}</span>
              )}
            </Link>
          </li>
        ))}
        {more > 0 ? (
          <li>
            <Link href={links.playerGames(playerPuuid) as Route} className={LINK}>
              {moreGamesLabel(more)}
            </Link>
          </li>
        ) : null}
      </ul>
    </details>
  );
}
