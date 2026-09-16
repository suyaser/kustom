import { displayRating, provisionalSeed, type Rating } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import { inChunks } from '../chunks';
import { type FoldAwardPlayer, type FoldPerformance, gatedGameAward } from '../ingest/fold';
import { readSeed, type StoredSeed, seedFor } from '../ingest/seed';
// `LANE_ORDER` left with `roleRecord` (M5.20): `By role` is `lib/stats`' fold now.
import { inLaneOrder } from '../laneOrder';
import { DEFAULT_NIGHT_TIME_ZONE, type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import { provenRating, provenSortKey } from '../ratingDisplay';
import { loadAwardWinners, loadStreaks } from '../stats/load';
import { type AwardWinners, NO_AWARD_WINNERS } from '../stats/winners';
import type { PlayerName } from '../tonight/types';
import { boardBreakdown } from './breakdown';
import { SETTLING_GAMES } from './copy';
import { sortBoardRows } from './order';
import { recentGames } from './recent';
import type {
  BoardGame,
  BoardRow,
  BoardView,
  PlayerBoardView,
  RecentAward,
  RecentGame,
  RecentTeammate,
} from './types';
import {
  foldWeeklyRatings,
  isWeekWindow,
  type WeeklyGame,
  type WeeklyPlayer,
  type WeeklyPlayerRating,
} from './weekly';
import { windowRangeLabel } from './window';

/**
 * Everything `/leaderboard` and `/p/[puuid]` show, read with the **anon key** (M3.5).
 *
 * Both pages are server components, public, and have no login: the reads go through RLS
 * exactly as a phone would make them, and names come from `players_public` — `players` minus
 * `discord_id` — looked up by the ids being rendered, never carried in from a roster.
 *
 * Two rules the rest of the file exists to keep:
 *
 * - **One rule for a player's rating.** The `ratings` row for the active season, and
 *   `provisionalSeed()` — `20 / 12`, 1200 displayed — in memory when there is none, so a player
 *   who has not been folded yet appears on the board with `0 games` and the `settling` chip
 *   rather than not appearing at all (M3.5's "zero games this season" edge case).
 *   **Since 2026-09-16 that in-memory number is the seed the first fold will store and not a
 *   rank estimate**: every page under `/leaderboard` and `/p/[puuid]` shows what the model
 *   holds, which for somebody with no customs is 1200, the same as for everybody else. The
 *   balancer's live guess for such a face still reads their rank (`lib/ingest/balance.ts`,
 *   `seedFromRank`) and the tonight page still prints *that* number because it is the one the
 *   Discord split embed printed — a lobby surface, not a rating surface. The two differ for
 *   exactly one kind of player, on their first night, and the board's is the one that is about
 *   to be true.
 * - **Proven is `provenRating`, once.** `ratings.ordinal` is a generated column and the index
 *   the season is sorted by, but the integer on the page comes through core, so SQL and core
 *   cannot disagree about a row's position.
 * - **One streak, one window** (M5.21). The `L2` at the end of a row is `lib/stats`' fold, read
 *   through `loadStreaks` — the same games, the same cap and the same order (`started_at`, then
 *   `lcu_game_id`) as `/p/[puuid]`. Nothing here folds a second one.
 *
 * **The seam this file still has, on purpose.** Every number on a row except the streak is
 * counted off *rated* rows — `ratings` for `All time`, `mu_after is not null` for a window —
 * and the streak counts what `gateGame` counts. They differ by exactly the games a backfill has
 * landed and `rebuild-ratings` has not folded yet, so a row can read `0 games · 0W 0L · W2`
 * until the rebuild runs (`04-decisions.md`, 2026-09-11 and 2026-09-11 (M5.21)). Closing it is
 * a rebuild, not a read.
 */

/** `05-design.md` gives the chart the detail view underneath it; five is what fits above the fold. */
const RECENT_GAMES = 5;

/** Every game of a season, for the history chart. Larger than any season the group will play. */
const SEASON_GAME_LIMIT = 1_000;

interface SeasonGame {
  id: string;
  startedAt: string;
  /**
   * The client's own game id, and **the tie-break the weekly fold orders on** (M7.3):
   * `started_at` then `lcu_game_id` is the rebuild's order, so a week and a history folded from
   * the same two games agree about which came first.
   */
  lcuGameId: number;
  durationS: number;
  winningSide: SideValue;
  /**
   * The lobby this game was born in, or `null` for a backfilled one and for a game whose lobby
   * row was cleared (`on delete set null`). It is the only way to the split the balancer chose,
   * and therefore to the win chance M5.15 prints.
   */
  lobbyId: string | null;
}

interface PlayerRow {
  id: string;
  puuid: string;
  name: PlayerName;
  rankTier: string | null;
  rankDivision: string | null;
}

interface RatingRow {
  rating: Rating;
  games: number;
  wins: number;
  /**
   * The seed this player's history was folded from (M5.7), or null on a `ratings` row written
   * before `0012` and not yet rebuilt. Only `/p/[puuid]` reads it: the board prints where
   * somebody is, not where they began.
   */
  seed: StoredSeed | null;
}

/**
 * What a page is asking the loader for: which of the five windows, and — for a test — the
 * instant and the zone the boundaries are computed from (M5.9).
 *
 * The zone defaults to `night.ts`'s, not to `nightTimeZone()`: this module is imported by the
 * Discord post and by the tonight page's rail, and the one place `CUSTOMS_NIGHT_TZ` is read is
 * `lib/tonight/night.ts`. Callers that have it pass it in.
 */
export interface BoardOptions {
  window: WindowKind;
  /** Injected in tests; `new Date()` otherwise. Never read inside the pure helpers. */
  now?: Date;
  timeZone?: string;
  /**
   * Attach each row's rated games for the `/leaderboard` expand (M5.30). Off by default:
   * the tonight rail serializes these rows and does not open them.
   */
  includeBreakdown?: boolean;
  /**
   * Badge the rows of a **closed** window with the awards it handed out (M8.3). Off by default,
   * and off for the tonight rail for the reason the design gives: the rail is a five-row
   * snapshot of tonight, not a window's story.
   *
   * On `This week`, `This month` and `All time` it changes nothing and reads nothing: those
   * windows hand out no award (M5.4), which `lib/stats/load.ts` decides before it queries.
   */
  includeAwards?: boolean;
}

/**
 * The board, read through one window (M3.5, windowed by M5.12, weekly since M7.3).
 *
 * **Ordered by the number it prints**, always — that rule has never moved. What M7.3 changed is
 * *which* number that is on the two week windows: `All time`, `This month` and `Last month` sort
 * and print Proven off the stored fold, and `This week` / `Last week` sort and print the weekly
 * `Rating` off a from-scratch fold of that week's games (`weekly.ts`). Still not "who climbed
 * most this week", which would be a second ranking with a second meaning.
 *
 * Two membership rules, and they are not the same rule:
 *
 * - **`All time`** is every player the database knows, seeded from rank when they have no
 *   `ratings` row — unchanged since M3.5, down to the integer. A friend seeded last night who
 *   cannot find themselves will ask why, and a board that hides its newest players is the
 *   board M3.8 exists to explain.
 * - **A window** is the players with at least one *counted* game inside it. Not greyed out and
 *   not at the bottom: the board is who played. A player with no game this week is simply not
 *   on `This week`.
 */
export async function loadBoard(client: PublicClient, options: BoardOptions): Promise<BoardView> {
  const window = options.window;
  const season = await selectSeasonId(client);
  // No season row means no games — `games.season_id` is not null — so there is nothing to put
  // on any window. The page prints the window's empty line, which is true and is enough.
  if (season === null) return { window, rows: [], range: null, games: 0 };

  const range = windowRange(window, options.now ?? new Date(), options.timeZone);
  const facts = await loadWindowFacts(client, season, window, range);
  // The slot: the range and the count, or the window's empty sentence when there is nothing to
  // count. `range` is `null` for the empty case, which is what the view branches on.
  const slot = {
    range: facts.games === 0 ? null : windowRangeLabel(window, range, facts.firstCountedAt, options.timeZone),
    games: facts.games,
  };

  if (window !== 'all-time') {
    /**
     * **The window's rows and the window's awards, read side by side** (M8.3). The awards are
     * `lib/stats`' — the same three blocks `/stats` prints and the Sunday post carries — asked
     * for by puuid and matched to rows; nothing here computes one, and on the three windows that
     * hand nothing out the lookup makes no query and comes back empty.
     */
    const [rows, winners] = await Promise.all([
      windowRows(client, season, range, options),
      rowAwards(client, options),
    ]);
    return { window, ...slot, rows: sortBoardRows(withAwards(rows, winners)) };
  }

  /**
   * **The streak is `lib/stats`' fold, over this window** (M5.21). Not a third read of
   * `game_players` with its own cap and its own order: `loadStreaks` is the read `/stats` and
   * `/p/[puuid]` make, so the `L2` on a row and the `L2` on that person's own page are one
   * computation and cannot drift. Keyed by puuid, which is the identity both sides carry.
   *
   * The stats read filters on the **window** and not on the season, because `/p/[puuid]`'s does
   * not either and equality is the point. With one season — M5.14 took season creation out —
   * `All time` and "this season" are the same list of games.
   */
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const [players, ratings, streaks, breakdowns] = await Promise.all([
    loadAllPlayers(client),
    loadRatings(client, season),
    loadStreaks(client, options),
    options.includeBreakdown === true
      ? loadAllTimeBreakdowns(client, season, timeZone)
      : Promise.resolve(new Map<string, readonly BoardGame[]>()),
  ]);
  const runs = new Map(streaks.map((streak) => [streak.puuid, streak.current]));

  const rows: BoardRow[] = players.map((player) => {
    const stored = ratings.get(player.id);
    // No `ratings` row means nothing has been folded, so the honest number is where the fold
    // would begin: `provisionalSeed()`, the same 1200 for everybody, beside `0 games` and the
    // `settling` chip (2026-09-16). It used to be this player's rank, which put a Challenger who
    // had never turned up at 2100 on a board of people who had.
    const rating = stored?.rating ?? provisionalSeed();
    const games = stored?.games ?? 0;
    const wins = stored?.wins ?? 0;

    return {
      puuid: player.puuid,
      name: player.name,
      // `All time` is the stored fold and nothing else: the weekly track (M7.3) is read on the
      // two week windows and never here.
      track: 'all-time',
      proven: provenRating(rating),
      sortKey: provenSortKey(rating),
      rating: displayRating(rating.mu),
      games,
      wins,
      losses: games - wins,
      streak: runs.get(player.puuid) ?? null,
      climb: null,
      settling: games < SETTLING_GAMES,
      breakdown: breakdowns.get(player.id) ?? [],
      // `All time` hands out no award (M5.4): "most improved of all time" is a different
      // question from the one the three ask, and a window that never closes has none.
      awards: [],
    };
  });

  return { window, ...slot, rows: sortBoardRows(rows) };
}

/**
 * The two facts the header slot is made of: how many counted games the window holds, and — for
 * `All time` — the day the first of them was played (M5.12, the designer's slot).
 *
 * **A counted game is a game with a rated scoreboard row**, and the count is of *games*, not of
 * rows: PostgREST's `count: 'exact'` over a `!inner` embed counts the parent, which is exactly
 * the number the slot wants (checked against the local stack, 2026-09-10: 35 games behind 350
 * rated rows).
 *
 * It is a second read rather than a count taken off the rows a window already loads, so that
 * `All time` — which reads no games at all — and the four windows get their number from one
 * definition instead of two.
 */
async function loadWindowFacts(
  client: PublicClient,
  seasonId: string,
  window: WindowKind,
  range: WindowRange,
): Promise<{ games: number; firstCountedAt: Date | null }> {
  const games = await countCountedGames(client, seasonId, range);
  if (games === 0 || window !== 'all-time') return { games, firstCountedAt: null };
  return { games, firstCountedAt: await firstCountedGameAt(client, seasonId) };
}

async function countCountedGames(
  client: PublicClient,
  seasonId: string,
  range: WindowRange,
): Promise<number> {
  let query = client
    .from('games')
    .select('id, game_players!inner(mu_after)', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .not('game_players.mu_after', 'is', null);
  query = withRange(query, 'started_at', range);

  const { count, error } = await query;
  if (error) throw new Error(`board: counting the window's games failed: ${error.message}`);
  return count ?? 0;
}

/** The oldest counted game there is: `All time`'s `Since 8 Sep 2025`. */
async function firstCountedGameAt(client: PublicClient, seasonId: string): Promise<Date | null> {
  const { data, error } = await client
    .from('games')
    .select('started_at, game_players!inner(mu_after)')
    .eq('season_id', seasonId)
    .not('game_players.mu_after', 'is', null)
    .order('started_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`board: first game lookup failed: ${error.message}`);

  const startedAt = data?.[0]?.started_at;
  return startedAt === undefined ? null : new Date(startedAt);
}

/**
 * One window's rows: the players who played inside it, with their numbers **as of their last
 * counted game in it** (M5.12) — or, on a week, **folded from scratch over the window** (M7.3).
 *
 * On `Last month` the first rule is the whole story: the board as it stood when the month
 * closed, which is what makes the monthly post reproducible afterwards and after a late
 * backfill.
 *
 * On `This week` and `Last week` the row's four rating numbers come from the weekly track
 * instead — the player's seed, folded through this week's counted games with `rateGameWeekly`
 * — because a week judged on a rating forty games of history are already in is a week that
 * cannot show. **Membership, the counts and the order of the games are identical either way**;
 * the difference is which number the row carries and, for a week, that the number it sorts and
 * prints is `Rating` rather than Proven (`weekly.ts` says why).
 *
 * A counted game is one the fold counted, which on a stored row is `mu_after is not null`.
 * An unrated game in the window counts nowhere here, exactly as on `/leaderboard` today — and
 * it is not in the weekly fold either, so the two agree about what the week was.
 */
async function windowRows(
  client: PublicClient,
  seasonId: string,
  range: WindowRange,
  options: BoardOptions,
): Promise<BoardRow[]> {
  const games = await loadSeasonGames(client, seasonId, { limit: SEASON_GAME_LIMIT, range });
  if (games.length === 0) return [];

  const byGame = new Map(games.map((game) => [game.id, game]));
  const rows = await loadGameRows(
    client,
    games.map((game) => game.id),
  );

  // Oldest first, per player: the climb is the first game's `mu_before` and the last one's
  // `mu_after`, and `game_players` comes back in whatever order Postgres feels like.
  const byPlayer = new Map<string, { row: PlayerGameRow; game: SeasonGame }[]>();
  for (const row of rows) {
    const game = byGame.get(row.gameId);
    // All three or none: the fold writes `mu_before`, `mu_after` and `sigma_after` together, and
    // a row missing any of them is an unrated game — which counts nowhere on a board.
    if (game === undefined || row.muBefore === null || row.muAfter === null || row.sigmaAfter === null) {
      continue;
    }
    const played = byPlayer.get(row.playerId) ?? [];
    played.push({ row, game });
    byPlayer.set(row.playerId, played);
  }
  for (const played of byPlayer.values()) {
    played.sort((a, b) => Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt));
  }

  const playerIds = [...byPlayer.keys()];
  const [players, ratings] = await Promise.all([
    loadPlayersByIds(client, playerIds),
    loadRatings(client, seasonId, playerIds),
  ]);
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const includeBreakdown = options.includeBreakdown === true;

  /**
   * **The week's own fold** (M7.3), or `null` on the two month windows, where every number on
   * the row is the stored one exactly as M5.12 shipped it.
   */
  const weekly = isWeekWindow(options.window) ? weeklyFold(games, rows, players, ratings, playerIds) : null;

  return playerIds.flatMap((playerId) => {
    const player = players.get(playerId);
    const played = byPlayer.get(playerId) ?? [];
    const first = played[0];
    const last = played[played.length - 1];
    // A scoreboard row whose player `players_public` cannot answer for is not a row we can
    // draw. The foreign key says it cannot happen.
    if (player === undefined || first === undefined || last === undefined) return [];

    const stored: Rating = { mu: last.row.muAfter as number, sigma: last.row.sigmaAfter as number };
    const week = weekly?.get(playerId) ?? null;
    const rating: Rating = week === null ? stored : week.rating;
    const wins = played.filter(({ row, game }) => row.side === game.winningSide).length;

    return [
      {
        puuid: player.puuid,
        name: player.name,
        track: week === null ? ('all-time' as const) : ('weekly' as const),
        proven: provenRating(rating),
        /**
         * **What the board sorted on, unrounded.** The `ordinal` on a month window, and on a
         * week the weekly `mu` itself — the week prints `Rating`, and the rule that the order
         * and the primary number are one number is what decides this (user, 2026-09-15).
         */
        sortKey: week === null ? provenSortKey(rating) : rating.mu,
        rating: displayRating(rating.mu),
        games: played.length,
        wins,
        losses: played.length - wins,
        // The window line replaces line 2's meta, and product fixed its shape without a
        // streak in it: `6 games · 4W 2L · +58`.
        streak: null,
        climb:
          week === null
            ? { muBefore: first.row.muBefore as number, muAfter: last.row.muAfter as number }
            : // The weekly seed to the weekly end: where Sunday put them, and where the week
              // left them. Both ends on one track, like every other number on the row.
              { muBefore: week.seed.mu, muAfter: week.rating.mu },
        // **The all-time count**, not the window's: the chip is a fact about the rating. On a
        // week there is no chip at all (M7.3): every row would carry it, every week.
        settling: week === null && (ratings.get(playerId)?.games ?? played.length) < SETTLING_GAMES,
        breakdown: includeBreakdown ? playedBreakdown(played, timeZone, week) : [],
        // Filled by {@link withAwards} on a closed window, from `lib/stats`' own answer. The
        // row is built without one so that a caller that never asked cannot be given any.
        awards: [],
      },
    ];
  });
}

/**
 * The closed window's awards, or nothing (M8.3).
 *
 * **Placement, not a second computation**: `loadAwardWinners` runs `awardsView` over the same
 * window, so the badge on a row and the award line on `/stats` and in the Discord post are one
 * answer. `lib/board` folds no award of its own and imports no part of one.
 *
 * A failed lookup is **no badges and one line in the log**, never a failed board: the badge is
 * something the window handed out, and a page that 500s because it could not be drawn would
 * trade the whole leaderboard for a label on three rows.
 */
async function rowAwards(client: PublicClient, options: BoardOptions): Promise<AwardWinners> {
  if (options.includeAwards !== true) return NO_AWARD_WINNERS;
  try {
    return await loadAwardWinners(client, options);
  } catch (error) {
    console.error('board: reading the window awards failed', error);
    return NO_AWARD_WINNERS;
  }
}

/**
 * The winners' titles, matched to rows by **puuid** — the identity both sides carry (CLAUDE.md).
 *
 * A winner the board does not list — a cursed-duo half below the window's own membership — is
 * simply not badged and **no row is added for them**. With nobody to badge the rows are handed
 * back untouched — which is every window but the two closed ones, and a closed one nobody
 * qualified in: the board those draw is the board they drew before this existed.
 */
function withAwards(rows: BoardRow[], winners: AwardWinners): BoardRow[] {
  if (winners.size === 0) return rows;
  return rows.map((row) => {
    const won = winners.get(row.puuid);
    return won === undefined ? row : { ...row, awards: won };
  });
}

/**
 * **The week, folded — and the only place in `apps/web` that folds one** (M7.3, M7.16).
 *
 * `/leaderboard`'s rows and `/p/[puuid]` both come through here, which is what makes the digit
 * on a row and the digit on the page it links to one number rather than two computations that
 * agree on a good day. The maths itself is `weekly.ts`'s and core's; this assembles its two
 * inputs out of rows a caller has already read.
 *
 * The seed is `lib/ingest/seed.ts`'s rule and **not a second reading of it**: the stored
 * `ratings.seed_*` pair first, and `provisionalSeed()` — not a rank — for somebody who has never
 * been rated (2026-09-16). That is what makes `Last week` read the same on Tuesday as it did on
 * Sunday, and the same again after a rank moves.
 *
 * `playerIds` is every player with a rated row in the window, which by construction is every
 * seat of every game the fold will read.
 */
function weeklyFold(
  games: readonly SeasonGame[],
  rows: readonly PlayerGameRow[],
  players: ReadonlyMap<string, PlayerRow>,
  ratings: ReadonlyMap<string, RatingRow>,
  playerIds: readonly string[],
): Map<string, WeeklyPlayerRating> {
  return foldWeeklyRatings(
    weeklyGames(games, rows, players),
    new Map(
      playerIds.map((playerId) => {
        const player = players.get(playerId);
        return [
          playerId,
          seedFor(ratings.get(playerId)?.seed ?? null, player?.rankTier ?? null, player?.rankDivision ?? null)
            .rating,
        ];
      }),
    ),
  );
}

/**
 * The same fold for a page that started from **one** player (M7.16): `/p/[puuid]` reads its own
 * scoreboard rows, and a week's numbers are a property of the ten seats of every game in it, so
 * the week has to be read whole and the answer picked out of it.
 *
 * Two reads, on the two week windows only, after the games the page was loading anyway. The
 * month windows and `All time` make neither.
 */
async function loadWeeklyFold(
  client: PublicClient,
  seasonId: string,
  games: readonly SeasonGame[],
): Promise<Map<string, WeeklyPlayerRating>> {
  if (games.length === 0) return new Map();

  const rows = await loadGameRows(
    client,
    games.map((game) => game.id),
  );
  // The window's rated seats, deduplicated: a week of ten-player games is the same twenty
  // people over and over, and the seed lookup is one row each.
  const playerIds = [...new Set(rows.flatMap((row) => (row.muAfter === null ? [] : [row.playerId])))];
  if (playerIds.length === 0) return new Map();

  const [players, ratings] = await Promise.all([
    loadPlayersByIds(client, playerIds),
    loadRatings(client, seasonId, playerIds),
  ]);
  return weeklyFold(games, rows, players, ratings, playerIds);
}

/**
 * The window's **rated** games in the shape the weekly fold reads: the ten seats of each, from
 * the rows already in memory, with the puuid the fold orders a side by.
 *
 * Every seat of a rated game is on the window's board by construction — the all-time fold wrote
 * all ten `mu_after` columns together — so this never reaches for a player the board did not
 * already load.
 *
 * **A game with no rated seat is dropped here rather than skipped downstream**, because that is
 * not an anomaly: an ARAM night (M7.1) and a backfilled game the rebuild has not folded yet both
 * look like this, they count nowhere else on the board either, and the fold's skip warning is
 * for the shape that should not exist.
 */
function weeklyGames(
  games: readonly SeasonGame[],
  rows: readonly PlayerGameRow[],
  players: ReadonlyMap<string, PlayerRow>,
): WeeklyGame[] {
  const seats = new Map<string, WeeklyPlayer[]>();
  for (const row of rows) {
    // Unrated rows are not part of the week: the board does not count them either.
    if (row.muAfter === null) continue;
    const player = players.get(row.playerId);
    if (player === undefined) continue;
    const list = seats.get(row.gameId) ?? [];
    list.push({ playerId: row.playerId, puuid: player.puuid, side: row.side });
    seats.set(row.gameId, list);
  }

  return games.flatMap((game) => {
    const players = seats.get(game.id);
    if (players === undefined) return [];
    return [
      {
        gameId: game.id,
        startedAt: game.startedAt,
        lcuGameId: game.lcuGameId,
        winningSide: game.winningSide,
        players,
      },
    ];
  });
}

/**
 * `All time`'s expand (M5.30): every rated game in the season, newest first, keyed by
 * `player_id` so the row construction stays a map lookup.
 *
 * A second read rather than folding it into the all-time path's `ratings` query, because that
 * path is the one the rail takes and the rail does not open.
 */
async function loadAllTimeBreakdowns(
  client: PublicClient,
  seasonId: string,
  timeZone: string,
): Promise<Map<string, readonly BoardGame[]>> {
  const games = await loadSeasonGames(client, seasonId, { limit: SEASON_GAME_LIMIT });
  if (games.length === 0) return new Map();

  const byGame = new Map(games.map((game) => [game.id, game]));
  const rows = await loadGameRows(
    client,
    games.map((game) => game.id),
  );
  const byPlayer = new Map<string, { row: PlayerGameRow; game: SeasonGame }[]>();
  for (const row of rows) {
    const game = byGame.get(row.gameId);
    if (game === undefined || row.muBefore === null || row.muAfter === null) continue;
    const played = byPlayer.get(row.playerId) ?? [];
    played.push({ row, game });
    byPlayer.set(row.playerId, played);
  }

  const out = new Map<string, readonly BoardGame[]>();
  for (const [playerId, played] of byPlayer) {
    out.set(playerId, playedBreakdown(played, timeZone));
  }
  return out;
}

/**
 * One player's games under their row (M5.30).
 *
 * `week` is their weekly fold on a week window and `null` everywhere else: the expand explains
 * the number it sits under, so on `This week` each game's pair is the weekly track's — a row
 * whose total is weekly and whose games were all-time would be a row that does not add up
 * (M7.3). A game the weekly fold skipped has no pair and is not listed.
 */
function playedBreakdown(
  played: readonly { row: PlayerGameRow; game: SeasonGame }[],
  timeZone: string,
  week: WeeklyPlayerRating | null = null,
): BoardGame[] {
  const weekly = week === null ? null : new Map(week.games.map((game) => [game.gameId, game]));

  return boardBreakdown(
    played.flatMap(({ row, game }) => {
      const pair =
        weekly === null
          ? { muBefore: row.muBefore as number, muAfter: row.muAfter as number }
          : weekly.get(game.id);
      if (pair === undefined) return [];
      return [
        {
          gameId: game.id,
          startedAt: game.startedAt,
          durationS: game.durationS,
          won: row.side === game.winningSide,
          side: row.side,
          muBefore: pair.muBefore,
          muAfter: pair.muAfter,
        },
      ];
    }),
    timeZone,
  );
}

/**
 * The board's first rows, for a surface that has room for a few of them — the tonight page's
 * ≥1080px rail (`05-design.md`, "Breakpoints and the desktop grid": `Top of the board`).
 *
 * **The same query, the same sort, the same rows.** It is {@link loadBoard} with a slice on the
 * end rather than a second read with its own ordering, because a rail that disagreed with the
 * page it links to about who is first is worse than a rail with nothing in it. The group is
 * twenty rows; there is nothing to save by reading fewer.
 */
export async function loadTopPlayers(
  client: PublicClient,
  options: BoardOptions & { limit: number },
): Promise<BoardRow[]> {
  const board = await loadBoard(client, options);
  return board.rows.slice(0, Math.max(0, options.limit));
}

/**
 * The same rows, for a surface where **failing to read them is not a reason to fail the page**
 * (M3.19, reviewer): the tonight page's rail.
 *
 * The tonight page answers "is the night happening and am I in it", and it did not depend on
 * the board's four queries until the rail arrived. Awaited beside the snapshot, a season lookup
 * that times out would turn a working teams screen into a 500 — for the one block `05-design.md`
 * calls a snapshot that refreshes with the page and that carries no state. So a failed read is
 * an empty rail and one line in the server log, exactly like `TonightLive`'s failed re-read:
 * the last thing on the screen stays on the screen and nothing is announced.
 */
export async function loadTopPlayersOrNone(
  client: PublicClient,
  options: BoardOptions & { limit: number },
): Promise<BoardRow[]> {
  try {
    return await loadTopPlayers(client, options);
  } catch (error) {
    console.error('tonight: reading the rail board failed', error);
    return [];
  }
}

/**
 * One player's page: the two numbers, the `Rating` history, the role record and the last few
 * games. `null` when no `players_public` row has that puuid, which the page turns into a 404.
 *
 * **On `This week` and `Last week` every rating number here is the weekly track's** (M7.16),
 * through the same `weeklyFold` the board runs: the one number, the chart, the `start` hairline
 * and each recent game's delta. It is M7.3's own follow-up — the board row said `1612` and the
 * page a tap later said `1730`, both right, with nothing on either saying which question it was
 * answering. `All time`, `This month` and `Last month` are untouched, down to the byte.
 */
export async function loadPlayerBoard(
  client: PublicClient,
  puuid: string,
  options: BoardOptions,
): Promise<PlayerBoardView | null> {
  const player = await selectPlayer(client, puuid);
  if (player === null) return null;

  const window = options.window;
  const range = windowRange(window, options.now ?? new Date(), options.timeZone);
  const season = await selectSeasonId(client);

  // No season row means no games and no ratings: the page is the person, their seed numbers
  // and the window's empty line. (Until 2026-09-10 this was a separate shape carrying one
  // sentence about starting a season; there is no such button now — M5.14.)
  if (season === null) {
    // **One number, three times.** Nothing has been folded, so `Rating`, `Proven` and the
    // chart's reference line are all the seed the first fold will store — `provisionalSeed()`,
    // 1200 — and the page cannot contradict itself the way it did until 2026-09-16, when the two
    // at the top came from this player's rank and the line under the chart came from the seed.
    // The rank strings still ride onto the seed `seedFor` returns, because that is the shape the
    // ingest stores; since M7.20 nothing formats them for the view.
    const seed = seedFor(null, player.rankTier, player.rankDivision);
    return {
      puuid: player.puuid,
      name: player.name,
      window,
      // A week with no database behind it is still a week (M7.16): the number on the screen is
      // the seed the weekly fold would have started from, which is the same number, so the page
      // says it under one label instead of two and carries no chip.
      track: isWeekWindow(window) ? 'weekly' : 'all-time',
      range: null,
      rating: displayRating(seed.rating.mu),
      proven: provenRating(seed.rating),
      games: 0,
      wins: 0,
      losses: 0,
      settling: !isWeekWindow(window),
      reference: displayRating(seed.rating.mu),
      history: [],
      recent: [],
    };
  }

  const [ratings, games, rows] = await Promise.all([
    loadRatings(client, season, [player.id]),
    loadSeasonGames(client, season, { limit: SEASON_GAME_LIMIT, range }),
    loadPlayerGameRows(client, player.id, season, range),
  ]);

  const byGame = new Map(games.map((game) => [game.id, game]));
  // Every game of this season this player has a scoreboard row for, oldest first:
  // `game_players` comes back in whatever order Postgres feels like, and the fold is a walk
  // through `started_at`.
  const all = rows
    .filter((row) => byGame.has(row.gameId))
    .map((row) => ({ row, game: byGame.get(row.gameId) as SeasonGame }))
    .sort((a, b) => Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt));

  /**
   * **The rated ones, and only they, are what the numbers are made of** (M3.23). The chart
   * series, the seed line, the by-role record and `37 games · 20W 17L` all count the games the
   * fold counted; `Recent games` counts the games the player played. A game that landed
   * unrated is in the list, with `not rated` where its rating would be, and is in neither
   * total.
   */
  const played = all.filter(({ row }) => row.muAfter !== null);

  const stored = ratings.get(player.id);
  // Same rule as a board row, for the same reason: with no folded row the number this page
  // shows is where the fold would start, not what solo queue says (2026-09-16).
  const current = stored?.rating ?? provisionalSeed();
  const allTimeGames = stored?.games ?? 0;

  /**
   * **Where this page's history starts** (M5.7): the seed stored on the `ratings` row, and the
   * provisional first seed when there is none — the same preference both folds apply, read from the
   * same helper, so the line above the chart cannot name a number the fold did not use. A friend
   * whose row was written under the old rank rule still reads their stored `Gold IV` number,
   * because that is what their history was folded from; their rank today is on the client, not
   * on this line.
   *
   * **One value comes out of it: the number** (M7.20). The stored seed's rank strings are read
   * here, as part of the stored shape, and formatted nowhere — M7.19 took the rank off M5.15's
   * sentence and M7.20 deleted the view field and the formatter that fed it.
   */
  const seed = seedFor(stored?.seed ?? null, player.rankTier, player.rankDivision);
  const seedRating = displayRating(seed.rating.mu);

  /**
   * **The last few games, and — on a week window — the week they sit in** (M7.16), read side by
   * side: the second is two queries this page would otherwise wait for after the first, and it
   * is a phone on a link.
   *
   * `null` on the three windows that read the stored track, which make no extra query at all.
   */
  const [recent, weekly] = await Promise.all([
    loadRecentGames(
      client,
      recentGames(
        all.map(({ row, game }) => ({ row, game, startedAt: game.startedAt, muAfter: row.muAfter })),
        RECENT_GAMES,
      ),
    ),
    isWeekWindow(window) ? loadWeeklyFold(client, season, games) : Promise.resolve(null),
  ]);

  /**
   * **Which track this page is reading** (M7.16), and the player's own line through it.
   *
   * `week` is `null` on the three stored-track windows *and* for a player with no counted game
   * inside the week — the second case reads as their weekly seed below, which is where Sunday
   * put them and the honest answer to "how was their week" when they did not play it.
   */
  const onWeek = weekly !== null;
  const week = weekly?.get(player.id) ?? null;

  /**
   * **The two numbers, and where they come from** (M5.12, M7.16).
   *
   * On `All time` they are the `ratings` row — the fold's own totals, byte-identical to what
   * M3.5 shipped and to the row on `/leaderboard`. On a month window they are this player as of
   * their last counted game inside it, from that game's `mu_after` / `sigma_after`, and the
   * record counts the window's games.
   *
   * **On a week window they are the weekly fold's**, so the digit here is the digit on that
   * player's row on `/leaderboard?window=this-week` — the whole of M7.16. `Proven` is computed
   * off the same pair and printed nowhere, exactly as on a week board row.
   *
   * With no counted game in the window they fall back to the current rating — or, on a week, to
   * the weekly seed: the page is a person, not a board row, and printing nothing where a number
   * goes would say something the empty line under it already says better.
   */
  const last = played[played.length - 1];
  const first = played[0];
  const windowed = window !== 'all-time' && last !== undefined;
  const stayed: Rating = windowed
    ? { mu: last.row.muAfter as number, sigma: last.row.sigmaAfter as number }
    : current;
  const rating: Rating = onWeek ? (week?.rating ?? seed.rating) : stayed;
  const windowWins = played.filter(({ row, game }) => row.side === game.winningSide).length;
  const counted = window === 'all-time' ? allTimeGames : played.length;
  const wins = window === 'all-time' ? (stored?.wins ?? 0) : windowWins;

  return {
    puuid: player.puuid,
    name: player.name,
    window,
    track: onWeek ? 'weekly' : 'all-time',
    /**
     * **The window's range, dated from this player's own history on `All time`** — the page is
     * a person, and `Since 8 Sep 2025` there means since *their* first counted game, not the
     * group's. A week or a month is a calendar fact and is the same on every page.
     */
    range:
      counted === 0
        ? null
        : windowRangeLabel(
            window,
            range,
            first === undefined ? null : new Date(first.game.startedAt),
            options.timeZone,
          ),
    rating: displayRating(rating.mu),
    proven: provenRating(rating),
    games: counted,
    wins,
    losses: counted - wins,
    // The 30-game rule reads the whole history in every window (M3.8) — and never on a week,
    // where there is no Proven on the page for the chip and its sentence to explain (M7.16).
    settling: !onWeek && allTimeGames < SETTLING_GAMES,
    /**
     * The chart's hairline: the seed on `All time`, and in a window the rating carried
     * **into** it — the `mu_before` of the first counted game in it, which is where the week
     * found them. That is not a seed and does not borrow the word (`start`, M5.12).
     *
     * **On a week window it is the weekly seed** (M7.16) — and that is `seedRating` itself,
     * because the weekly fold starts from exactly the `seedFor` answer this page already read.
     * One number, read once, so the hairline, M5.15's `Started the week at …` line and the first
     * point of the series cannot disagree. It keeps the `start` label: a week's seed is not the
     * seed of a history.
     */
    reference:
      onWeek || window === 'all-time' || first === undefined
        ? seedRating
        : displayRating(first.row.muBefore as number),
    history: onWeek ? weeklySeries(week) : historySeries(played),
    recent: onWeek ? weeklyRecent(recent, week) : recent,
  };
}

/**
 * The plotted series: the rating this player carried into their first game, then the rating
 * they carried out of every game since.
 *
 * The first point is a `mu_before` on purpose — a chart that starts at the outcome of game one
 * hides the only move a player with one game has made.
 */
function historySeries(played: readonly { row: PlayerGameRow }[]): number[] {
  const first = played[0];
  if (first === undefined) return [];

  const series = first.row.muBefore === null ? [] : [displayRating(first.row.muBefore)];
  for (const { row } of played) {
    if (row.muAfter !== null) series.push(displayRating(row.muAfter));
  }
  return series;
}

/**
 * The same series on a week window: **the weekly fold's own steps** (M7.16).
 *
 * Same shape as {@link historySeries} — the rating carried into the first game of the week,
 * then the rating carried out of every game since — read off the pairs the fold produced rather
 * than off the stored columns, so the line ends at the number printed above it. A player the
 * week holds no counted game for has nothing to plot and no chart is drawn, which is what the
 * window's empty line is already saying in words.
 */
function weeklySeries(week: WeeklyPlayerRating | null): number[] {
  const first = week?.games[0];
  if (week === null || first === undefined) return [];
  return [displayRating(first.muBefore), ...week.games.map((game) => displayRating(game.muAfter))];
}

/**
 * `Recent games` on a week window: the same games, with **the weekly deltas** (M7.16).
 *
 * The list itself does not change — M3.23 lists the games the player played, rated or not, and
 * a week does not hide one. What changes is the pair each row's `1512 (+43)` is computed from,
 * for the reason M7.3 gave the board row's expand: a list whose deltas do not add up to the
 * number above it is a page arguing with itself.
 *
 * **A game the weekly fold did not rate reads `not rated`** — the same three words an unrated
 * game already reads, because the reader's question ("why did this not move the number above")
 * has the same answer. That is every ARAM and every unfolded backfill, which read that way on
 * both tracks, and in principle a rated game the weekly fold skipped for not being five a side:
 * the all-time fold refuses those, so it is the shape that should not exist rather than a case
 * with a design. Nothing here touches `award`, which is a fact about who played the game and
 * does not move with the track (M7.10).
 */
function weeklyRecent(recent: readonly RecentGame[], week: WeeklyPlayerRating | null): RecentGame[] {
  const byGame = new Map((week?.games ?? []).map((game) => [game.gameId, game]));
  return recent.map((game) => {
    const pair = byGame.get(game.gameId);
    return pair === undefined
      ? { ...game, muBefore: null, muAfter: null }
      : { ...game, muBefore: pair.muBefore, muAfter: pair.muAfter };
  });
}

/*
 * `roleRecord` stood here until M5.20 (2026-09-11): `By role` over this player's rated rows.
 *
 * The section is drawn from `lib/stats` now — the same fold `/stats` uses, over the games
 * `gateGame` counts, with product's five-row minimum and a percentage. This file no longer
 * answers a question two files can answer differently (`04-decisions.md`).
 */

/**
 * The last few games, each with the five the player was on, in lane order.
 *
 * Names are read from `players_public` by the ids on the scoreboard — never from the lobby
 * roster, which is a different ten once a lobby has been frozen at `in_game`.
 */
async function loadRecentGames(
  client: PublicClient,
  played: readonly { row: PlayerGameRow; game: SeasonGame }[],
): Promise<RecentGame[]> {
  if (played.length === 0) return [];

  const gameIds = played.map(({ game }) => game.id);
  // Wider by the nine stat columns (M7.10): the MVP and the ACE are named from them, by the
  // same function the fold used, and this is the read that was already fetching all ten rows of
  // each of these games for the lane-ordered five beside the row.
  const rows = await loadGameRows(client, gameIds, { withStats: true });
  const names = await loadNamesByPlayerId(
    client,
    rows.map((row) => row.playerId),
  );
  // The win chance the balancer gave, per lobby (M5.15). Read for the five on screen and not
  // for the season: it is a sentence on a row, and a row nobody is looking at needs no odds.
  const odds = await loadChosenWinProbs(
    client,
    played.flatMap(({ game }) => (game.lobbyId === null ? [] : [game.lobbyId])),
  );

  return played.map(({ row, game }) => {
    const all = rows.filter((other) => other.gameId === game.id);
    const team: RecentTeammate[] = all
      .filter((other) => other.side === row.side)
      // A scoreboard row whose player we cannot read is not a row we can draw: no name and no
      // puuid to key it on. The foreign key says it cannot happen; a blank line in a list of
      // five would read as a bug if it ever did.
      .flatMap((other) => {
        const player = names.get(other.playerId);
        return player === undefined ? [] : [{ puuid: player.puuid, name: player.name, role: other.role }];
      });

    return {
      gameId: game.id,
      startedAt: game.startedAt,
      durationS: game.durationS,
      won: row.side === game.winningSide,
      side: row.side,
      role: row.role,
      muBefore: row.muBefore,
      muAfter: row.muAfter,
      award: recentAward(all, game, names, row.playerId),
      // Blue's chance, as it was stored. The page turns it into this player's own side's.
      blueWinProb: game.lobbyId === null ? null : (odds.get(game.lobbyId) ?? null),
      team: inLaneOrder(team),
    };
  });
}

/**
 * Was **this player** the MVP or the ACE of this game (M7.10)? `null` for the eight who were
 * neither, and for every game that has no award at all.
 *
 * The answer is `gatedGameAward`'s, which is the function the Discord result embed calls on the
 * same columns of the same game — so the word on this row and the name in that post cannot
 * disagree (acceptance 3). Nothing here re-derives a score, and nothing prints "nearly MVP".
 *
 * Three ways to `null`, and all three print nothing:
 *
 * - **A row whose player we could not read**, so there is no puuid to match on. The same
 *   condition already drops that row from the five beside it.
 * - **A game the fold did not rate**: a row here with a null `mu_after` is a remake, a short
 *   surrender, a backfilled game waiting for `rebuild-ratings`, or an ARAM (M7.1, four null
 *   rating columns for ever). None of them has an MVP, and the row already says `not rated`.
 * - **A game the score cannot be computed for**: a column stored before migration `0014` or
 *   `0015`, or one of the ten with no role. Core's own rule, unchanged.
 */
function recentAward(
  all: readonly PlayerGameRow[],
  game: SeasonGame,
  names: ReadonlyMap<string, { puuid: string; name: PlayerName }>,
  playerId: string,
): RecentAward | null {
  const mine = names.get(playerId)?.puuid;
  if (mine === undefined) return null;

  const ten: FoldAwardPlayer[] = [];
  for (const row of all) {
    const puuid = names.get(row.playerId)?.puuid;
    if (puuid === undefined || row.muAfter === null || row.stats === null) return null;
    ten.push({ puuid, side: row.side, ...row.stats });
  }

  const award = gatedGameAward(ten, game.durationS, game.winningSide);
  if (award === null) return null;
  return award.mvp === mine ? 'mvp' : award.ace === mine ? 'ace' : null;
}

/**
 * The chance the balancer gave blue, per lobby: the **chosen** split's `blue_win_prob` (M5.15).
 *
 * `splits` is publicly readable and is the same row the tonight page and the teams embed read,
 * so the percentage on a recent-games row is the one the group was shown on the night. A lobby
 * with no chosen split — balanced and then rerolled into nothing, or never balanced at all —
 * simply has no entry, and the row drops the clause.
 */
async function loadChosenWinProbs(
  client: PublicClient,
  lobbyIds: readonly string[],
): Promise<Map<string, number>> {
  const odds = new Map<string, number>();

  for (const chunk of inChunks(lobbyIds)) {
    const { data, error } = await client
      .from('splits')
      .select('lobby_id, blue_win_prob')
      .in('lobby_id', chunk)
      .eq('is_chosen', true);
    if (error) throw new Error(`board: split lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.blue_win_prob === null) continue;
      odds.set(row.lobby_id, row.blue_win_prob);
    }
  }
  return odds;
}

/**
 * The one season row's id — the all-time container every `games.season_id` points at — or
 * `null` for a database that is missing it.
 *
 * **Its name is never read**, because a season's name is never printed to a friend again
 * (M5.12): the board's heading is the window's name. `0001_init.sql` inserts this row and
 * nothing can make a second (M5.14), so `null` here means a broken deployment, not a state the
 * product has.
 */
async function selectSeasonId(client: PublicClient): Promise<string | null> {
  const { data, error } = await client
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board: season lookup failed: ${error.message}`);
  return data?.id ?? null;
}

/** `players_public`: `players` minus `discord_id`, and the only players relation anon can read. */
async function loadAllPlayers(client: PublicClient): Promise<PlayerRow[]> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name, rank_tier, rank_division');
  if (error) throw new Error(`board: player lookup failed: ${error.message}`);
  return (data ?? []).flatMap((row) => (row.id === null || row.puuid === null ? [] : [toPlayer(row)]));
}

async function selectPlayer(client: PublicClient, puuid: string): Promise<PlayerRow | null> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name, rank_tier, rank_division')
    .eq('puuid', puuid)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board: player lookup failed: ${error.message}`);
  if (!data || data.id === null || data.puuid === null) return null;
  return toPlayer(data);
}

interface PublicPlayerRow {
  id: string | null;
  puuid: string | null;
  display_name: string | null;
  game_name: string | null;
  rank_tier: string | null;
  rank_division: string | null;
}

function toPlayer(row: PublicPlayerRow): PlayerRow {
  return {
    id: row.id as string,
    puuid: row.puuid as string,
    // M3.10's fallback is applied at render; the loader carries the honest `null`.
    name: row.display_name ?? row.game_name ?? null,
    rankTier: row.rank_tier,
    rankDivision: row.rank_division,
  };
}

/**
 * The players on a window's board, by the ids their scoreboard rows carry — name **and** rank,
 * because a row needs the same fields `loadAllPlayers` gives the all-time board.
 *
 * Read by id and not as "everybody": a window's membership is the games, so asking for the
 * whole roster and throwing most of it away would make the two boards two different reads of
 * the same table.
 */
async function loadPlayersByIds(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerRow>> {
  const players = new Map<string, PlayerRow>();

  for (const chunk of inChunks(playerIds)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid, display_name, game_name, rank_tier, rank_division')
      .in('id', chunk);
    if (error) throw new Error(`board: player lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      players.set(row.id, toPlayer(row));
    }
  }
  return players;
}

/** Names for a set of player ids, from `players_public`, for the ids being rendered. */
async function loadNamesByPlayerId(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, { puuid: string; name: PlayerName }>> {
  const names = new Map<string, { puuid: string; name: PlayerName }>();

  for (const chunk of inChunks(playerIds)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid, display_name, game_name')
      .in('id', chunk);
    if (error) throw new Error(`board: name lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      names.set(row.id, { puuid: row.puuid, name: row.display_name ?? row.game_name ?? null });
    }
  }
  return names;
}

/**
 * The `ratings` rows for a set of players, or for everybody when no ids are given.
 *
 * The id list is chunked for the reason {@link ID_CHUNK} gives: a window's board asks for one
 * row per player who played, and a filter is a URL.
 */
async function loadRatings(
  client: PublicClient,
  seasonId: string,
  playerIds?: readonly string[],
): Promise<Map<string, RatingRow>> {
  const ratings = new Map<string, RatingRow>();
  // `undefined` is "everybody" and `[]` is "nobody": one is a board, the other is a no-op.
  const batches = playerIds === undefined ? [null] : inChunks(playerIds);

  for (const chunk of batches) {
    let query = client
      .from('ratings')
      .select('player_id, mu, sigma, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('season_id', seasonId);
    if (chunk !== null) query = query.in('player_id', chunk);

    const { data, error } = await query;
    if (error) throw new Error(`board: rating lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      ratings.set(row.player_id, {
        rating: { mu: row.mu, sigma: row.sigma },
        games: row.games,
        wins: row.wins,
        seed: readSeed(row),
      });
    }
  }
  return ratings;
}

/**
 * A season's games, **newest first**, capped at `limit`.
 *
 * The direction is not a preference (the designer's review, 2026-09-09). This read used to take
 * the *oldest* `SEASON_GAME_LIMIT` games for the player page while `loadPlayerGameRows` took
 * that player's newest — so once a season passed the cap the two sets stopped overlapping at
 * the recent end, and a player's latest games silently vanished from their chart, their record
 * and their recent-games list. Both reads now start at the same end. Callers that want the
 * oldest first sort in memory, which they were doing anyway.
 */
async function loadSeasonGames(
  client: PublicClient,
  seasonId: string,
  options: { limit: number; range?: WindowRange },
): Promise<SeasonGame[]> {
  let query = client
    .from('games')
    .select('id, lcu_game_id, started_at, duration_s, winning_side, lobby_id')
    .eq('season_id', seasonId);
  // **The window is a filter in the query, not a filter in memory** (M5.12): `Last month` on a
  // year of history would otherwise be read through the cap and come back empty.
  query = withRange(query, 'started_at', options.range);

  const { data, error } = await query.order('started_at', { ascending: false }).limit(options.limit);
  if (error) throw new Error(`board: game lookup failed: ${error.message}`);

  return (data ?? []).flatMap((row) =>
    row.winning_side === 100 || row.winning_side === 200
      ? [
          {
            id: row.id,
            lcuGameId: row.lcu_game_id,
            startedAt: row.started_at,
            durationS: row.duration_s,
            winningSide: row.winning_side as SideValue,
            lobbyId: row.lobby_id,
          },
        ]
      : [],
  );
}

interface PlayerGameRow {
  gameId: string;
  playerId: string;
  side: SideValue;
  role: RoleValue | null;
  muBefore: number | null;
  muAfter: number | null;
  /** Beside `mu_after`, because a window's Proven is `mu - 2σ` **as of that game** (M5.12). */
  sigmaAfter: number | null;
  /**
   * The stat line the performance score is computed from (M7.10), or `null` on a read that did
   * not ask for it.
   *
   * Only the recent-games read asks: it is nine integers on at most fifty rows, where the
   * board's read is the same shape over a thousand games and prints no award. The one place
   * that wants an MVP pays for it.
   */
  stats: FoldPerformance | null;
}

/** The nine stat columns the performance score reads, for the one select that asks for them. */
const STAT_COLUMNS =
  'kills, deaths, assists, damage_to_champs, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives' as const;

/**
 * One player's scoreboard rows for a season, newest first.
 *
 * Filtered through the embedded `games` rather than an `in` list of ids — the same shape
 * `lib/ingest/rebuild.ts` uses — so the season is the database's filter and not a pass over
 * everything the player has ever played. Ordered and limited for the same reason: without
 * them the query leans on PostgREST's row cap and gets an arbitrary thousand once somebody
 * has played more games than that across every season.
 *
 * **The order has to be spelled `games(started_at)`.** `started_at` is not a column of
 * `game_players`, so a top-level order on it is a 400 (`column game_players.started_at does not
 * exist`), and supabase-js's `referencedTable: 'games'` sorts *within* the embedded resource —
 * which for a to-one embed is one row and therefore a no-op. Checked against the local stack on
 * 2026-09-09 with three games: `referencedTable` returned them in insertion order and this
 * spelling returned them newest first.
 */
async function loadPlayerGameRows(
  client: PublicClient,
  playerId: string,
  seasonId: string,
  range?: WindowRange,
): Promise<PlayerGameRow[]> {
  let query = client
    .from('game_players')
    .select(
      'game_id, player_id, side, role, mu_before, mu_after, sigma_after, games!inner(started_at, season_id)',
    )
    .eq('player_id', playerId)
    .eq('games.season_id', seasonId);
  // The window filters the **embedded** column, the same spelling the order below uses: the
  // alternative is reading a year of rows to throw all but a week of them away.
  query = withRange(query, 'games.started_at', range);

  const { data, error } = await query
    .order('games(started_at)', { ascending: false })
    .limit(SEASON_GAME_LIMIT);
  if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
  return (data ?? []).map(toGameRow);
}

/**
 * The window, as two PostgREST filters: `[start, end)`, half-open, with `all-time`'s nulls
 * adding nothing (M5.9). One helper, so the two reads that take a range cannot disagree about
 * which end is inclusive.
 *
 * Generic over the builder rather than typed to one table: `PostgrestFilterBuilder`'s type
 * parameters differ per query and every caller passes the builder straight back to itself.
 */
function withRange<Q extends { gte(column: string, value: string): Q; lt(column: string, value: string): Q }>(
  query: Q,
  column: string,
  range: WindowRange | undefined,
): Q {
  if (range === undefined) return query;
  let next = query;
  if (range.start !== null) next = next.gte(column, range.start.toISOString());
  if (range.end !== null) next = next.lt(column, range.end.toISOString());
  return next;
}

/**
 * `game_players` for a set of games, in chunks, so no response is silently truncated.
 *
 * `withStats` is **the same query, nine columns wider** (M7.10, acceptance 4) and not a second
 * read. It is on for the five rows `Recent games` draws and off for the season-wide read behind
 * the board, which prints no award and would be carrying ninety thousand integers to say so.
 */
async function loadGameRows(
  client: PublicClient,
  gameIds: readonly string[],
  options: { withStats?: boolean } = {},
): Promise<PlayerGameRow[]> {
  const rows: PlayerGameRow[] = [];
  for (const chunk of inChunks(gameIds)) {
    // Two spelled-out selects rather than one string built at run time: a column list that is
    // a literal is checked against the generated types, and a typo in a nine-column addition
    // would otherwise only show up as a 400 on somebody's page.
    const { data, error } =
      options.withStats === true
        ? await client
            .from('game_players')
            .select(`game_id, player_id, side, role, mu_before, mu_after, sigma_after, ${STAT_COLUMNS}`)
            .in('game_id', chunk)
        : await client
            .from('game_players')
            .select('game_id, player_id, side, role, mu_before, mu_after, sigma_after')
            .in('game_id', chunk);
    if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
    rows.push(...(data ?? []).map(toGameRow));
  }
  return rows;
}

interface RawGamePlayerRow {
  game_id: string;
  player_id: string;
  side: number;
  role: RoleValue | null;
  mu_before: number | null;
  mu_after: number | null;
  sigma_after?: number | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  damage_to_champs?: number | null;
  gold?: number | null;
  cs?: number | null;
  vision_score?: number | null;
  damage_self_mitigated?: number | null;
  damage_to_objectives?: number | null;
}

function toGameRow(row: RawGamePlayerRow): PlayerGameRow {
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    role: row.role,
    muBefore: row.mu_before,
    muAfter: row.mu_after,
    sigmaAfter: row.sigma_after ?? null,
    stats: 'kills' in row ? toStats(row) : null,
  };
}

/**
 * The row's stat line under core's spellings — a rename, never a computation (M7.10).
 *
 * `role` is the scoreboard's own column with no fallback anywhere, because that is the column
 * the fold read: an MVP printed here has to be the player whose delta was actually amplified.
 */
function toStats(row: RawGamePlayerRow): FoldPerformance {
  return {
    role: row.role,
    kills: row.kills ?? null,
    deaths: row.deaths ?? null,
    assists: row.assists ?? null,
    damageToChamps: row.damage_to_champs ?? null,
    gold: row.gold ?? null,
    cs: row.cs ?? null,
    visionScore: row.vision_score ?? null,
    damageSelfMitigated: row.damage_self_mitigated ?? null,
    damageToObjectives: row.damage_to_objectives ?? null,
  };
}
