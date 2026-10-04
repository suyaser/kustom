import type { Route } from 'next';
import { EntityLink } from '@/components/links/EntityLink';
import { NameText } from '@/components/names/name-text';
import { Chip } from '@/components/ui/chip';
import { RATING_LABEL, settlingChip, weekPointsWords } from '@/lib/board/copy';
import { rowChange } from '@/lib/board/rowChange';
import type { BoardRow } from '@/lib/board/types';
import type { WindowKind } from '@/lib/night';
import { cn } from '@/lib/utils';
import { RatingDelta } from './RatingDelta';
import { RecordLine } from './RecordLine';

/**
 * One section of the board (05-design 5.2): an `<ol>` for the ranked rows, a `<ul>` for the
 * settling rows (unnumbered). **The whole row is one link** to the player page: no `<details>`, no
 * link inside a toggle, no inline game list (the audit's 13k-px board).
 */
export function BoardList({
  rows,
  firstRank,
  viewerPuuid,
  playerHref,
  window = 'all-time',
}: {
  rows: readonly BoardRow[];
  /** The board's window: a week row's points say which week to a screen reader (05-design 11.4). */
  window?: WindowKind;
  /** The first row's rank, or `null` for the settling section (no numbers). */
  firstRank: number | null;
  viewerPuuid: string | null;
  playerHref: (puuid: string) => Route;
}) {
  const List = firstRank === null ? 'ul' : 'ol';
  return (
    <List className="flex flex-col" {...(firstRank === null ? {} : { start: firstRank })}>
      {rows.map((row, index) => (
        <li key={row.puuid} className="border-t border-border first:border-t-0">
          <Row
            row={row}
            rank={firstRank === null ? null : firstRank + index}
            you={row.puuid === viewerPuuid}
            href={playerHref(row.puuid)}
            window={window === 'all-time' ? null : window}
          />
        </li>
      ))}
    </List>
  );
}

function Row({
  row,
  rank,
  you,
  href,
  window,
}: {
  row: BoardRow;
  rank: number | null;
  you: boolean;
  href: Route;
  window: Exclude<WindowKind, 'all-time'> | null;
}) {
  const delta = rowChange(row);
  // M14.57: a week row's big number is its net points (the sorted one); the all-time Rating sits
  // small under it. All time keeps the Rating big and the climb under it.
  const week = row.points !== null;
  return (
    <EntityLink
      href={href}
      className={cn(
        'grid min-h-(--row-min-h) items-start gap-x-3 px-(--card-pad) py-3',
        rank === null ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[2.25rem_minmax(0,1fr)_auto]',
        'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:bg-accent active:bg-accent',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        you && 'bg-you-wash outline-2 -outline-offset-2 outline-you',
      )}
    >
      {rank === null ? null : (
        <span
          className={cn(
            'num pt-0.5 text-sm text-muted-foreground',
            rank <= 3 && 'font-display text-md font-black text-foreground font-stretch-70%',
          )}
        >
          <span aria-hidden="true">{rank}</span>
          <span className="sr-only">{`Rank ${rank}, `}</span>
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-md font-bold [overflow-wrap:anywhere]">
            <NameText name={row.name} suffix={row.nameSuffix} />
          </span>
          {you ? <Chip variant="you">You</Chip> : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <RecordLine games={row.games} wins={row.wins} losses={row.losses} />
          {row.settling || row.settlingChip ? <Chip variant="settling">{settlingChip(row.ratedGames)}</Chip> : null}
          {row.awards.map((award) => (
            <Chip key={award}>{award}</Chip>
          ))}
        </span>
      </span>
      {week && row.points !== null ? (
        // 05-design 11.4: the week points lead (`--fs-md` 600, 4ch), the all-time Rating under them
        // small and muted, with no all-time change on the row.
        <span className="flex flex-col items-end gap-0.5 text-end">
          <RatingDelta
            delta={row.points}
            width="points"
            {...(window === null ? {} : { spoken: weekPointsWords(row.points, window) })}
            className="text-md font-stretch-85%"
          />
          <span className="num text-sm whitespace-nowrap text-muted-foreground font-stretch-85%">
            {row.rating}
            <span className="sr-only">{` ${RATING_LABEL}`}</span>
          </span>
        </span>
      ) : (
        <span className="flex flex-col items-end gap-0.5 text-end">
          <span className="num text-md font-semibold whitespace-nowrap font-stretch-85%">
            {row.rating}
            <span className="sr-only">{` ${RATING_LABEL}`}</span>
          </span>
          {delta === null ? null : <RatingDelta delta={delta} className="text-sm" />}
        </span>
      )}
    </EntityLink>
  );
}
