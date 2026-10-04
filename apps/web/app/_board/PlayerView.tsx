import { displayKustom } from '@customs/core';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EntityLink } from '@/components/links/EntityLink';
import { CompactReceipt } from '@/components/receipt';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { SideGlyph } from '@/components/ui/side-glyph';
import { WhyButton, WhyPanel, WhyScope } from '@/components/why/why-scope';
import { subjectFor, WhyText } from '@/components/why/why-text';
import {
  ACE_LABEL,
  ALL_THEIR_GAMES,
  ALL_YOUR_GAMES,
  gamesLabel,
  LOST,
  MVP_EXPLANATION,
  MVP_LABEL,
  NO_GAMES_YET_SELF,
  NOT_RATED,
  NOT_RATED_HINT,
  noGamesYetLine,
  POINTS_COLUMN_LABEL,
  RATING_EXPLANATION,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  ratingTileLabel,
  settlingChip,
  WEEK_CHANGE_COLUMN_LABEL,
  WEEK_PLAYER_SENTENCE,
  WEEK_TOTAL_LABEL,
  WELCOME_NO_GAMES,
  WINDOW_EMPTY,
  WON,
  weekChangeWords,
  weekPointsWords,
  welcomeLine,
  windowLabel,
  winLossLabel,
} from '@/lib/board/copy';
import { explainRatingStart, sideWinChance } from '@/lib/board/explain';
import { trackPair } from '@/lib/board/recent';
import type { PlayerBoardView, RatingTrack, RecentGame } from '@/lib/board/types';
import { type ExplainSubject, oddsGapSentence } from '@/lib/breakdown/copy';
import { formatMinutes } from '@/lib/games/duration';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { formatDayMonth } from '@/lib/night';
import { displayDelta } from '@/lib/ratingDisplay';
import { TONIGHT_TILE_LABEL, youInGroup } from '@/lib/shellCopy';
import { isNameless, NAMELESS_HINT, renderWebName } from '@/lib/tonight/copy';
import { cn } from '@/lib/utils';
import { RatingChart } from './RatingChart';
import { RatingDelta } from './RatingDelta';
import { RecordLine } from './RecordLine';
import { WelcomeCard } from './WelcomeCard';
import { WindowChips } from './WindowChips';

/**
 * One player's page, in one of two lenses (M14.15, redesign/nav/proposal.md option A):
 *
 * - `public`: `/g/<slug>/p/<puuid>` for everyone, your own page included. The name, the window
 *   chips, one big `Rating`, the settling chip, the trend line, `Started at 1200, 37 rated games
 *   since.`, the records, and the newest games each with the compact receipt.
 * - `self`: the top of `/g/<slug>/you` for the linked viewer. STRATEGY §6(b3)'s header (the name,
 *   `YOU`, three tiles: Rating with rank or the settling chip, W-L with games, tonight's change),
 *   then the same trend and games list. All time only.
 *
 * **Same loader, same numbers**: both lenses render one `PlayerBoardView` from `loadPlayerBoard`,
 * so the Rating, the record and the games can never disagree between them.
 *
 * The page returns its sections without a page root, so the public route and the You page can each
 * put it in their own container.
 *
 * Slots for later tasks, deliberately not drawn (no placeholder cards): M14.33's welcome card and
 * M14.35's You-vs-them card go above the records.
 */
export interface PlayerViewProps {
  lens: 'public' | 'self';
  player: PlayerBoardView;
  group: Pick<PageGroup, 'name'>;
  /** The signed-in viewer's PUUID in this group: their own public page carries the `YOU` sticker. */
  viewerPuuid: string | null;
  /** The records under the chart (public lens). */
  stats?: ReactNode;
  /** You vs them (M14.35), above the records, on someone else's page for a linked viewer. */
  versus?: ReactNode;
  /**
   * The AI scouting report (M16.6), already rendered by the page: under the header block (name,
   * Rating, settling chip, trend, `Started at` line) on the public lens, under the trend on the self
   * lens (`/you`, design round 1; that page passes no Hide), above everything else. Never for a
   * settling player, whatever the page passes.
   */
  scouting?: ReactNode;
  /** `displayDelta` over tonight's games, for the self lens's third tile; `null` when none tonight. */
  tonightDelta?: number | null;
  /** `/g/<slug>/p/<puuid>`, for the window chips (public lens). */
  path: string;
  gameHref: (gameId: string) => Route | null;
  /** The games page narrowed to this player, or `null` while it has no address for the group. */
  allGamesHref: Route | null;
  /**
   * The self lens right after a self-link (`/you?welcome=1`, M14.33): the welcome card goes first,
   * and `home` is its `Back to tonight`. Ignored by the public lens, so `/p/<you>?welcome=1` shows
   * none.
   */
  welcome?: { home: Route } | null;
  /**
   * Your night's first line (M14.36, `Your night: 3 wins, 1 loss, Rating +38.`), under the self
   * header; Tonight's card says the same words from the same loader. Self lens only.
   */
  nightLine?: string | null;
  timeZone: string;
}

export function PlayerView(props: PlayerViewProps) {
  const { lens, player } = props;
  return (
    <>
      {lens === 'self' && props.welcome ? <Welcome player={player} home={props.welcome.home} /> : null}
      {lens === 'self' ? <SelfHeader {...props} /> : <PublicHeader {...props} />}
      {lens === 'self' && props.nightLine ? (
        <p data-slot="your-night-line" className="text-md font-bold">
          {props.nightLine}
        </p>
      ) : null}
      {lens === 'public' ? (
        <RatingCard player={player} groupName={props.group.name} />
      ) : (
        <SelfTrend {...props} />
      )}
      {player.settling ? null : (props.scouting ?? null)}
      {props.versus ?? null}
      {props.stats ?? null}
      <GamesCard {...props} />
    </>
  );
}

function PublicHeader({ player, viewerPuuid, path }: PlayerViewProps) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-xl font-black tracking-[0.02em] text-balance [overflow-wrap:anywhere] font-stretch-70%">
          {renderWebName(player.name)}
        </h1>
        {viewerPuuid === player.puuid ? <Chip variant="you">You</Chip> : null}
      </div>
      <WindowChips path={path} selected={player.window} resetDay={player.resetDay ?? null} />
      <p className="text-sm text-muted-foreground">
        <span className="font-bold text-foreground">
          {windowLabel(player.window, player.resetDay ?? null)}
        </span>
        {player.range !== null ? (
          <>
            {' · '}
            <span className="tabular-nums">{player.range}</span>
          </>
        ) : player.window === 'all-time' ? null : (
          ` · ${WINDOW_EMPTY[player.window]}`
        )}
      </p>
    </header>
  );
}

/** `settling · 4/10`, or `new` with no rated game (05-design 5.6). */
function StatusChip({ player }: { player: PlayerBoardView }) {
  if (!player.settling) return null;
  return <Chip variant="settling">{settlingChip(player.ratedGames)}</Chip>;
}

function RatingCard({ player, groupName }: { player: PlayerBoardView; groupName: string }) {
  // 05-design 11.5: a week they played leads with the week's points. A week with no game keeps the
  // Rating card (the slot line already says `No games this week yet.`): nobody reads `±0` for nothing.
  if (player.window !== 'all-time' && player.points !== null && player.games > 0) {
    return <WeekRatingCard player={player} window={player.window} points={player.points} />;
  }
  const start = explainRatingStart(player);
  const empty = player.ratedGames === 0 && player.games === 0;
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-md font-bold">{RATING_LABEL}</span>
          <span className="num text-display leading-none font-semibold font-stretch-85%">
            {player.rating}
          </span>
          <StatusChip player={player} />
        </p>
        {player.games === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            <RecordLine games={player.games} wins={player.wins} losses={player.losses} order="record-first" />
          </p>
        )}
        {empty ? <p className="text-sm text-pretty">{noGamesYetLine(groupName)}</p> : null}
        {start === null || empty ? null : <p className="text-sm">{start}</p>}
        {player.history.length === 0 ? null : (
          <RatingChart history={player.history} reference={player.reference} window={player.window} />
        )}
        {player.track === 'week' ? (
          <p className="text-sm text-pretty text-muted-foreground">{WEEK_PLAYER_SENTENCE}</p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The Rating card on a week tab (05-design 11.5): `Points this week` leads at the display size,
 * the all-time Rating moves into the meta line (`7 games · 5W 2L · Rating 1300`), the chart plots
 * week points from 0, and the week note closes it. No `Started the week at` line: every week starts
 * at 0 and the note says so.
 */
function WeekRatingCard({
  player,
  window,
  points,
}: {
  player: PlayerBoardView;
  window: Exclude<PlayerBoardView['window'], 'all-time'>;
  points: number;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        <p data-slot="week-points" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-md font-bold">{POINTS_COLUMN_LABEL[window]}</span>
          {/* Plain spoken words (`gained 16`): the label beside it already names the week. */}
          <RatingDelta delta={points} className="text-display leading-none font-stretch-85%" />
        </p>
        <p data-slot="week-meta" className="text-sm text-muted-foreground">
          <RecordLine games={player.games} wins={player.wins} losses={player.losses} />
          {' · '}
          {RATING_LABEL} <span className="num">{player.rating}</span>
        </p>
        {player.history.length === 0 ? null : (
          <RatingChart history={player.history} reference={player.reference} window={player.window} />
        )}
        <p className="text-sm text-pretty text-muted-foreground">{WEEK_PLAYER_SENTENCE}</p>
      </div>
    </Card>
  );
}

function SelfHeader({ player, group, tonightDelta = null }: PlayerViewProps) {
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        <p className="text-sm text-muted-foreground">{youInGroup(group.name)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-xl font-black tracking-[0.02em] [overflow-wrap:anywhere] font-stretch-70%">
            {renderWebName(player.name)}
          </h1>
          <Chip variant="you">You</Chip>
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
          <Tile value={String(player.rating)} label={ratingTileLabel(player.rank)} />
          <Tile value={winLossLabel(player.wins, player.losses)} label={gamesLabel(player.games)} compact />
          {tonightDelta === null ? null : (
            <Tile value={<RatingDelta delta={tonightDelta} />} label={TONIGHT_TILE_LABEL} />
          )}
        </dl>
        {/* Under the tiles, not inside one: at 375 a tile is too narrow for `settling · 4/10`. */}
        <StatusChip player={player} />
      </div>
    </Card>
  );
}

/** A stat tile: the number in tabular mono over its label. Numbers never wrap. */
function Tile({ value, label, compact = false }: { value: ReactNode; label: string; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control border border-border bg-raised px-3 py-2.5">
      <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'num order-1 font-semibold whitespace-nowrap font-stretch-85%',
          compact ? 'text-md leading-[1.85rem] tracking-[-0.02em]' : 'text-lg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** The welcome card's words, from this page's own view: games, wins and Rating (M14.33). */
function Welcome({ player, home }: { player: PlayerBoardView; home: Route }) {
  const none = player.ratedGames === 0 && player.games === 0;
  return (
    <WelcomeCard
      line={none ? WELCOME_NO_GAMES : welcomeLine(player.games, player.wins, player.rating)}
      chip={none ? undefined : <StatusChip player={player} />}
      home={home}
    />
  );
}

function SelfTrend({ player, welcome }: PlayerViewProps) {
  const start = explainRatingStart(player);
  if (player.ratedGames === 0 && player.games === 0) {
    // The welcome card already says it.
    if (welcome) return null;
    return (
      <div className="rounded-card border border-dashed border-border-strong p-(--card-pad)">
        <p>{NO_GAMES_YET_SELF}</p>
      </div>
    );
  }
  if (player.history.length === 0 && start === null) return null;
  return (
    <Card>
      <div className="flex flex-col gap-3 p-(--card-pad)">
        {start === null ? null : <p className="text-sm">{start}</p>}
        {player.history.length === 0 ? null : (
          <RatingChart history={player.history} reference={player.reference} window={player.window} />
        )}
      </div>
    </Card>
  );
}

function GamesCard({ lens, player, gameHref, allGamesHref, timeZone, viewerPuuid }: PlayerViewProps) {
  if (player.recent.length === 0) return null;
  // M14.58: `You lost 50.` on your own page (either lens), `Omar lost 50.` on anybody else's.
  const subject: ExplainSubject =
    lens === 'self' ? { kind: 'you' } : subjectFor(player.puuid, viewerPuuid, player.name);
  const unrated = player.recent.some((game) => trackPair(game, player.track) === null);
  const nameless = isNameless(player.name);
  /** On a week tab, which week (05-design 11.5's column label, total row and spoken changes). */
  const week = player.window === 'all-time' ? null : player.window;
  return (
    <section aria-labelledby="player-games" className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between gap-3 pb-2">
          <CardTitle id="player-games">{RECENT_GAMES_HEADING}</CardTitle>
          {week === null ? null : (
            // 05-design 11.5: the change column's label, once, over the column.
            <p data-slot="week-column-label" className="text-xs text-muted-foreground">
              {WEEK_CHANGE_COLUMN_LABEL[week]}
            </p>
          )}
        </CardHeader>
        <ul>
          {player.recent.map((game) => (
            <li key={game.gameId} className="border-t border-border">
              <GameRow
                game={game}
                track={player.track}
                week={week}
                href={gameHref(game.gameId)}
                timeZone={timeZone}
                subject={subject}
              />
            </li>
          ))}
        </ul>
        {week === null || player.weekTotal === null || player.weekTotal === undefined ? null : (
          // 05-design 11.5: the column's sum, which equals the header; not a link, not a button.
          <p
            data-slot="week-total"
            className="flex items-baseline justify-between gap-3 border-t border-border px-(--card-pad) py-3 text-sm"
          >
            <span>{WEEK_TOTAL_LABEL}</span>
            {/* Clear of the rows' Why chevron (14px, and the button's two 4px gaps around its sr-only words), so the sum sits under the column. */}
            <span className="pe-[22px]">
              <RatingDelta
                delta={player.weekTotal}
                width="change"
                spoken={weekPointsWords(player.weekTotal, week)}
              />
            </span>
          </p>
        )}
        {allGamesHref === null ? null : (
          <div className="border-t border-border px-(--card-pad) py-1">
            <Link
              prefetch="auto"
              href={allGamesHref}
              className="inline-flex min-h-11 items-center font-bold text-primary-text underline underline-offset-3"
            >
              {lens === 'self' ? ALL_YOUR_GAMES : ALL_THEIR_GAMES}
            </Link>
          </div>
        )}
      </Card>
      {unrated ? <p className="text-sm text-muted-foreground">{NOT_RATED_HINT}</p> : null}
      <p className="text-sm text-pretty text-muted-foreground">
        {RATING_EXPLANATION} {MVP_EXPLANATION}
      </p>
      {nameless ? <p className="text-sm text-muted-foreground">{NAMELESS_HINT}</p> : null}
    </section>
  );
}

/**
 * One game (05-design 5.2's history variant): the side glyph and `Won` / `Lost`, the date and
 * `21 min`, the compact receipt (`Blue was 54%. Blue won.`, or the pre-game odds where there was no
 * split), and this player's Rating and change.
 *
 * The left of the row is a link to the game page, stretched over the whole row; the change is its
 * own button above it (M14.58) that opens why it was that size, as a full row under the game. A
 * button can't live inside a link, so the link no longer wraps the number column.
 */
function GameRow({
  game,
  href,
  timeZone,
  subject,
  track,
  week,
}: {
  game: RecentGame;
  /** M18.6: a week tab prints the game's weekly change and no Rating after (05-design 11.5). */
  track: RatingTrack;
  /** Which week a week tab is on (its spoken change: `gained 19 this week`), `null` on All time. */
  week: Exclude<PlayerBoardView['window'], 'all-time'> | null;
  href: Route | null;
  timeZone: string;
  subject: ExplainSubject;
}) {
  const pair = trackPair(game, track);
  const delta = pair === null ? null : displayDelta(pair.rBefore, pair.rAfter);
  const reason = delta === null || game.aram ? null : (game.reason ?? null);
  const odds = game.odds ?? null;
  const receipt =
    game.blueWinProb !== null ? (
      <CompactReceipt
        winner={game.winningSide}
        blueWinProb={game.blueWinProb}
        rank={game.pickRank ?? undefined}
        aram={game.aram}
        oddsGap={odds === null ? null : oddsGapSentence(odds, game.winningSide)}
        className="contents"
      />
    ) : game.ratingsBefore !== null ? (
      <CompactReceipt
        winner={game.winningSide}
        ratingsBefore={game.ratingsBefore}
        ratingBlueWinProb={odds?.ratingBlueWinProb ?? null}
        aram={game.aram}
        className="contents"
      />
    ) : null;

  const main = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-bold">
          <SideGlyph side={game.side === 100 ? 'blue' : 'red'} />
          {game.won ? WON : LOST}
        </span>
        <span className="num text-xs text-muted-foreground">
          {formatDayMonth(new Date(game.startedAt), timeZone)} · {formatMinutes(game.durationS)}
        </span>
      </span>
      {/* Line 2: the role word in a fixed spot, then the odds sentence and its chips inline. */}
      {game.role === null && receipt === null ? null : (
        // Design round 1: stacked below sm (the role word, then the odds); from sm one line, the role
        // in a fixed column and the odds wrapping beside it.
        <span className="flex flex-col gap-1 text-[0.9375rem] text-muted-foreground sm:flex-row sm:gap-x-2">
          {game.role === null ? null : (
            <span className="num text-2xs tracking-[0.04em] sm:w-[4.75rem] sm:shrink-0">{game.role}</span>
          )}
          {receipt === null ? null : (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">{receipt}</span>
          )}
        </span>
      )}
    </>
  );

  const change =
    delta === null ? null : (
      <RatingDelta
        delta={delta}
        width="change"
        className="text-sm"
        {...(week === null ? {} : { spoken: weekChangeWords(delta, week) })}
      />
    );
  const changeCell =
    change === null ? null : reason === null ? (
      change
    ) : (
      <WhyButton className="-my-2.5 -me-1 pe-1">{change}</WhyButton>
    );
  const award =
    game.award === null ? null : (
      <Chip className="font-bold">{game.award === 'mvp' ? MVP_LABEL : ACE_LABEL}</Chip>
    );
  // 05-design 11.6.3: a week row's odds sentence opens `On this week's numbers` when the weekly
  // odds differ from the roll odds the row prints; this is that printed number, for this side.
  const rollSidePct = sideWinChance(game.blueWinProb, game.side);

  const row = (
    <div
      className={cn(
        'relative grid min-h-(--row-min-h) grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-(--card-pad) py-3',
        href !== null &&
          'touch-manipulation transition-colors duration-(--dur-fast) ease-out has-[a:hover]:bg-accent',
      )}
    >
      {href === null ? (
        <div className="flex min-w-0 flex-col gap-1">{main}</div>
      ) : (
        <EntityLink
          href={href}
          className={cn(
            'flex min-w-0 flex-col gap-1',
            // The whole row is the target, through a stretched link (the Tonight seat's pattern).
            "after:absolute after:inset-0 after:content-['']",
            'focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring',
          )}
        >
          {main}
        </EntityLink>
      )}
      <span className="flex flex-col items-end gap-0.5 text-end">
        {pair === null ? (
          <span className="text-xs text-muted-foreground">{NOT_RATED}</span>
        ) : track === 'week' || game.rAfter === null ? null : (
          <span className="num font-semibold whitespace-nowrap font-stretch-85%">
            {displayKustom(game.rAfter)}
            <span className="sr-only">{` ${RATING_LABEL}`}</span>
          </span>
        )}
        {/* All time: the change and the chip on one line under the Rating. A week tab has no Rating
            line, so the change leads the column alone and the chip sits under it (05-design 11.5),
            keeping the changes in one right-aligned column down to the `Week total` row. */}
        <span className={cn('flex gap-1.5', week === null ? 'items-center' : 'flex-col items-end')}>
          {changeCell}
          {award}
        </span>
      </span>
      {reason === null ? null : (
        <WhyPanel className="col-span-full">
          <WhyText reason={reason} subject={subject} options={{ rollSidePct }} />
        </WhyPanel>
      )}
    </div>
  );
  return reason === null ? row : <WhyScope>{row}</WhyScope>;
}
