import type { Calibration } from '@customs/core';
import type { Route } from 'next';
import Link from 'next/link';
import { EntityLink } from '@/components/links/EntityLink';
import { CompactReceipt } from '@/components/receipt';
import { RichText } from '@/components/receipt/parts';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { NumText } from '@/components/ui/num-text';
import { SideGlyph } from '@/components/ui/side-glyph';
import { LOST } from '@/lib/board/copy';
import {
  DATE_FILTER_LABEL,
  EVERYONE_LABEL,
  GAMES_LABEL,
  GAMES_MODE_LABELS,
  GAMES_WINDOW_LABELS,
  gamesCount,
  MODE_FILTER_LABEL,
  NEWER_PAGE,
  NO_GAMES_MATCH,
  NO_GAMES_YET,
  OLDER_PAGE,
  PAGES_LABEL,
  PLAYER_FILTER_LABEL,
  PLAYER_FILTER_SUBMIT,
  pageOf,
  resultForWinner,
  SEE_ALL_DATES,
  showingFocus,
  WON_TAG,
  YOU_WORD,
} from '@/lib/games/copy';
import { GAMES_WINDOW_CHIPS, type GamesFilters, gamesListHref } from '@/lib/games/filters';
import type { GameListItem, GameRowLine, GamesListView } from '@/lib/games/list';
import {
  CALIBRATION_FOLLOW_UP,
  CALIBRATION_MIN_GAMES,
  calibrationLineParts,
  calibrationTooFewParts,
} from '@/lib/receipt/copy';
import { cn } from '@/lib/utils';
import { Delta } from './Delta';
import { SegLinks } from './SegLinks';

/**
 * `/g/<slug>/games` (M14.16; STRATEGY §6(c); docs/05-design.md 5.2 history variant). A 2.0 root,
 * server-rendered, no client JavaScript: the filters are links and one GET form, the rows are
 * links to the game page, and the pages are links. One h1.
 */
export function GamesList({ view, base }: { view: GamesListView; base: string }) {
  const { filters } = view;
  const at = (change: Partial<GamesFilters>): string =>
    gamesListHref(base, { ...filters, page: 1, ...change });

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-(--gutter) py-6 lg:py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl leading-tight font-bold text-balance">{GAMES_LABEL}</h1>
          <CalibrationLine calibration={view.calibration} />
        </header>

        <div className="flex flex-col gap-3">
          <SegLinks
            label={DATE_FILTER_LABEL}
            items={GAMES_WINDOW_CHIPS.map((window) => ({
              label: GAMES_WINDOW_LABELS[window],
              href: at({ window }),
              current: filters.window === window,
            }))}
          />
          <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-end">
            <SegLinks
              label={MODE_FILTER_LABEL}
              items={(['sr', 'aram'] as const).map((mode) => ({
                label: GAMES_MODE_LABELS[mode],
                href: at({ mode }),
                current: filters.mode === mode,
              }))}
            />
            <PlayerFilter view={view} base={base} />
          </div>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="off">
          <CountText text={gamesCount(view.total)} />
          {view.focusName === null ? null : <> · {showingFocus(view.focusName)}</>}
        </p>

        {view.items.length === 0 ? (
          <EmptyList view={view} seeAll={filters.window === 'all-time' ? null : at({ window: 'all-time' })} />
        ) : (
          <ul className="overflow-hidden rounded-card border border-border bg-card">
            {view.items.map((item) => (
              <GameRow key={item.id} item={item} href={`${base}/${encodeURIComponent(item.id)}`} />
            ))}
          </ul>
        )}

        {view.pages > 1 ? <Pagination view={view} base={base} /> : null}
      </div>
    </div>
  );
}

/** STRATEGY §4.8 at the top of the list: the line from 20 games, the count before that. */
export function CalibrationLine({ calibration }: { calibration: Calibration }) {
  const { n, favoredWon, actualPct, expectedPct } = calibration;
  if (n < CALIBRATION_MIN_GAMES || actualPct === null || expectedPct === null) {
    return (
      <p className="text-sm text-pretty text-muted-foreground">
        <RichText rich={calibrationTooFewParts(n)} />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm text-pretty">
        <RichText rich={calibrationLineParts(n, favoredWon, actualPct, expectedPct)} />
      </p>
      <p className="text-xs text-pretty text-muted-foreground">{CALIBRATION_FOLLOW_UP}</p>
    </div>
  );
}

/** A GET form: the native select (05-design 5.0) and a submit, so it works with no JavaScript. */
function PlayerFilter({ view, base }: { view: GamesListView; base: string }) {
  const { filters } = view;
  return (
    <form method="get" action={base} className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor="games-player" className="text-xs font-bold text-muted-foreground">
        {PLAYER_FILTER_LABEL}
      </label>
      <div className="flex min-w-0 gap-2">
        <input type="hidden" name="window" value={filters.window} />
        {filters.mode === 'aram' ? <input type="hidden" name="mode" value="aram" /> : null}
        <NativeSelect id="games-player" name="player" defaultValue={filters.player ?? ''} className="flex-1">
          <NativeSelectOption value="">{EVERYONE_LABEL}</NativeSelectOption>
          {view.members.map((member) => (
            <NativeSelectOption key={member.puuid} value={member.puuid}>
              {member.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          {PLAYER_FILTER_SUBMIT}
        </Button>
      </div>
    </form>
  );
}

function EmptyList({ view, seeAll }: { view: GamesListView; seeAll: string | null }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-strong p-(--card-pad)">
      <p className="text-base">{view.groupHasGames ? NO_GAMES_MATCH : NO_GAMES_YET}</p>
      {view.groupHasGames && seeAll !== null ? (
        <Button asChild variant="secondary">
          <Link prefetch="auto" href={seeAll as Route}>
            {SEE_ALL_DATES}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

const SIDE_TEXT = { 100: 'text-team-blue', 200: 'text-team-red' } as const;

/** One game: one link, the whole row (05-design 5.2). */
export function GameRow({ item, href }: { item: GameListItem; href: string }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <EntityLink
        href={href as Route}
        className={cn(
          'flex min-h-(--row-min-h) flex-col gap-1 px-(--card-pad) py-3 text-foreground no-underline',
          'touch-manipulation transition-colors duration-(--dur-fast) ease-out hover:bg-accent active:bg-accent',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-2 text-md font-bold">
            <SideGlyph
              side={item.winningSide === 100 ? 'blue' : 'red'}
              className={cn('size-3.5', SIDE_TEXT[item.winningSide])}
            />
            {resultForWinner(item.winningSide)}
          </span>
          <span className="text-xs text-muted-foreground">
            <NumText text={`${item.dateLabel} · ${item.durationLabel}`} />
          </span>
        </span>
        <RowOdds item={item} />
        {item.ruleNote === null ? null : (
          <span className="text-sm text-muted-foreground">{item.ruleNote}</span>
        )}
        {item.lines.map((line) => (
          <RowLine key={line.who} line={line} aram={item.aram} />
        ))}
      </EntityLink>
    </li>
  );
}

function RowOdds({ item }: { item: GameListItem }) {
  const { odds } = item;
  if (odds === null) {
    return item.aram ? (
      <span className="flex">
        <Chip>{GAMES_MODE_LABELS.aram}</Chip>
      </span>
    ) : null;
  }
  return odds.kind === 'rolled' ? (
    <CompactReceipt
      winner={item.winningSide}
      blueWinProb={odds.blueWinProb}
      rank={odds.rank}
      aram={item.aram}
      winnerInTitle
    />
  ) : (
    <CompactReceipt
      winner={item.winningSide}
      ratingsBefore={odds.ratingsBefore}
      ratingBlueWinProb={odds.kickoffBlueWinProb ?? null}
      aram={item.aram}
      winnerInTitle
    />
  );
}

/**
 * The viewer's (or the filtered player's) own game, on two lines (design round 1): who and the
 * rating change first, then champion · role · KDA · result.
 */
function RowLine({ line, aram }: { line: GameRowLine; aram: boolean }) {
  const parts = [line.champion, line.role].filter((part): part is string => part !== null);
  return (
    <span className="flex flex-col gap-0.5 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-x-2">
        {line.who === 'you' ? (
          <Chip variant="you" className="-rotate-2">
            {YOU_WORD}
          </Chip>
        ) : (
          <b className="font-bold [overflow-wrap:break-word]">{line.name}</b>
        )}
        {aram ? null : <Delta value={line.delta} />}
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
        {parts.length === 0 ? null : <span>{parts.join(' · ')}</span>}
        <span className="num text-foreground">{line.kda}</span>
        <span>· {line.won ? WON_TAG : LOST}</span>
      </span>
    </span>
  );
}

function Pagination({ view, base }: { view: GamesListView; base: string }) {
  const { filters, pages } = view;
  const newer = filters.page > 1 ? gamesListHref(base, { ...filters, page: filters.page - 1 }) : null;
  const older = filters.page < pages ? gamesListHref(base, { ...filters, page: filters.page + 1 }) : null;
  return (
    <nav aria-label={PAGES_LABEL} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <span className="flex justify-start">
        {newer === null ? null : (
          <Button asChild variant="outline">
            <Link prefetch="auto" href={newer as Route} rel="prev">
              {NEWER_PAGE}
            </Link>
          </Button>
        )}
      </span>
      <span className="text-sm text-muted-foreground">
        <CountText text={pageOf(filters.page, pages)} />
      </span>
      <span className="flex justify-end">
        {older === null ? null : (
          <Button asChild variant="outline">
            <Link prefetch="auto" href={older as Route} rel="next">
              {OLDER_PAGE}
            </Link>
          </Button>
        )}
      </span>
    </nav>
  );
}

/** Numbers mono, words in the text face (design round 1): `36 games`, `Page 1 of 2`. */
function CountText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional parts of one fixed string
          <span key={i} className="num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
