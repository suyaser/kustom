import { displayRating, isSettling, type KustomBefore, provisionalSeed, type Rating } from '@customs/core';
import { openSkillPair, type RoleValue, type SideValue } from '@customs/db';
import { type BreakdownGame, resultOdds, rowReason } from '../breakdown/read';
import { inChunks } from '../chunks';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { type FoldAwardPlayer, type FoldPerformance, gatedGameAward } from '../ingest/fold';
import { readSeed, type StoredSeed, seedFor } from '../ingest/seed';
import { inLaneOrder } from '../laneOrder';
import { loadRosterLabels, withLabel } from '../names/roster';
import { formatDayMonth, type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import { sumDisplayDeltas } from '../ratingDisplay';
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
 * - **One public number, `Rating`** (STRATEGY §5): `displayRating(mu)` from core, the all-time
 *   track, on every window. Proven is gone. A week board ranks by **net points**, the sum of the
 *   printed all-time deltas in the window (M14.57); there is no weekly track any more.
 * - **Settling is core's rule** (`isSettling` over the group's `ratings.games`), always the
 *   all-time count, never on a week.
 * - **One rule for a rating with no row**: `provisionalSeed()`, 1200 displayed (2026-09-16).
 * - **One history per group** (M14.14): every read is the group's whole history.
 *
 * **The seam this file still has, on purpose.** Every number on a row is counted off *rated* rows
 * (`ratings` for `All time`, `mu_after is not null` for a window). A backfilled game the rebuild has
 * not folded yet counts nowhere here until `rebuild-ratings` runs.
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
  rating: Rating;
  games: number;
  wins: number;
  /** The seed this player's history was folded from (M5.7), or null on a row before `0012`. */
  seed: StoredSeed | null;
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
  const since = await loadRatingsSince(client, groupId);
  const ownRange = windowRange(window, options.now ?? new Date(), options.timeZone);
  // Games before the group's latest reset count on no all-time window (M14.18).
  const range = epochRange(window, ownRange, since);
  const [facts, members, ratings] = await Promise.all([
    loadWindowFacts(client, window, range, groupId, since),
    loadMemberIds(client, groupId),
    loadRatings(client, groupId),
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
    fallback:
      facts.games === 0 && facts.everRated && window !== 'all-time'
        ? await emptyWindowFallback(client, window, groupId, options)
        : null,
  };

  const keyed =
    window === 'all-time'
      ? await allTimeRows(client, ratings)
      : await windowRows(client, range, ratings, options);
  const [winners, names] = await Promise.all([
    window === 'all-time' ? Promise.resolve(NO_AWARD_WINNERS) : rowAwards(client, options),
    // Two people with the same name are told apart, over the whole roster (M14.69).
    loadRosterLabels(client, groupId),
  ]);
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
  return (await countCountedGames(client, lastWeek, groupId)) > 0 ? 'last-week' : 'all-time';
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
    const seed = seedFor(stored.seed, player.rankTier, player.rankDivision).rating;
    return [
      [
        playerId,
        {
          puuid: player.puuid,
          name: player.name,
          track: 'all-time' as const,
          points: null,
          sortKey: stored.rating.mu,
          rating: displayRating(stored.rating.mu),
          games: stored.games,
          wins: stored.wins,
          losses: stored.games - stored.wins,
          ratedGames: stored.games,
          // All time's change is the whole history: from the seed it started at to today.
          climb: { muBefore: seed.mu, muAfter: stored.rating.mu },
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
  const games = await countCountedGames(client, range, groupId);
  if (window !== 'all-time') {
    // Whether the group has a rated game on its all-time board: an empty week then says so (and
    // points somewhere, M14.70), an empty group says the board fills in after the first game. Read
    // through the reset epoch (M14.18): after a reset with nothing played since, All time is empty
    // too, so there is nowhere to point.
    const allTime = epochRange('all-time', ALL_TIME_RANGE, since);
    const ever = games > 0 || (await countCountedGames(client, allTime, groupId)) > 0;
    return { games, firstCountedAt: null, everRated: ever };
  }
  if (games === 0) return { games, firstCountedAt: null, everRated: false };
  return { games, firstCountedAt: await firstCountedGameAt(client, groupId), everRated: true };
}

const ALL_TIME_RANGE: WindowRange = { start: null, end: null };

async function countCountedGames(client: PublicClient, range: WindowRange, groupId: string): Promise<number> {
  let query = client
    .from('games')
    .select('id, game_players!inner(mu_after)', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .not('game_players.mu_after', 'is', null);
  query = withRange(query, 'started_at', range);

  const { count, error } = await query;
  if (error) throw new Error(`board: counting the window's games failed: ${error.message}`);
  return count ?? 0;
}

async function firstCountedGameAt(client: PublicClient, groupId: string): Promise<Date | null> {
  const { data, error } = await client
    .from('games')
    .select('started_at, game_players!inner(mu_after)')
    .eq('group_id', groupId)
    .not('game_players.mu_after', 'is', null)
    .order('started_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`board: first game lookup failed: ${error.message}`);

  const startedAt = data?.[0]?.started_at;
  return startedAt === undefined ? null : new Date(startedAt);
}

/**
 * One week window's rows (M14.57): the players with a rated game inside it, ranked by **net
 * points**, the sum of the printed all-time deltas of those games (`sumDisplayDeltas`, the one
 * rounding rule for a sum), with the window's W–L. ARAM, admin-unrated, unrated-rule games and a
 * backfill the rebuild has not folded carry no `mu_after` and so add nothing and count in neither
 * W nor L. Rating and the settling chip are the all-time ones (`ratings`).
 */
async function windowRows(
  client: PublicClient,
  range: WindowRange,
  ratings: ReadonlyMap<string, RatingRow>,
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
    if (game === undefined || row.muBefore === null || row.muAfter === null) continue;
    const played = byPlayer.get(row.playerId) ?? [];
    played.push({ row, game });
    byPlayer.set(row.playerId, played);
  }

  const playerIds = [...byPlayer.keys()];
  const players = await loadPlayersByIds(client, playerIds);

  return playerIds.flatMap((playerId) => {
    const player = players.get(playerId);
    const played = byPlayer.get(playerId) ?? [];
    if (player === undefined || played.length === 0) return [];

    const stored = ratings.get(playerId);
    const current = stored?.rating ?? provisionalSeed();
    const wins = played.filter(({ row, game }) => row.side === game.winningSide).length;
    const ratedGames = stored?.games ?? played.length;

    return [
      [
        playerId,
        {
          puuid: player.puuid,
          name: player.name,
          track: 'week' as const,
          points: netPoints(played) ?? 0,
          sortKey: current.mu,
          rating: displayRating(current.mu),
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

/** The sum of the printed deltas of a player's rated rows (M14.57), or `null` for none. */
function netPoints(played: readonly { row: PlayerGameRow }[]): number | null {
  return sumDisplayDeltas(
    played.flatMap(({ row }) =>
      row.muBefore === null || row.muAfter === null ? [] : [{ muBefore: row.muBefore, muAfter: row.muAfter }],
    ),
  );
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
 * Every rating number is the all-time track's on every window (M14.57): the same game prints the
 * same delta on All time, This week and Last week. A week adds `points`, the net its board row
 * prints, from the same `sumDisplayDeltas`.
 */
export async function loadPlayerBoard(
  client: PublicClient,
  puuid: string,
  options: BoardOptions,
): Promise<PlayerBoardView | null> {
  const player = await selectPlayer(client, puuid);
  if (player === null) return null;

  const { window, groupId } = options;
  const since = await loadRatingsSince(client, groupId);
  const ownRange = windowRange(window, options.now ?? new Date(), options.timeZone);
  const range = epochRange(window, ownRange, since);
  const [member, ratings, games, rows, everPlayed] = await Promise.all([
    isMember(client, groupId, player.id),
    loadRatings(client, groupId, [player.id]),
    loadGroupGames(client, { limit: GROUP_GAME_LIMIT, range, groupId }),
    loadPlayerGameRows(client, player.id, groupId, range),
    // On All time the rows above are every game; another window needs its own look.
    window === 'all-time' ? Promise.resolve(false) : hasAnyGame(client, player.id, groupId),
  ]);
  const stored = ratings.get(player.id);

  // Nothing in this group: not a member, no rating row, no game. The page's 404.
  if (!member && stored === undefined && rows.length === 0 && !everPlayed) return null;

  const byGame = new Map(games.map((game) => [game.id, game]));
  const all = rows
    .filter((row) => byGame.has(row.gameId))
    .map((row) => ({ row, game: byGame.get(row.gameId) as GroupGame }))
    .sort((a, b) => Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt));
  const played = all.filter(({ row }) => row.muAfter !== null);

  const current = stored?.rating ?? provisionalSeed();
  const allTimeGames = stored?.games ?? 0;
  const seed = seedFor(stored?.seed ?? null, player.rankTier, player.rankDivision);
  const seedRating = displayRating(seed.rating.mu);

  const [recent, rank] = await Promise.all([
    loadRecentGames(
      client,
      recentGames(
        all.map(({ row, game }) => ({ row, game, startedAt: game.startedAt, muAfter: row.muAfter })),
        RECENT_GAMES,
      ),
    ),
    window === 'all-time' && !isSettling(allTimeGames)
      ? loadAllTimeRank(client, groupId, player.puuid)
      : Promise.resolve(null),
  ]);

  const onWeek = window !== 'all-time';
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
    rating: displayRating(current.mu),
    points: onWeek ? (netPoints(played) ?? 0) : null,
    games: counted,
    wins,
    losses: counted - wins,
    ratedGames: allTimeGames,
    settling: window === 'all-time' && isSettling(allTimeGames),
    rank,
    reference: !onWeek || first?.row.muBefore == null ? seedRating : displayRating(first.row.muBefore),
    history: historySeries(played),
    recent,
  };
}

/**
 * Their place on the `All time` board's ranked section, by the board's own comparator over the
 * group's ranked rows, so the `#3` on the self lens is the `3` on the board.
 */
async function loadAllTimeRank(client: PublicClient, groupId: string, puuid: string): Promise<number | null> {
  const ratings = await loadRatings(client, groupId);
  const rows = (await allTimeRows(client, ratings))
    .map(([, row]) => row)
    .filter((row) => !row.settling)
    .sort(compareBoardRows);
  const index = rows.findIndex((row) => row.puuid === puuid);
  return index === -1 ? null : index + 1;
}

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
 * The newest games, with the player's five in lane order, the award, and what the compact receipt
 * needs: the chosen split's odds and rank, or everyone's rating going in when there is no split.
 */
async function loadRecentGames(
  client: PublicClient,
  played: readonly { row: PlayerGameRow; game: GroupGame }[],
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
      rows: all.map((other) => ({
        playerId: other.playerId,
        side: other.side,
        muBefore: other.muBefore,
        sigmaBefore: other.sigmaBefore,
        muAfter: other.muAfter,
        foldP: other.breakdown?.foldP ?? null,
        baseMuAfter: other.breakdown?.baseMuAfter ?? null,
        award: other.breakdown?.award ?? null,
        ratedGamesBefore: other.breakdown?.ratedGamesBefore ?? null,
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
      muBefore: row.muBefore,
      muAfter: row.muAfter,
      award: recentAward(all, game, names, row.playerId),
      blueWinProb: split?.blueWinProb ?? null,
      pickRank: split?.rank ?? null,
      ratingsBefore: split === undefined ? { blue: before(100), red: before(200) } : null,
      aram: matchesQueue(modes.get(game.id) ?? null, 'aram'),
      team: inLaneOrder(team),
      reason: rowReason(breakdown, row.playerId),
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
    if (puuid === undefined || row.muAfter === null || row.stats === null) return null;
    ten.push({ puuid, side: row.side, ...row.stats });
  }

  const award = gatedGameAward(ten, game.durationS, game.winningSide);
  if (award === null) return null;
  return award.mvp === mine ? 'mvp' : award.ace === mine ? 'ace' : null;
}

/** The chosen split of each lobby: blue's chance and the split's rank (`pick #2`). */
async function loadChosenSplits(
  client: PublicClient,
  lobbyIds: readonly string[],
): Promise<Map<string, { blueWinProb: number; rank: number }>> {
  const splits = new Map<string, { blueWinProb: number; rank: number }>();
  for (const chunk of inChunks(lobbyIds)) {
    const { data, error } = await client
      .from('splits')
      .select('lobby_id, blue_win_prob, rank')
      .in('lobby_id', chunk)
      .eq('is_chosen', true);
    if (error) throw new Error(`board: split lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.blue_win_prob === null) continue;
      splits.set(row.lobby_id, { blueWinProb: row.blue_win_prob, rank: row.rank });
    }
  }
  return splits;
}

/** `raw->gameMode` for the listed games only (the ARAM label), never the whole blob. */
async function loadGameModes(
  client: PublicClient,
  gameIds: readonly string[],
): Promise<Map<string, string | null>> {
  const modes = new Map<string, string | null>();
  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client.from('games').select('id, raw->gameMode').in('id', chunk);
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
    let query = client
      .from('ratings')
      .select('player_id, mu, sigma, games, wins, seed_mu, seed_sigma, seed_rank_tier, seed_rank_division')
      .eq('group_id', groupId);
    if (chunk !== null) query = query.in('player_id', chunk);

    const { data, error } = await query;
    if (error) throw new Error(`board: rating lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      // A Kustom-only row (0036) has no OpenSkill pair: to this build it is not rated yet.
      const rating = openSkillPair(row);
      if (rating === null) continue;
      ratings.set(row.player_id, {
        rating,
        games: row.games,
        wins: row.wins,
        seed: readSeed(row),
      });
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
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
  /** The all-time Kustom Rating going in (0036; M18.5 reads it for the pre-game odds only, M18.6 the rest). */
  rBefore: number | null;
  stats: FoldPerformance | null;
  /** The fold's `0034` breakdown, on the wide read only (`null` on the narrow one). */
  breakdown: {
    foldP: number | null;
    baseMuAfter: number | null;
    award: string | null;
    ratedGamesBefore: number | null;
  } | null;
}

const STAT_COLUMNS =
  'kills, deaths, assists, damage_to_champs, gold, cs, vision_score, damage_self_mitigated, damage_to_objectives' as const;

/** One player's scoreboard rows in the group, newest first, inside the window. */
async function loadPlayerGameRows(
  client: PublicClient,
  playerId: string,
  groupId: string,
  range?: WindowRange,
): Promise<PlayerGameRow[]> {
  let query = client
    .from('game_players')
    .select(
      'game_id, player_id, side, role, mu_before, sigma_before, mu_after, sigma_after, games!inner(started_at, group_id)',
    )
    .eq('player_id', playerId)
    .eq('games.group_id', groupId);
  query = withRange(query, 'games.started_at', range);

  const { data, error } = await query
    .order('games(started_at)', { ascending: false })
    .limit(GROUP_GAME_LIMIT);
  if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
  return (data ?? []).map(toGameRow);
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
  const rows: PlayerGameRow[] = [];
  for (const chunk of inChunks(gameIds)) {
    // Two spelled-out selects: a literal column list is checked against the generated types.
    const { data, error } =
      options.withStats === true
        ? await client
            .from('game_players')
            .select(
              `game_id, player_id, side, role, mu_before, sigma_before, mu_after, sigma_after, r_before, ${STAT_COLUMNS}, fold_p, base_mu_after, award, rated_games_before`,
            )
            .in('game_id', chunk)
        : await client
            .from('game_players')
            .select(
              'game_id, player_id, side, role, mu_before, sigma_before, mu_after, sigma_after, r_before',
            )
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
  sigma_before?: number | null;
  mu_after: number | null;
  sigma_after?: number | null;
  r_before?: number | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  damage_to_champs?: number | null;
  gold?: number | null;
  cs?: number | null;
  vision_score?: number | null;
  damage_self_mitigated?: number | null;
  damage_to_objectives?: number | null;
  fold_p?: number | null;
  base_mu_after?: number | null;
  award?: string | null;
  rated_games_before?: number | null;
}

function toGameRow(row: RawGamePlayerRow): PlayerGameRow {
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    role: row.role,
    muBefore: row.mu_before,
    sigmaBefore: row.sigma_before ?? null,
    muAfter: row.mu_after,
    sigmaAfter: row.sigma_after ?? null,
    rBefore: row.r_before ?? null,
    stats: 'kills' in row ? toStats(row) : null,
    breakdown:
      'fold_p' in row
        ? {
            foldP: row.fold_p ?? null,
            baseMuAfter: row.base_mu_after ?? null,
            award: row.award ?? null,
            ratedGamesBefore: row.rated_games_before ?? null,
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
