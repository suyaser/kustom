import type { RoleValue, SideValue } from '@customs/db';
import { inChunks } from '../chunks';
import { GAMES_QUEUE, gameModeFromRaw, matchesQueue, type QueueKind } from '../games/queue';
import type { GamesHistoryView } from '../games/types';
import { gamesHistoryView } from '../games/view';
import { type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import type { VersusView } from '../versus/types';
import { versusView } from '../versus/view';
import { type AwardRender, awardPeriod, awardsView, WEB_AWARD_RENDER } from './awards';
import { countedGames, playerStreaks } from './fold';
import { assembleFunFacts } from './funView';
import { playerStatsView } from './player';
import { type RawGameFacts, rawFactsFromUnknown } from './rawFacts';
import type {
  FunFactsView,
  PlayerStatsView,
  PlayerStreaks,
  StatsGame,
  StatsPlayer,
  StatsRow,
  StatsView,
} from './types';
import { type StatsInput, statsView } from './view';
import { type AwardWinners, awardWinners, NO_AWARD_WINNERS } from './winners';

/**
 * Everything `/stats` shows (M5.4), read with the **anon key** through RLS — the same client,
 * the same view and the same rules as `/leaderboard`, because it is the same kind of page: a
 * link opened on a phone, with no login.
 *
 * **One read, one fold, no stored table.** The page is computed at request time from `games`
 * and `game_players`, with a cap. No precomputed stats table and no materialised view:
 * precomputing would be a second thing that can disagree with `game_players`, and
 * `game_players` is the truth. If this page ever gets slow the fix is {@link STATS_MAX_GAMES},
 * not a cache table.
 *
 * Nothing here decides a number. The arithmetic is `fold.ts` and `awards.ts`, which are pure
 * and tested against a fixture; this file reads rows and hands them over.
 */

/**
 * How many games one render reads, most recent first.
 *
 * Twenty friends playing four games a night reach 2000 in about a year and a half; a month is
 * two to four hundred. Over the cap the page prints one line and nothing drops silently.
 */
export const STATS_MAX_GAMES = 2_000;

/**
 * PostgREST answers at most a thousand rows per request whatever the `limit` says, so the game
 * read is paged — the same shape `lib/ingest/rebuild.ts` uses. The scoreboard rows are chunked
 * by `inChunks` instead, which is the 90-id list `lib/chunks.ts` holds for both loaders and
 * therefore 900 rows a request.
 */
const PAGE_SIZE = 1_000;

export interface StatsOptions {
  window: WindowKind;
  /** Injected in tests; `new Date()` otherwise. The boundaries are `lib/night.ts`'s (M5.9). */
  now?: Date;
  timeZone?: string;
  /** Lowered by the cap test. Production is {@link STATS_MAX_GAMES}. */
  maxGames?: number;
  /**
   * How an award line renders a name and a delta. The page's default is the web's (`−212`,
   * `05-design.md`'s truncation); the Sunday Discord post passes its own, which escapes
   * markdown and writes an ASCII minus into a message that gets copy-pasted.
   *
   * **The lines themselves are the same lines** — one renderer of an award, two glyph sets.
   */
  awardRender?: AwardRender;
  /** `/games?p=`: filter the list to this person's customs. */
  focusPuuid?: string | null | undefined;
  /** `/games` and `/fun`: which map. Absent is Summoner's Rift. */
  queue?: QueueKind | undefined;
  /** `/1v1?a=`: the left pick, a puuid. */
  leftPuuid?: string | undefined;
  /** `/1v1?b=`: the right pick, a puuid. */
  rightPuuid?: string | undefined;
  /**
   * Only this group's games (M13.3). Absent reads every game, which is what the pages still do
   * until M13.9 to M13.12 pass their group; the champ-select overlay passes it today. Filters the
   * games read and nothing else.
   */
  groupId?: string | undefined;
}

export async function loadFunFacts(client: PublicClient, options: StatsOptions): Promise<FunFactsView> {
  const queue = options.queue ?? GAMES_QUEUE;
  /**
   * **`withOdds` is `/fun`'s alone** (M8.2): `Won against the odds` is the only surface that
   * reads what the balancer posted before the game, so the one extra `splits` query happens on
   * this page and on no other. `/stats`, `/games` and `/p/[puuid]` make exactly the reads they
   * made before.
   */
  const read = await readWindow(client, options, { withGameMode: true, withOdds: true });
  const games = read.games.filter((game) => matchesQueue(game.gameMode, queue));
  return assembleFunFacts({ ...read, games }, queue);
}

export async function loadVersus(client: PublicClient, options: StatsOptions): Promise<VersusView> {
  /**
   * `withGameMode` is required so {@link versusView} can drop ARAM / KIWI. A missing mode
   * is Rift (`matchesQueue`); without the column every custom would count as a lane.
   */
  const read = await readWindow(client, options, { withGameMode: true });
  return versusView({
    ...read,
    ...(options.leftPuuid === undefined ? {} : { leftPuuid: options.leftPuuid }),
    ...(options.rightPuuid === undefined ? {} : { rightPuuid: options.rightPuuid }),
  });
}

export async function loadGamesHistory(
  client: PublicClient,
  options: StatsOptions,
): Promise<GamesHistoryView> {
  const read = await readWindow(client, options, { withGameMode: true });
  return gamesHistoryView({
    ...read,
    focusPuuid: options.focusPuuid,
    queue: options.queue ?? GAMES_QUEUE,
  });
}

export async function loadStats(client: PublicClient, options: StatsOptions): Promise<StatsView> {
  const read = await readWindow(client, options);

  /**
   * **The page itself is pure** (`view.ts`): everything from here down is arithmetic over the
   * list the read came back with, so the whole of `/stats` is a unit test with a hand-built
   * fixture and this file is a read.
   */
  return statsView({ ...read, awardRender: options.awardRender });
}

/**
 * Stats → Records (M14.17): `/stats`' fold and `/fun`'s records from **one** read. The `/stats`
 * half counts every map, as it always has; the `/fun` half is the queue's games only, as it always
 * has. The group's games only when `groupId` is given (the pages always give it).
 */
export async function loadRecordsSegment(
  client: PublicClient,
  options: StatsOptions,
): Promise<{ stats: StatsView; fun: FunFactsView }> {
  const queue = options.queue ?? GAMES_QUEUE;
  const read = await readWindow(client, options, { withGameMode: true, withOdds: true });
  return {
    stats: statsView({ ...read, awardRender: options.awardRender }),
    fun: assembleFunFacts(
      { ...read, games: read.games.filter((game) => matchesQueue(game.gameMode, queue)) },
      queue,
    ),
  };
}

/**
 * Stats → 1v1 (M14.17): lane wars and Pick two (`versusView`, Rift only), and the one duos block:
 * best and worst together from `/stats`' `duoRecords` (every map, as before) and nemesis from
 * `/fun`'s fold over the Rift games. One read.
 */
export async function loadVersusSegment(
  client: PublicClient,
  options: StatsOptions,
): Promise<{ versus: VersusView; stats: StatsView; fun: FunFactsView }> {
  const read = await readWindow(client, options, { withGameMode: true });
  const rift = read.games.filter((game) => matchesQueue(game.gameMode, 'sr'));
  return {
    versus: versusView({
      ...read,
      ...(options.leftPuuid === undefined ? {} : { leftPuuid: options.leftPuuid }),
      ...(options.rightPuuid === undefined ? {} : { rightPuuid: options.rightPuuid }),
    }),
    stats: statsView(read),
    fun: assembleFunFacts({ ...read, games: rift }, 'sr'),
  };
}

/**
 * The games and people of one window, with no page fold on top (M12).
 *
 * The overlay composes same-side and against records for the live lobby's ten; it needs the
 * raw list `headToHead` and `duoRecords` already fold, not a rendered `/stats` view.
 */
export async function loadWindowGames(
  client: PublicClient,
  options: StatsOptions,
  /** `withGameMode` for a caller that drops ARAM (M14.35's You vs them, via `versusGames`). */
  extras: { withGameMode?: boolean } = {},
): Promise<{ games: readonly StatsGame[]; players: readonly StatsPlayer[] }> {
  const read = await readWindow(client, options, extras);
  return { games: read.games, players: read.players };
}

/**
 * The same window, the same read, one player picked out of it (M5.20).
 *
 * **`/p/[puuid]` calls this and there is no second query path**: the brief's rule is that the
 * player page "calls the same loader and picks one player out of the answer", so the sections
 * under somebody's rating chart count exactly the games `/stats` counts and the two pages can
 * never print two records for one person. The picking is `player.ts`, which is pure.
 *
 * A puuid nobody's scoreboard names comes back as the empty view rather than `null`: the page
 * has already 404'd an unknown player through `loadPlayerBoard`, and a friend who did not play
 * this week is not a missing page.
 */
export async function loadPlayerStats(
  client: PublicClient,
  puuid: string,
  options: StatsOptions,
): Promise<PlayerStatsView> {
  const read = await readWindow(client, options);
  return playerStatsView({ ...read, puuid });
}

/**
 * Every player's runs through the window (M5.21), for a caller that wants the streak and none
 * of the rest of the page: `/leaderboard`'s `All time` row and the rail behind it.
 *
 * **The board's `L2` is this list.** It used to be a third read — the group's last 200 games,
 * ordered by `started_at` alone — so a player whose last game was older than the group's most
 * recent 200 had no streak on their row and a real one on their own page, and two games
 * sharing an instant could order differently in the two reads. One read, one order
 * (`started_at`, then `lcu_game_id`), one cap, one gate.
 *
 * **The universe is `gateGame`'s and not the fold's rated rows**, which is the seam this does
 * not close: the row's `13W 15L` is counted off `ratings`, and a backfilled game the rebuild
 * has not folded yet is in the streak and not in the record. That is the pre-existing
 * rated-vs-counted seam (`04-decisions.md`, 2026-09-11), and closing it is a rebuild, not a
 * read.
 */
export async function loadStreaks(client: PublicClient, options: StatsOptions): Promise<PlayerStreaks[]> {
  const read = await readWindow(client, options);
  return playerStreaks(countedGames(read.games), read.players);
}

/**
 * Who won the window's awards, by puuid (M8.3), for a caller that wants the winners and none of
 * the rest of the page: `/leaderboard`'s badges.
 *
 * **The awards are `awardsView`'s, over this loader's own read.** Same window, same gate
 * (`countedGames`), same two blocks — the ones `/stats` prints and the Sunday
 * post carries — so a badge on a row can only ever name the person the award line names. Nothing
 * about an award is decided here and no award is computed twice: the board asks this and matches
 * puuids.
 *
 * **A window that hands nothing out makes no query at all.** `This week` is still running and
 * `All time` has no block (M5.4, `awardPeriod`), so those two return the
 * empty map before the read — which is why the board they draw is the board they drew before
 * this existed, down to the byte.
 */
export async function loadAwardWinners(client: PublicClient, options: StatsOptions): Promise<AwardWinners> {
  const period = awardPeriod(options.window);
  if (period === null || !period.closed) return NO_AWARD_WINNERS;

  const read = await readWindow(client, options);
  return awardWinners(
    awardsView(
      options.window,
      countedGames(read.games),
      read.players,
      options.awardRender ?? WEB_AWARD_RENDER,
    ),
  );
}

/**
 * One window, read once: the games, their scoreboards and the people on them.
 *
 * Both surfaces above take their input from here, so "a game counts" is decided in one place
 * and the cap, the paging and the window filter cannot drift between a group page and a
 * person's.
 */
async function readWindow(
  client: PublicClient,
  options: StatsOptions,
  extras: { withGameMode?: boolean; withOdds?: boolean } = {},
): Promise<WindowRead> {
  const window = options.window;
  const cap = options.maxGames ?? STATS_MAX_GAMES;
  const range = windowRange(window, options.now ?? new Date(), options.timeZone);

  /**
   * **One extra row is the cap detector.** Reading `cap + 1` games says "there are more than the
   * cap" without a second `count` query, and the extra one is dropped before anything counts it
   * — so the page uses exactly the most recent `cap` games and says so.
   */
  const read = await loadGames(client, range, cap + 1, { ...extras, groupId: options.groupId });
  const capped = read.length > cap;
  const newest = capped ? read.slice(0, cap) : read;
  const rows = await loadGameRows(
    client,
    newest.map((game) => game.id),
  );
  const players = await loadPlayers(
    client,
    rows.map((row) => row.playerId),
  );
  const roster = new Map(players.map((player) => [player.playerId, player]));

  /**
   * The chance the balancer posted on the night, per lobby (M8.2), and only for the page that
   * prints it. A game with no `lobby_id` — every backfilled custom — asks for nothing and gets
   * nothing; the map simply has no entry and the section counts one fewer game.
   */
  const odds =
    extras.withOdds === true
      ? await loadChosenWinProbs(
          client,
          newest.map((game) => game.lobbyId).filter((id): id is string => id !== null),
        )
      : new Map<string, number>();

  const byGame = new Map<string, StatsRow[]>();
  for (const row of rows) {
    const played = byGame.get(row.gameId) ?? [];
    played.push({
      playerId: row.playerId,
      // The gate dedupes on puuid, and every id on a scoreboard has a `players_public` row;
      // the id itself is the fallback, and it is unique for the same reason a puuid is.
      puuid: roster.get(row.playerId)?.puuid ?? row.playerId,
      side: row.side,
      role: row.role,
      muBefore: row.muBefore,
      muAfter: row.muAfter,
      championId: row.championId,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      gold: row.gold,
      damageToChamps: row.damageToChamps,
      cs: row.cs,
      visionScore: row.visionScore,
      damageSelfMitigated: row.damageSelfMitigated,
      damageToObjectives: row.damageToObjectives,
    });
    byGame.set(row.gameId, played);
  }

  const games: StatsGame[] = newest.map(({ lobbyId, ...game }) => ({
    ...game,
    // Absent, not `null`, on every read that did not ask: `/stats` has no odds to be missing.
    ...(extras.withOdds === true
      ? { blueWinProb: lobbyId === null ? null : (odds.get(lobbyId) ?? null) }
      : {}),
    rows: byGame.get(game.id) ?? [],
  }));

  return { window, games, players, range, capped, cap, timeZone: options.timeZone };
}

/** What one window's read comes back with, before anything counts it. */
type WindowRead = Omit<StatsInput, 'awardRender'>;

interface GameRow {
  id: string;
  startedAt: string;
  /** A bigint in the database, and the streak order's tie-break. Carried as it is stored. */
  lcuGameId: number | null;
  durationS: number;
  winningSide: SideValue;
  /**
   * The lobby the companion opened for this custom, or `null` for a backfilled game — which is
   * most of the history. The only thing it is read for is the chosen split's posted win chance
   * (M8.2); it never reaches {@link StatsGame}.
   */
  lobbyId: string | null;
  /** Set only when `/games` or `/fun` asked for it. `/stats` never selects `raw`. */
  gameMode?: string | null;
  rawFacts?: RawGameFacts | null;
}

/**
 * The window's games, newest first, up to `limit`, paged at PostgREST's thousand.
 *
 * **The window is a filter in the query, not in memory** (M5.12): `All time` on a year of
 * history read through the cap would otherwise come back empty.
 */
async function loadGames(
  client: PublicClient,
  range: WindowRange,
  limit: number,
  extras: { withGameMode?: boolean; groupId?: string | undefined } = {},
): Promise<GameRow[]> {
  const games: GameRow[] = [];

  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit) - 1;
    const page = extras.withGameMode
      ? await loadGamePage(client, range, from, to, true, extras.groupId)
      : await loadGamePage(client, range, from, to, false, extras.groupId);
    games.push(...page);
    if (page.length < to - from + 1) break;
  }

  return games;
}

/**
 * Two literal `select` strings so PostgREST's client can type the row. A concatenated
 * column list is a `ParserError` and `/stats` must not pull `raw`.
 */
async function loadGamePage(
  client: PublicClient,
  range: WindowRange,
  from: number,
  to: number,
  withGameMode: boolean,
  groupId?: string | undefined,
): Promise<GameRow[]> {
  if (withGameMode) {
    let query = client
      .from('games')
      .select('id, started_at, duration_s, winning_side, lcu_game_id, lobby_id, raw')
      .order('started_at', { ascending: false })
      .order('lcu_game_id', { ascending: false })
      .range(from, to);
    query = withRange(query, 'started_at', range);
    if (groupId !== undefined) query = query.eq('group_id', groupId);
    const { data, error } = await query;
    if (error) throw new Error(`stats: game lookup failed: ${error.message}`);
    return toGameRows(data ?? [], true);
  }

  let query = client
    .from('games')
    .select('id, started_at, duration_s, winning_side, lcu_game_id, lobby_id')
    .order('started_at', { ascending: false })
    .order('lcu_game_id', { ascending: false })
    .range(from, to);
  query = withRange(query, 'started_at', range);
  if (groupId !== undefined) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw new Error(`stats: game lookup failed: ${error.message}`);
  return toGameRows(data ?? [], false);
}

function toGameRows(
  page: readonly {
    id: string;
    started_at: string;
    lcu_game_id: number | null;
    duration_s: number;
    winning_side: number | null;
    lobby_id: string | null;
    raw?: unknown;
  }[],
  withGameMode: boolean,
): GameRow[] {
  const games: GameRow[] = [];
  for (const row of page) {
    if (row.winning_side !== 100 && row.winning_side !== 200) continue;
    games.push({
      id: row.id,
      startedAt: row.started_at,
      lcuGameId: row.lcu_game_id,
      durationS: row.duration_s,
      winningSide: row.winning_side,
      lobbyId: row.lobby_id,
      ...(withGameMode ? { gameMode: gameModeFromRaw(row.raw), rawFacts: rawFactsFromUnknown(row.raw) } : {}),
    });
  }
  return games;
}

interface ScoreboardRow {
  gameId: string;
  playerId: string;
  side: SideValue;
  role: RoleValue | null;
  muBefore: number | null;
  muAfter: number | null;
  championId: number | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damageToChamps: number;
  cs: number;
  visionScore: number | null;
  damageSelfMitigated: number | null;
  damageToObjectives: number | null;
}

/** `game_players` for a set of games, in chunks, so no response is silently truncated. */
async function loadGameRows(client: PublicClient, gameIds: readonly string[]): Promise<ScoreboardRow[]> {
  const rows: ScoreboardRow[] = [];

  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client
      .from('game_players')
      .select(
        'game_id, player_id, side, role, mu_before, mu_after, champion_id, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives',
      )
      .in('game_id', chunk);
    if (error) throw new Error(`stats: game player lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      rows.push({
        gameId: row.game_id,
        playerId: row.player_id,
        side: row.side === 100 ? 100 : 200,
        role: row.role,
        muBefore: row.mu_before,
        muAfter: row.mu_after,
        championId: row.champion_id,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        gold: row.gold,
        damageToChamps: row.damage_to_champs,
        cs: row.cs,
        visionScore: row.vision_score,
        damageSelfMitigated: row.damage_self_mitigated,
        damageToObjectives: row.damage_to_objectives,
      });
    }
  }
  return rows;
}

/**
 * The chance the balancer gave blue, per lobby: the **chosen** split's `blue_win_prob` (M8.2).
 *
 * The same read `lib/board/load.ts` makes for the per-game expand (M5.30), spelled again here
 * rather than exported from it — the latitude {@link withRange} already
 * takes, and for the same reason: that file keeps its queries private and an export would be a seam
 * between two loaders. What must not drift is the *rule*, and the rule is one line of SQL:
 * `is_chosen`, `blue_win_prob`, and nothing derived.
 *
 * **Never a recompute.** A rebuild rewrites every `mu` in the database and does not touch
 * `splits`, which is precisely why `Won against the odds` reads this column and not a rating.
 *
 * A lobby with no chosen split — balanced then rerolled into nothing, or never balanced — simply
 * has no entry, and its games are in neither list on the page.
 */
async function loadChosenWinProbs(
  client: PublicClient,
  lobbyIds: readonly string[],
): Promise<Map<string, number>> {
  const odds = new Map<string, number>();
  if (lobbyIds.length === 0) return odds;

  for (const chunk of inChunks(lobbyIds)) {
    const { data, error } = await client
      .from('splits')
      .select('lobby_id, blue_win_prob')
      .in('lobby_id', chunk)
      .eq('is_chosen', true);
    if (error) throw new Error(`stats: split lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.blue_win_prob === null) continue;
      odds.set(row.lobby_id, row.blue_win_prob);
    }
  }
  return odds;
}

/**
 * The people on those scoreboards, from `players_public` — `players` minus `discord_id`, and
 * the only players relation anon can read.
 *
 * Read **by the ids on the scoreboards**, never as "everybody": this page is about the people
 * who played in the window, and a player who has never played is in none of its numbers.
 */
async function loadPlayers(client: PublicClient, playerIds: readonly string[]): Promise<StatsPlayer[]> {
  const players: StatsPlayer[] = [];

  for (const chunk of inChunks(playerIds)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid, display_name, game_name, main_role')
      .in('id', chunk);
    if (error) throw new Error(`stats: player lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      players.push({
        playerId: row.id,
        puuid: row.puuid,
        // M3.10's fallback is applied at render; the loader carries the honest `null`.
        name: row.display_name ?? row.game_name ?? null,
        mainRole: row.main_role,
      });
    }
  }
  return players;
}

/**
 * The window as two PostgREST filters: `[start, end)`, half-open, with `all-time`'s nulls
 * adding nothing (M5.9). The board's own helper, spelled again here rather than exported from
 * `lib/board/load.ts`, which keeps its query builders private.
 */
function withRange<Q extends { gte(column: string, value: string): Q; lt(column: string, value: string): Q }>(
  query: Q,
  column: string,
  range: WindowRange,
): Q {
  let next = query;
  if (range.start !== null) next = next.gte(column, range.start.toISOString());
  if (range.end !== null) next = next.lt(column, range.end.toISOString());
  return next;
}
