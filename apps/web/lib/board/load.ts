import { displayRating, type Rating, seedFromRank } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import { inChunks } from '../chunks';
import { readSeed, type StoredSeed, seedFor } from '../ingest/seed';
// `LANE_ORDER` left with `roleRecord` (M5.20): `By role` is `lib/stats`' fold now.
import { inLaneOrder } from '../laneOrder';
import { DEFAULT_NIGHT_TIME_ZONE, type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import { provenRating, provenSortKey } from '../ratingDisplay';
import { loadStreaks } from '../stats/load';
import type { PlayerName } from '../tonight/types';
import { boardBreakdown } from './breakdown';
import { rankLabel, SETTLING_GAMES } from './copy';
import { sortBoardRows } from './order';
import { recentGames } from './recent';
import type { BoardGame, BoardRow, BoardView, PlayerBoardView, RecentGame, RecentTeammate } from './types';
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
 *   `seedFromRank` in memory when there is none. That is what `loadPool` balances from and
 *   what the tonight page prints, so a seeded player who has not played yet appears on the
 *   board with the number the balancer would use rather than not appearing at all (M3.5's
 *   "zero games this season" edge case).
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
}

/**
 * The board, read through one window (M3.5, windowed by M5.12). Ordered by Proven descending,
 * and **the window changes who is on the board, not how boards are sorted** — a weekly board
 * sorted by "who climbed most this week" would be a second ranking with a second meaning, and
 * the group already has one number to argue about.
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
    return { window, ...slot, rows: sortBoardRows(await windowRows(client, season, range, options)) };
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
    const rating = stored?.rating ?? seedFromRank(player.rankTier, player.rankDivision);
    const games = stored?.games ?? 0;
    const wins = stored?.wins ?? 0;

    return {
      puuid: player.puuid,
      name: player.name,
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
 * counted game in it** (M5.12).
 *
 * On `Last week` that is the board as it stood when the week closed, which is what makes the
 * Sunday post reproducible on Monday and after a late backfill. On `This week` it is also
 * their current rating, because their last game in the running week *is* their last game — one
 * rule, no special case.
 *
 * A counted game is one the fold counted, which on a stored row is `mu_after is not null`.
 * An unrated game in the window counts nowhere here, exactly as on `/leaderboard` today.
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

  return playerIds.flatMap((playerId) => {
    const player = players.get(playerId);
    const played = byPlayer.get(playerId) ?? [];
    const first = played[0];
    const last = played[played.length - 1];
    // A scoreboard row whose player `players_public` cannot answer for is not a row we can
    // draw. The foreign key says it cannot happen.
    if (player === undefined || first === undefined || last === undefined) return [];

    const rating: Rating = { mu: last.row.muAfter as number, sigma: last.row.sigmaAfter as number };
    const wins = played.filter(({ row, game }) => row.side === game.winningSide).length;

    return [
      {
        puuid: player.puuid,
        name: player.name,
        proven: provenRating(rating),
        sortKey: provenSortKey(rating),
        rating: displayRating(rating.mu),
        games: played.length,
        wins,
        losses: played.length - wins,
        // The window line replaces line 2's meta, and product fixed its shape without a
        // streak in it: `6 games · 4W 2L · +58`.
        streak: null,
        climb: { muBefore: first.row.muBefore as number, muAfter: last.row.muAfter as number },
        // **The all-time count**, not the window's: the chip is a fact about the rating.
        settling: (ratings.get(playerId)?.games ?? played.length) < SETTLING_GAMES,
        breakdown: includeBreakdown ? playedBreakdown(played, timeZone) : [],
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

function playedBreakdown(
  played: readonly { row: PlayerGameRow; game: SeasonGame }[],
  timeZone: string,
): BoardGame[] {
  return boardBreakdown(
    played.map(({ row, game }) => ({
      gameId: game.id,
      startedAt: game.startedAt,
      durationS: game.durationS,
      won: row.side === game.winningSide,
      side: row.side,
      muBefore: row.muBefore as number,
      muAfter: row.muAfter as number,
    })),
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
    const seeded = seedFromRank(player.rankTier, player.rankDivision);
    return {
      puuid: player.puuid,
      name: player.name,
      window,
      range: null,
      rating: displayRating(seeded.mu),
      proven: provenRating(seeded),
      games: 0,
      wins: 0,
      losses: 0,
      settling: true,
      // Nothing has been folded, so the seed is what their rank says today — and it is what
      // the first fold will store.
      seedRank: rankLabel(player.rankTier, player.rankDivision),
      reference: displayRating(seeded.mu),
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
  const current = stored?.rating ?? seedFromRank(player.rankTier, player.rankDivision);
  const allTimeGames = stored?.games ?? 0;

  /**
   * **Where this page's history starts** (M5.7): the seed stored on the `ratings` row, and the
   * player's current rank only when there is none — the same preference both folds apply, read
   * from the same helper, so the line above the chart cannot name a number the fold did not
   * use. A friend who was Gold when they started and is Platinum now reads
   * `Seeded from Gold IV`, because that is the rank their history was built on; their rank
   * today is on the client, not on this line.
   *
   * `seedRank` is those same two strings as words (M5.15), formatted from whichever pair the
   * seed came from, so the sentence and the number can never disagree.
   */
  const seed = seedFor(stored?.seed ?? null, player.rankTier, player.rankDivision);
  const seedRating = displayRating(seed.rating.mu);
  const seedRank = rankLabel(seed.rankTier, seed.rankDivision);

  const recent = await loadRecentGames(
    client,
    recentGames(
      all.map(({ row, game }) => ({ row, game, startedAt: game.startedAt, muAfter: row.muAfter })),
      RECENT_GAMES,
    ),
  );

  /**
   * **The two numbers, and where they come from** (M5.12).
   *
   * On `All time` they are the `ratings` row — the fold's own totals, byte-identical to what
   * M3.5 shipped and to the row on `/leaderboard`. In a window they are this player as of
   * their last counted game inside it, from that game's `mu_after` / `sigma_after`, and the
   * record counts the window's games.
   *
   * With no counted game in the window they fall back to the current rating: the page is a
   * person, not a board row, and printing nothing where a number goes would say something the
   * empty line under it already says better.
   */
  const last = played[played.length - 1];
  const first = played[0];
  const windowed = window !== 'all-time' && last !== undefined;
  const rating: Rating = windowed
    ? { mu: last.row.muAfter as number, sigma: last.row.sigmaAfter as number }
    : current;
  const windowWins = played.filter(({ row, game }) => row.side === game.winningSide).length;
  const counted = window === 'all-time' ? allTimeGames : played.length;
  const wins = window === 'all-time' ? (stored?.wins ?? 0) : windowWins;

  return {
    puuid: player.puuid,
    name: player.name,
    window,
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
    // The 30-game rule reads the whole history in every window (M3.8).
    settling: allTimeGames < SETTLING_GAMES,
    seedRank,
    /**
     * The chart's hairline: the seed on `All time`, and in a window the rating carried
     * **into** it — the `mu_before` of the first counted game in it, which is where the week
     * found them. That is not a seed and does not borrow the word (`start`, M5.12).
     */
    reference:
      window === 'all-time' || first === undefined ? seedRating : displayRating(first.row.muBefore as number),
    history: historySeries(played),
    recent,
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
  const rows = await loadGameRows(client, gameIds);
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
    const team: RecentTeammate[] = rows
      .filter((other) => other.gameId === game.id && other.side === row.side)
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
      // Blue's chance, as it was stored. The page turns it into this player's own side's.
      blueWinProb: game.lobbyId === null ? null : (odds.get(game.lobbyId) ?? null),
      team: inLaneOrder(team),
    };
  });
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
    .select('id, started_at, duration_s, winning_side, lobby_id')
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
}

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

/** `game_players` for a set of games, in chunks, so no response is silently truncated. */
async function loadGameRows(client: PublicClient, gameIds: readonly string[]): Promise<PlayerGameRow[]> {
  const rows: PlayerGameRow[] = [];
  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client
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
  };
}
