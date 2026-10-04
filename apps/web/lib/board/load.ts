import { displayKustom, isSettling, KUSTOM_START, type KustomBefore } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import {
  type BreakdownGame,
  type BreakdownTrack,
  type OddsModel,
  resultOdds,
  rowReason,
} from '../breakdown/read';
import { inChunks, mapChunks } from '../chunks';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { type FoldAwardPlayer, type FoldPerformance, gatedGameAward } from '../ingest/fold';
import { inLaneOrder } from '../laneOrder';
import { loadRosterLabels, withLabel } from '../names/roster';
import { formatDayMonth, type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import { displayDelta } from '../ratingDisplay';
import { loadAwardWinners } from '../stats/load';
import { type AwardWinners, NO_AWARD_WINNERS } from '../stats/winners';
import type { PlayerName } from '../tonight/types';
import { compareBoardRows, sortBoardRows } from './order';
import { recentGames } from './recent';
import type {
  BoardRow,
  BoardView,
  EmptyWindowFallback,
  PlayerBoardView,
  RecentAward,
  RecentGame,
  RecentTeammate,
} from './types';
import { epochRange, windowRangeLabelSince } from './window';

/**
 * Everything the board (`/g/<slug>/leaderboard`) and the player page (`/g/<slug>/p/<puuid>`) show,
 * read with the **anon key** through RLS (M3.5), **one group at a time** (M13.10, M14.15).
 *
 * Rules the rest of the file exists to keep:
 *
 * - **One group.** Every read of `games`, `game_players` (through its game) and `ratings` is
 *   filtered on the group the page belongs to. A person's page in group A shows their A rating, A
 *   games and A records and says nothing about B; a PUUID with nothing in the group is `null` (the
 *   page's 404) even if it has games elsewhere.
 * - **One public number, `Rating`** (STRATEGY §5): `displayKustom(ratings.r)` from core, the
 *   all-time Kustom track, on every window (M18.6). A week board ranks by **week points**,
 *   `round(weekly R) − 1200`, the weekly R being the player's last `week_r_after` in the week; the
 *   week's per-game weekly changes add up to it exactly. No OpenSkill column is read here.
 * - **Settling is core's rule** (`isSettling` over the group's `ratings.games`), always the
 *   all-time count, never on a week.
 * - **One rule for a rating with no row**: `KUSTOM_START`, 1200 (M18.2: the same number the
 *   balancer reads).
 * - **One history per group** (M14.14): every read is the group's whole history.
 *
 * **The seam this file still has, on purpose.** Every number on a row is counted off *rated* rows
 * (`ratings` for `All time`, `r_after is not null` for its games, `week_r_after is not null` for a
 * week). A backfilled game the rebuild has not folded yet counts nowhere here until
 * `rebuild-ratings` runs.
 */

/** How many of a player's newest games their page lists; the rest are on the games page. */
export const RECENT_GAMES = 10;

/** Every game of a group, for the history chart. Larger than any history the group will play. */
const GROUP_GAME_LIMIT = 1_000;

interface GroupGame {
  id: string;
  startedAt: string;
  /** The rebuild's second sort key after `started_at`. */
  lcuGameId: number;
  durationS: number;
  winningSide: SideValue;
  /** The lobby this game was born in, the only way to its chosen split; `null` for a backfill. */
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
  /** `ratings.r`, unrounded; 1200 on a row the Kustom fold has not written yet (before the switch rebuild). */
  r: number;
  games: number;
  wins: number;
}

/** What a page asks the loader for. */
export interface BoardOptions {
  window: WindowKind;
  /**
   * The group whose games and ratings these are (M13.4, required since M14.15). Nothing on a board
   * or a player page reads across groups.
   */
  groupId: string;
  /** Injected in tests; `new Date()` otherwise. */
  now?: Date;
  timeZone?: string;
  /**
   * Badge the rows of a **closed** window with the awards it handed out (M8.3). Off by default and
   * off for the tonight rail; on the three windows that hand nothing out it reads nothing.
   */
  includeAwards?: boolean;
}

/**
 * The board, read through one window (M3.5, windowed by M5.12, one Rating and the settling section
 * since M14.15, net points on a week since M14.57).
 *
 * Membership:
 *
 * - **`All time`**: everybody with at least one rated game in the group (`ratings.games > 0`).
 * - **A window**: everybody with at least one counted game inside it.
 *
 * Everybody else the group knows (its members, and anybody with a rating row in it) is counted in
 * `notPlayed`, which the page prints under the board.
 */
export async function loadBoard(client: PublicClient, options: BoardOptions): Promise<BoardView> {
  const { window, groupId } = options;
  const ownRange = windowRange(window, options.now ?? new Date(), options.timeZone);
  // One round of independent reads (app-perf, 2026-10-04): the epoch, the members, the ratings, the
  // closed window's awards and the roster labels start together; only the window's own reads wait
  // for the epoch. Every promise ends up inside the one `Promise.all` below, so a failed read is
  // the board's failure, never an unhandled rejection.
  const sinceRead = loadRatingsSince(client, groupId);
  const ratingsRead = loadRatings(client, groupId);
  const windowRead = sinceRead.then(async (since) => {
    // Games before the group's latest reset count on no all-time window (M14.18).
    const range = epochRange(window, ownRange, since);
    const [header, keyed] = await Promise.all([
      loadWindowFacts(client, window, range, groupId, since).then(async (facts) => ({
        facts,
        fallback:
          facts.games === 0 && facts.everRated && window !== 'all-time'
            ? await emptyWindowFallback(client, window, groupId, options)
            : null,
      })),
      window === 'all-time'
        ? ratingsRead.then((ratings) => allTimeRows(client, ratings))
        : windowRows(client, range, ratingsRead, options),
    ]);
    return { ...header, keyed };
  });
  const [since, { facts, fallback, keyed }, members, ratings, winners, names] = await Promise.all([
    sinceRead,
    windowRead,
    loadMemberIds(client, groupId),
    ratingsRead,
    window === 'all-time' ? Promise.resolve(NO_AWARD_WINNERS) : rowAwards(client, options),
    // Two people with the same name are told apart, over the whole roster (M14.69).
    loadRosterLabels(client, groupId),
  ]);
  const slot = {
    // M14.70 (design review): an empty week still prints its dates; only an empty All time has none.
    range:
      facts.games === 0 && window === 'all-time'
        ? null
        : windowRangeLabelSince(window, ownRange, facts.firstCountedAt, since, options.timeZone),
    resetDay: since === null ? null : formatDayMonth(since, options.timeZone),
    games: facts.games,
    everRated: facts.everRated,
    fallback,
  };
  const rows = keyed.map(([, row]) => withLabel(row, names));

  return {
    window,
    ...slot,
    rows: sortBoardRows(withAwards(rows, winners)),
    notPlayed: countNotPlayed(
      keyed.map(([playerId]) => playerId),
      members,
      ratings,
    ),
  };
}

/**
 * Where an empty week points (M14.70): an empty `This week` to `Last week` when that has a counted
 * game, else to `All time`; an empty `Last week` to `All time`. Called only for an empty week of a
 * group that has played, so it costs one count at most.
 */
async function emptyWindowFallback(
  client: PublicClient,
  window: Exclude<WindowKind, 'all-time'>,
  groupId: string,
  options: { now?: Date; timeZone?: string },
): Promise<EmptyWindowFallback> {
  if (window !== 'this-week') return 'all-time';
  const lastWeek = windowRange('last-week', options.now ?? new Date(), options.timeZone);
  return (await countCountedGames(client, lastWeek, groupId, 'week')) > 0 ? 'last-week' : 'all-time';
}

/** A row and the `players.id` it is for (never sent to the page; the page keys on puuid). */
type KeyedRow = readonly [playerId: string, row: BoardRow];

/** Everybody with a rated game in the group, from the group's `ratings` rows. */
async function allTimeRows(
  client: PublicClient,
  ratings: ReadonlyMap<string, RatingRow>,
): Promise<KeyedRow[]> {
  const rated = [...ratings].filter(([, row]) => row.games > 0);
  const players = await loadPlayersByIds(
    client,
    rated.map(([playerId]) => playerId),
  );

  return rated.flatMap(([playerId, stored]) => {
    const player = players.get(playerId);
    if (player === undefined) return [];
    return [
      [
        playerId,
        {
          puuid: player.puuid,
          name: player.name,
          track: 'all-time' as const,
          points: null,
          sortKey: stored.r,
          rating: displayKustom(stored.r),
          games: stored.games,
          wins: stored.wins,
          losses: stored.games - stored.wins,
          ratedGames: stored.games,
          // All time's change is the whole history: from the 1200 every Rating starts at to today.
          climb: { rBefore: KUSTOM_START, rAfter: stored.r },
          settling: isSettling(stored.games),
          settlingChip: isSettling(stored.games),
          awards: [],
        },
      ] as const,
    ];
  });
}

/** The group's people (members, and anybody with a rating row in it) who are not on the board. */
function countNotPlayed(
  onBoard: readonly string[],
  members: ReadonlySet<string>,
  ratings: ReadonlyMap<string, RatingRow>,
): number {
  const shown = new Set(onBoard);
  const known = new Set<string>([...members, ...ratings.keys()]);
  let count = 0;
  for (const playerId of known) if (!shown.has(playerId)) count += 1;
  return count;
}

/**
 * The two facts the header slot is made of: how many counted games the window holds, and (on
 * `All time`) the day the first was played. A counted game is a game with a rated scoreboard row.
 */
async function loadWindowFacts(
  client: PublicClient,
  window: WindowKind,
  range: WindowRange,
  groupId: string,
  since: Date | null,
): Promise<{ games: number; firstCountedAt: Date | null; everRated: boolean }> {
  const games = await countCountedGames(client, range, groupId, window === 'all-time' ? 'all-time' : 'week');
  if (window !== 'all-time') {
    // Whether the group has a rated game on its all-time board: an empty week then says so (and
    // points somewhere, M14.70), an empty group says the board fills in after the first game. Read
    // through the reset epoch (M14.18): after a reset with nothing played since, All time is empty
    // too, so there is nowhere to point.
    const allTime = epochRange('all-time', ALL_TIME_RANGE, since);
    const ever = games > 0 || (await countCountedGames(client, allTime, groupId, 'all-time')) > 0;
    return { games, firstCountedAt: null, everRated: ever };
  }
  if (games === 0) return { games, firstCountedAt: null, everRated: false };
  return { games, firstCountedAt: await firstCountedGameAt(client, groupId), everRated: true };
}

const ALL_TIME_RANGE: WindowRange = { start: null, end: null };

/**
 * Games with a row the track folded: `r_after` on `All time`, `week_r_after` on a week (a game
 * before the reset epoch still counts on its week, M18.5).
 */
async function countCountedGames(
  client: PublicClient,
  range: WindowRange,
  groupId: string,
  track: BreakdownTrack,
): Promise<number> {
  let query =
    track === 'all-time'
      ? client
          .from('games')
          .select('id, game_players!inner(r_after)', { count: 'exact', head: true })
          .eq('group_id', groupId)
          .not('game_players.r_after', 'is', null)
      : client
          .from('games')
          .select('id, game_players!inner(week_r_after)', { count: 'exact', head: true })
          .eq('group_id', groupId)
          .not('game_players.week_r_after', 'is', null);
  query = withRange(query, 'started_at', range);

  const { count, error } = await query;
  if (error) throw new Error(`board: counting the window's games failed: ${error.message}`);
  return count ?? 0;
}

async function firstCountedGameAt(client: PublicClient, groupId: string): Promise<Date | null> {
  const { data, error } = await client
    .from('games')
    .select('started_at, game_players!inner(r_after)')
    .eq('group_id', groupId)
    .not('game_players.r_after', 'is', null)
    .order('started_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`board: first game lookup failed: ${error.message}`);

  const startedAt = data?.[0]?.started_at;
  return startedAt === undefined ? null : new Date(startedAt);
}

/**
 * One week window's rows (M18.6): the players with a game the weekly track folded inside it,
 * ranked by **week points**, `round(weekly R) − 1200` from their last `week_r_after` of the week,
 * with the window's W–L. ARAM, admin-unrated, unrated-rule games and a backfill the rebuild has not
 * folded carry no `week_r_after` and so add nothing and count in neither W nor L. Rating and the
 * settling chip are the all-time ones (`ratings`).
 */
async function windowRows(
  client: PublicClient,
  range: WindowRange,
  /** Awaited only to build the rows, so the games and their rows never wait for it. */
  ratingsRead: Promise<ReadonlyMap<string, RatingRow>>,
  options: BoardOptions,
): Promise<KeyedRow[]> {
  const games = await loadGroupGames(client, {
    limit: GROUP_GAME_LIMIT,
    range,
    groupId: options.groupId,
  });
  if (games.length === 0) return [];

  const byGame = new Map(games.map((game) => [game.id, game]));
  const rows = await loadGameRows(
    client,
    games.map((game) => game.id),
  );

  const byPlayer = new Map<string, { row: PlayerGameRow; game: GroupGame }[]>();
  for (const row of rows) {
    const game = byGame.get(row.gameId);
    if (game === undefined || row.weekRBefore === null || row.weekRAfter === null) continue;
    const played = byPlayer.get(row.playerId) ?? [];
    played.push({ row, game });
    byPlayer.set(row.playerId, played);
  }

  const playerIds = [...byPlayer.keys()];
  const [players, ratings] = await Promise.all([loadPlayersByIds(client, playerIds), ratingsRead]);

  return playerIds.flatMap((playerId) => {
    const player = players.get(playerId);
    const played = byPlayer.get(playerId) ?? [];
    if (player === undefined || played.length === 0) return [];

    const stored = ratings.get(playerId);
    const current = stored?.r ?? KUSTOM_START;
    const wins = played.filter(({ row, game }) => row.side === game.winningSide).length;
    const ratedGames = stored?.games ?? played.length;

    return [
      [
        playerId,
        {
          puuid: player.puuid,
          name: player.name,
          track: 'week' as const,
          points: weekPoints(played),
          sortKey: current,
          rating: displayKustom(current),
          games: played.length,
          wins,
          losses: played.length - wins,
          ratedGames,
          climb: null,
          // Week boards are one list (lead, 2026-10-03); the chip is still the all-time one.
          settling: false,
          settlingChip: isSettling(ratedGames),
          awards: [],
        },
      ] as const,
    ];
  });
}

/** The fold's order inside a week: `started_at`, then `lcu_game_id` (the rebuild's two keys). */
function foldOrder(a: { game: GroupGame }, b: { game: GroupGame }): number {
  return Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt) || a.game.lcuGameId - b.game.lcuGameId;
}

/**
 * Week points (M18.6): `round(weekly R) − 1200`, the weekly R being the player's last
 * `week_r_after` of the week in fold order; `0` with none (a fresh week reads 0 for everyone).
 */
function weekPoints(played: readonly { row: PlayerGameRow; game: GroupGame }[]): number {
  const last = [...played]
    .filter(({ row }) => row.weekRAfter !== null)
    .sort(foldOrder)
    .at(-1);
  if (last === undefined || last.row.weekRAfter === null) return 0;
  const points = displayKustom(last.row.weekRAfter) - KUSTOM_START;
  return points === 0 ? 0 : points;
}

/** The closed window's awards, or nothing (M8.3). A failed lookup is no badges, never a failed board. */
async function rowAwards(client: PublicClient, options: BoardOptions): Promise<AwardWinners> {
  if (options.includeAwards !== true) return NO_AWARD_WINNERS;
  try {
    return await loadAwardWinners(client, options);
  } catch (error) {
    console.error('board: reading the window awards failed', error);
    return NO_AWARD_WINNERS;
  }
}

/** The winners' titles, matched to rows by puuid. A winner not on the board adds no row. */
function withAwards(rows: BoardRow[], winners: AwardWinners): BoardRow[] {
  if (winners.size === 0) return rows;
  return rows.map((row) => {
    const won = winners.get(row.puuid);
    return won === undefined ? row : { ...row, awards: won };
  });
}

/**
 * The board's first rows, for a surface that has room for a few (the tonight rail). The same read
 * and the same order as {@link loadBoard}, sliced: ranked rows come first.
 */
export async function loadTopPlayers(
  client: PublicClient,
  options: BoardOptions & { limit: number },
): Promise<BoardRow[]> {
  const board = await loadBoard(client, options);
  return board.rows.slice(0, Math.max(0, options.limit));
}

/**
 * {@link loadTopPlayersOrNone} plus where the card points when the week is empty (M14.70): Tonight's
 * `Top this week` reads `No games this week yet.` with `See last week` or `See all time`. Nothing
 * on a failure, the same as the rows.
 */
export async function loadTopBoardOrNone(
  client: PublicClient,
  options: BoardOptions & { limit: number },
): Promise<{ rows: BoardRow[]; fallback: EmptyWindowFallback | null }> {
  try {
    const board = await loadBoard(client, options);
    return { rows: board.rows.slice(0, Math.max(0, options.limit)), fallback: board.fallback ?? null };
  } catch (error) {
    console.error('tonight: reading the rail board failed', error);
    return { rows: [], fallback: null };
  }
}

/** The same rows, for a surface where failing to read them is not a reason to fail the page. */
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
 * One player in one group: the Rating, the history, the newest games. `null` when the PUUID has
 * nothing in the group (no membership, no rating row, no game), which the page turns into a 404,
 * even if the same person plays in another group (M13.10).
 *
 * The Rating is the all-time track's on every window. A week reads the weekly track for
 * everything else (M18.6, 05-design 11.5): `points` (the number its board row prints), the
 * chart (week points from 0), each listed game's weekly change and its reason, and the
 * `Week total` that sums them.
 */
export async function loadPlayerBoard(
  client: PublicClient,
  puuid: string,
  options: BoardOptions,
): Promise<PlayerBoardView | null> {
  const { window, groupId } = options;
  const ownRange = windowRange(window, options.now ?? new Date(), options.timeZone);
  // app-perf (2026-10-04): the player, the epoch and the group's ratings start together (the one
  // ratings read serves this player's row and the all-time rank); the player's own reads follow in
  // one round. The rows carry their games (`games!inner`), so the group's whole game list is no
  // longer read just to join them.
  const ratingsRead = loadRatings(client, groupId);
  const ownRead = Promise.all([selectPlayer(client, puuid), loadRatingsSince(client, groupId)]).then(
    async ([player, since]) => {
      if (player === null) return null;
      const range = epochRange(window, ownRange, since);
      const [member, rows, everPlayed] = await Promise.all([
        isMember(client, groupId, player.id),
        loadPlayerGameRowsWithGames(client, player.id, groupId, range),
        // On All time the rows above are every game; another window needs its own look.
        window === 'all-time' ? Promise.resolve(false) : hasAnyGame(client, player.id, groupId),
      ]);
      return { player, since, member, rows, everPlayed };
    },
  );
  // The all-time board's ranked rows, for `#3`; only All time prints a rank.
  const rankedRead =
    window === 'all-time' ? ratingsRead.then((ratings) => rankedAllTimeRows(client, ratings)) : null;
  const [own, ratings] = await Promise.all([ownRead, ratingsRead]);
  if (own === null) {
    // Settle the speculative read before leaving, so its failure is never unhandled.
    await rankedRead?.catch(() => null);
    return null;
  }
  const { player, since, member, rows, everPlayed } = own;
  const stored = ratings.get(player.id);

  // Nothing in this group: not a member, no rating row, no game. The page's 404.
  if (!member && stored === undefined && rows.length === 0 && !everPlayed) {
    await rankedRead?.catch(() => null);
    return null;
  }

  const onWeek = window !== 'all-time';
  const track: BreakdownTrack = onWeek ? 'week' : 'all-time';
  const all = rows.map(({ row, game }) => ({ row, game })).sort(foldOrder);
  const played = all.filter(({ row }) => ratedOn(row, track));

  const current = stored?.r ?? KUSTOM_START;
  const allTimeGames = stored?.games ?? 0;

  const listed = recentGames(
    all.map(({ row, game }) => ({ row, game, startedAt: game.startedAt, rated: ratedOn(row, track) })),
    RECENT_GAMES,
  );
  const [recent, ranked] = await Promise.all([loadRecentGames(client, listed, track), rankedRead]);
  const rank = window === 'all-time' && !isSettling(allTimeGames) ? rankOf(ranked ?? [], player.puuid) : null;

  const first = played[0];
  const windowWins = played.filter(({ row, game }) => row.side === game.winningSide).length;
  const counted = onWeek ? played.length : allTimeGames;
  const wins = onWeek ? windowWins : (stored?.wins ?? 0);

  return {
    puuid: player.puuid,
    name: player.name,
    resetDay: since === null ? null : formatDayMonth(since, options.timeZone),
    window,
    track: onWeek ? 'week' : 'all-time',
    range:
      counted === 0
        ? null
        : windowRangeLabelSince(
            window,
            ownRange,
            first === undefined ? null : new Date(first.game.startedAt),
            since,
            options.timeZone,
          ),
    rating: displayKustom(current),
    points: onWeek ? weekPoints(played) : null,
    games: counted,
    wins,
    losses: counted - wins,
    ratedGames: allTimeGames,
    settling: window === 'all-time' && isSettling(allTimeGames),
    rank,
    reference: onWeek ? 0 : KUSTOM_START,
    history: historySeries(played, track),
    recent,
    weekTotal: onWeek ? weekTotalOf(played, listed) : null,
  };
}

/** Whether the track folded this row: `r_after` on all time, `week_r_after` on a week. */
function ratedOn(row: PlayerGameRow, track: BreakdownTrack): boolean {
  return track === 'all-time'
    ? row.rBefore !== null && row.rAfter !== null
    : row.weekRBefore !== null && row.weekRAfter !== null;
}

/**
 * The `Week total` row's number (05-design 11.5): the sum of the printed weekly changes of the
 * week's rated games when the list shows every one of them, else `null` (a paged list drops it).
 * Equal to the week points by construction: the week starts at exactly 1200 and each game's
 * `week_r_after` is the next one's `week_r_before`.
 */
function weekTotalOf(
  played: readonly { row: PlayerGameRow; game: GroupGame }[],
  listed: readonly { game: GroupGame }[],
): number | null {
  const shown = new Set(listed.map(({ game }) => game.id));
  if (!played.every(({ game }) => shown.has(game.id))) return null;
  let sum = 0;
  for (const { row } of played) {
    if (row.weekRBefore !== null && row.weekRAfter !== null)
      sum += displayDelta(row.weekRBefore, row.weekRAfter);
  }
  return sum === 0 ? 0 : sum;
}

/**
 * Their place on the `All time` board's ranked section, by the board's own comparator over the
 * group's ranked rows, so the `#3` on the self lens is the `3` on the board.
 */
async function rankedAllTimeRows(
  client: PublicClient,
  ratings: ReadonlyMap<string, RatingRow>,
): Promise<BoardRow[]> {
  return (await allTimeRows(client, ratings))
    .map(([, row]) => row)
    .filter((row) => !row.settling)
    .sort(compareBoardRows);
}

function rankOf(ranked: readonly BoardRow[], puuid: string): number | null {
  const index = ranked.findIndex((row) => row.puuid === puuid);
  return index === -1 ? null : index + 1;
}

/**
 * The chart's series (05-design 11.2): all time plots the Rating from the first game's Rating
 * before; a week plots week points from 0 (`round(week_r_after) − 1200`).
 */
function historySeries(played: readonly { row: PlayerGameRow }[], track: BreakdownTrack): number[] {
  if (played.length === 0) return [];
  if (track === 'week') {
    const series = [0];
    for (const { row } of played) {
      if (row.weekRAfter !== null) series.push(displayKustom(row.weekRAfter) - KUSTOM_START);
    }
    return series;
  }
  const first = played[0]?.row.rBefore ?? null;
  const series = first === null ? [] : [displayKustom(first)];
  for (const { row } of played) {
    if (row.rAfter !== null) series.push(displayKustom(row.rAfter));
  }
  return series;
}

/**
 * The newest games, with the player's five in lane order, the award, and what the compact receipt
 * needs: the chosen split's odds and rank, or everyone's all-time Rating going in when there is no
 * split. `track` is the page's: the reason explains that track's change.
 */
async function loadRecentGames(
  client: PublicClient,
  played: readonly { row: PlayerGameRow; game: GroupGame }[],
  track: BreakdownTrack,
): Promise<RecentGame[]> {
  if (played.length === 0) return [];

  const gameIds = played.map(({ game }) => game.id);
  const [rows, splits, modes] = await Promise.all([
    loadGameRows(client, gameIds, { withStats: true }),
    loadChosenSplits(
      client,
      played.flatMap(({ game }) => (game.lobbyId === null ? [] : [game.lobbyId])),
    ),
    loadGameModes(client, gameIds),
  ]);
  const names = await loadNamesByPlayerId(
    client,
    rows.map((row) => row.playerId),
  );

  return played.map(({ row, game }) => {
    const all = rows.filter((other) => other.gameId === game.id);
    const team: RecentTeammate[] = all
      .filter((other) => other.side === row.side)
      .flatMap((other) => {
        const player = names.get(other.playerId);
        return player === undefined ? [] : [{ puuid: player.puuid, name: player.name, role: other.role }];
      });
    const split = game.lobbyId === null ? undefined : splits.get(game.lobbyId);
    // M18.5: the pre-game odds are `winProbability` of the stored all-time Kustom Ratings going in.
    const before = (side: SideValue): KustomBefore[] =>
      all.filter((other) => other.side === side).map((other) => ({ r: other.rBefore }));

    // M14.58 / M14.59: the fold's stored breakdown, read with the same rows.
    const breakdown: BreakdownGame = {
      winningSide: game.winningSide,
      botBlueWinProb: split?.blueWinProb ?? null,
      botOddsModel: split?.oddsModel ?? null,
      rows: all.map((other) => ({
        playerId: other.playerId,
        side: other.side,
        rBefore: other.rBefore,
        rAfter: other.rAfter,
        k: other.breakdown?.k ?? null,
        foldP: other.breakdown?.foldP ?? null,
        ratedGamesBefore: other.breakdown?.ratedGamesBefore ?? null,
        shareRank: other.breakdown?.shareRank ?? null,
        award: other.breakdown?.award ?? null,
        weekRBefore: other.weekRBefore,
        weekRAfter: other.weekRAfter,
        weekK: other.breakdown?.weekK ?? null,
        weekFoldP: other.breakdown?.weekFoldP ?? null,
        weekGamesBefore: other.breakdown?.weekGamesBefore ?? null,
      })),
    };

    return {
      gameId: game.id,
      startedAt: game.startedAt,
      durationS: game.durationS,
      won: row.side === game.winningSide,
      side: row.side,
      winningSide: game.winningSide,
      role: row.role,
      rBefore: row.rBefore,
      rAfter: row.rAfter,
      weekRBefore: row.weekRBefore,
      weekRAfter: row.weekRAfter,
      award: recentAward(all, game, names, row.playerId),
      blueWinProb: split?.blueWinProb ?? null,
      pickRank: split?.rank ?? null,
      ratingsBefore: split === undefined ? { blue: before(100), red: before(200) } : null,
      aram: matchesQueue(modes.get(game.id) ?? null, 'aram'),
      team: inLaneOrder(team),
      reason: rowReason(breakdown, row.playerId, track),
      odds: resultOdds(breakdown),
    };
  });
}

/** This player's place in the game's award, by `gatedGameAward` (the one the fold applied). */
function recentAward(
  all: readonly PlayerGameRow[],
  game: GroupGame,
  names: ReadonlyMap<string, { puuid: string; name: PlayerName }>,
  playerId: string,
): RecentAward | null {
  const mine = names.get(playerId)?.puuid;
  if (mine === undefined) return null;

  const ten: FoldAwardPlayer[] = [];
  for (const row of all) {
    const puuid = names.get(row.playerId)?.puuid;
    // Rated on either track (M18.6): the fold scored the same ten for both.
    if (puuid === undefined || (row.rAfter === null && row.weekRAfter === null) || row.stats === null)
      return null;
    ten.push({ puuid, side: row.side, ...row.stats });
  }

  const award = gatedGameAward(ten, game.durationS, game.winningSide);
  if (award === null) return null;
  return award.mvp === mine ? 'mvp' : award.ace === mine ? 'ace' : null;
}

/** The chosen split of each lobby: blue's chance, the split's rank (`pick #2`) and its odds model. */
async function loadChosenSplits(
  client: PublicClient,
  lobbyIds: readonly string[],
): Promise<Map<string, { blueWinProb: number; rank: number; oddsModel: OddsModel }>> {
  const splits = new Map<string, { blueWinProb: number; rank: number; oddsModel: OddsModel }>();
  for (const { data, error } of await mapChunks(lobbyIds, (chunk) =>
    client
      .from('splits')
      .select('lobby_id, blue_win_prob, rank, odds_model')
      .in('lobby_id', chunk)
      .eq('is_chosen', true),
  )) {
    if (error) throw new Error(`board: split lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.blue_win_prob === null) continue;
      splits.set(row.lobby_id, {
        blueWinProb: row.blue_win_prob,
        rank: row.rank,
        oddsModel: row.odds_model === 'kustom' ? 'kustom' : 'openskill',
      });
    }
  }
  return splits;
}

/** `games.game_mode` (0039) for the listed games only (the ARAM label), never the blob. */
async function loadGameModes(
  client: PublicClient,
  gameIds: readonly string[],
): Promise<Map<string, string | null>> {
  const modes = new Map<string, string | null>();
  for (const { data, error } of await mapChunks(gameIds, (chunk) =>
    client.from('games').select('id, gameMode:game_mode').in('id', chunk),
  )) {
    if (error) throw new Error(`board: game mode lookup failed: ${error.message}`);
    for (const row of data ?? []) modes.set(row.id, gameModeFromRaw({ gameMode: row.gameMode }));
  }
  return modes;
}

/**
 * The group's ratings epoch (`groups_public.ratings_since`, M14.18), or null: never reset, or a
 * database before `0027` (an unknown column reads as never reset, so this merges either side).
 */
async function loadRatingsSince(client: PublicClient, groupId: string): Promise<Date | null> {
  const { data, error } = await client
    .from('groups_public')
    .select('ratings_since')
    .eq('id', groupId)
    .maybeSingle();
  if (error && (error.code === '42703' || error.code === 'PGRST204')) return null;
  if (error) throw new Error(`board: ratings epoch lookup failed: ${error.message}`);
  return data?.ratings_since ? new Date(data.ratings_since) : null;
}

/** The group's members' `players.id`s (`group_members_public`, anon-readable). */
async function loadMemberIds(client: PublicClient, groupId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('group_members_public')
    .select('player_id')
    .eq('group_id', groupId);
  if (error) throw new Error(`board: member lookup failed: ${error.message}`);
  return new Set((data ?? []).flatMap((row) => (row.player_id === null ? [] : [row.player_id])));
}

async function isMember(client: PublicClient, groupId: string, playerId: string): Promise<boolean> {
  const { data, error } = await client
    .from('group_members_public')
    .select('player_id')
    .eq('group_id', groupId)
    .eq('player_id', playerId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board: member lookup failed: ${error.message}`);
  return data !== null;
}

/** Whether the player has any scoreboard row in the group, whatever the window. */
async function hasAnyGame(client: PublicClient, playerId: string, groupId: string) {
  const { data, error } = await client
    .from('game_players')
    .select('game_id')
    .eq('player_id', playerId)
    .eq('group_id', groupId)
    .limit(1);
  if (error) throw new Error(`board: game lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
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

async function loadPlayersByIds(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerRow>> {
  const players = new Map<string, PlayerRow>();
  for (const { data, error } of await mapChunks(playerIds, (chunk) =>
    client
      .from('players_public')
      .select('id, puuid, display_name, game_name, rank_tier, rank_division')
      .in('id', chunk),
  )) {
    if (error) throw new Error(`board: player lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      players.set(row.id, toPlayer(row));
    }
  }
  return players;
}

async function loadNamesByPlayerId(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, { puuid: string; name: PlayerName }>> {
  const names = new Map<string, { puuid: string; name: PlayerName }>();
  for (const { data, error } of await mapChunks(playerIds, (chunk) =>
    client.from('players_public').select('id, puuid, display_name, game_name').in('id', chunk),
  )) {
    if (error) throw new Error(`board: name lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      names.set(row.id, { puuid: row.puuid, name: row.display_name ?? row.game_name ?? null });
    }
  }
  return names;
}

/**
 * The group's `ratings` rows, keyed by `player_id`. `playerIds` absent is
 * everybody in the group; `[]` is nobody.
 */
async function loadRatings(
  client: PublicClient,
  groupId: string,
  playerIds?: readonly string[],
): Promise<Map<string, RatingRow>> {
  const ratings = new Map<string, RatingRow>();
  const batches = playerIds === undefined ? [null] : inChunks(playerIds);

  for (const chunk of batches) {
    let query = client.from('ratings').select('player_id, r, games, wins').eq('group_id', groupId);
    if (chunk !== null) query = query.in('player_id', chunk);

    const { data, error } = await query;
    if (error) throw new Error(`board: rating lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      // `r` null: a row the Kustom fold has not written yet (an OpenSkill-era row before the switch
      // rebuild, M18.10). It reads as 1200, the number the balancer reads for it too (M18.2).
      ratings.set(row.player_id, { r: row.r ?? KUSTOM_START, games: row.games, wins: row.wins });
    }
  }
  return ratings;
}

async function loadGroupGames(
  client: PublicClient,
  options: { limit: number; range?: WindowRange; groupId: string },
): Promise<GroupGame[]> {
  let query = client
    .from('games')
    .select('id, lcu_game_id, started_at, duration_s, winning_side, lobby_id')
    .eq('group_id', options.groupId);
  // The window is a filter in the query, not in memory (M5.12).
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
  /** All-time Kustom Ratings around the game (0036), unrounded. */
  rBefore: number | null;
  rAfter: number | null;
  /** Weekly Kustom Ratings around the game (0036), unrounded. */
  weekRBefore: number | null;
  weekRAfter: number | null;
  stats: FoldPerformance | null;
  /** The fold's stored parts (`0034`, `0036`), on the wide read only (`null` on the narrow one). */
  breakdown: {
    k: number | null;
    foldP: number | null;
    ratedGamesBefore: number | null;
    shareRank: number | null;
    award: string | null;
    weekK: number | null;
    weekFoldP: number | null;
    weekGamesBefore: number | null;
  } | null;
}

const STAT_COLUMNS =
  'kills, deaths, assists, damage_to_champs, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives' as const;

/**
 * One player's scoreboard rows in the group, newest first, inside the window, each with its game
 * (one read: the game's facts ride on the row through `games!inner`). A game with no winner is
 * dropped, as the group's game list dropped it.
 */
async function loadPlayerGameRowsWithGames(
  client: PublicClient,
  playerId: string,
  groupId: string,
  range?: WindowRange,
): Promise<{ row: PlayerGameRow; game: GroupGame }[]> {
  let query = client
    .from('game_players')
    .select(
      'game_id, player_id, side, role, r_before, r_after, week_r_before, week_r_after, games!inner(started_at, group_id, lcu_game_id, duration_s, winning_side, lobby_id)',
    )
    .eq('player_id', playerId)
    .eq('games.group_id', groupId);
  query = withRange(query, 'games.started_at', range);

  const { data, error } = await query
    .order('games(started_at)', { ascending: false })
    .limit(GROUP_GAME_LIMIT);
  if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
  return (data ?? []).flatMap((raw) => {
    const game = Array.isArray(raw.games) ? raw.games[0] : raw.games;
    if (game == null || (game.winning_side !== 100 && game.winning_side !== 200)) return [];
    return [
      {
        row: toGameRow(raw),
        game: {
          id: raw.game_id,
          lcuGameId: game.lcu_game_id,
          startedAt: game.started_at,
          durationS: game.duration_s,
          winningSide: game.winning_side as SideValue,
          lobbyId: game.lobby_id,
        },
      },
    ];
  });
}

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

async function loadGameRows(
  client: PublicClient,
  gameIds: readonly string[],
  options: { withStats?: boolean } = {},
): Promise<PlayerGameRow[]> {
  const pages = await mapChunks(gameIds, async (chunk) => {
    // Two spelled-out selects: a literal column list is checked against the generated types.
    const { data, error } =
      options.withStats === true
        ? await client
            .from('game_players')
            .select(
              `game_id, player_id, side, role, r_before, r_after, week_r_before, week_r_after, ${STAT_COLUMNS}, k, fold_p, rated_games_before, share_rank, award, week_k, week_fold_p, week_games_before`,
            )
            .in('game_id', chunk)
        : await client
            .from('game_players')
            .select('game_id, player_id, side, role, r_before, r_after, week_r_before, week_r_after')
            .in('game_id', chunk);
    if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
    return (data ?? []).map(toGameRow);
  });
  return pages.flat();
}

interface RawGamePlayerRow {
  game_id: string;
  player_id: string;
  side: number;
  role: RoleValue | null;
  r_before: number | null;
  r_after: number | null;
  week_r_before: number | null;
  week_r_after: number | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  damage_to_champs?: number | null;
  gold?: number | null;
  cs?: number | null;
  vision_score?: number | null;
  damage_self_mitigated?: number | null;
  damage_to_objectives?: number | null;
  k?: number | null;
  fold_p?: number | null;
  rated_games_before?: number | null;
  share_rank?: number | null;
  award?: string | null;
  week_k?: number | null;
  week_fold_p?: number | null;
  week_games_before?: number | null;
}

function toGameRow(row: RawGamePlayerRow): PlayerGameRow {
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    role: row.role,
    rBefore: row.r_before,
    rAfter: row.r_after,
    weekRBefore: row.week_r_before,
    weekRAfter: row.week_r_after,
    stats: 'kills' in row ? toStats(row) : null,
    breakdown:
      'fold_p' in row
        ? {
            k: row.k ?? null,
            foldP: row.fold_p ?? null,
            ratedGamesBefore: row.rated_games_before ?? null,
            shareRank: row.share_rank ?? null,
            award: row.award ?? null,
            weekK: row.week_k ?? null,
            weekFoldP: row.week_fold_p ?? null,
            weekGamesBefore: row.week_games_before ?? null,
          }
        : null,
  };
}

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
