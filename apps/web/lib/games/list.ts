import type { Calibration, Mode } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { ARAM_GAME_MODE_PATTERN, type LobbyKickoff, ruleModeOf } from '@customs/db/schemas';
import type { RatingsBefore } from '@/components/receipt/types';
import { championLabel } from '../champs/names';
import { ruleRowNote } from '../mode/rowNote';
import { printedName } from '../names/distinct';
import { loadRosterLabels } from '../names/roster';
import { formatDayMonth, nightStart } from '../night';
import type { PublicClient } from '../publicClient';
import { displayDelta } from '../ratingDisplay';
import { kdaLine } from '../stats/funCopy';
import { renderWebName } from '../tonight/copy';
import { formatMinutes } from './duration';
import { GAMES_PAGE_SIZE, type GamesFilters, gamesRange, pageCount } from './filters';
import { readKickoffs } from './kickoffs';
import { gameModeFromRaw, matchesQueue } from './queue';
import {
  type PlayerRef,
  readGroupCalibration,
  readPlayersById,
  readScoreRows,
  readSplitRuns,
  type ScoreRow,
} from './read';
import { gameReceiptOf } from './receipt';

/**
 * `/g/<slug>/games` (M14.16): one page of 25 of the group's games, filtered in the query, newest
 * first. The 1.0 list read every game of the window with its `raw` blob and both scoreboards
 * (4.5 MB all time); this reads the 25 rows on screen, their scoreboards and their split runs,
 * plus the group's calibration line, and nothing else.
 */

export interface GamesMember {
  puuid: string;
  name: string;
}

/** The compact receipt's input for one row, or `null` for no odds (the component prints nothing). */
export type CompactOdds =
  | { kind: 'rolled'; blueWinProb: number; rank: number }
  /** `kickoffBlueWinProb` (M21.7): the kickoff record's odds when its teams are the eog's, else `null`. */
  | { kind: 'pre-game'; ratingsBefore: RatingsBefore; kickoffBlueWinProb: number | null }
  | null;

export interface GameRowLine {
  /** `you` is the signed-in viewer; `focus` the player the list is filtered to (when not the viewer). */
  who: 'you' | 'focus';
  name: string;
  champion: string | null;
  role: RoleValue | null;
  /** `15/5/6`. */
  kda: string;
  won: boolean;
  /** `displayDelta` of the game, or `null` when it was not rated (ARAM, unrated backfill). */
  delta: number | null;
}

export interface GameListItem {
  id: string;
  /** `22 Sep`: the night it was played (a 01:00 game is the evening before). */
  dateLabel: string;
  /** `21 min`. */
  durationLabel: string;
  winningSide: 100 | 200;
  aram: boolean;
  odds: CompactOdds;
  /** M15.19: `Tanks only · not rated`, `Ionia vs Noxus · not rated`, `Mirror match`; null with no rule. */
  ruleNote: string | null;
  lines: GameRowLine[];
}

export interface GamesListView {
  /** The filters as applied: `player` is `null` when the URL named somebody who is not a member. */
  filters: GamesFilters;
  /** Games matching the filters, all pages. */
  total: number;
  pages: number;
  /** The group's players, by name, for the player select. */
  members: GamesMember[];
  focusName: string | null;
  items: GameListItem[];
  calibration: Calibration;
  /** Whether the group has any game at all: tells "no games yet" from "no games match". */
  groupHasGames: boolean;
}

export interface LoadGamesListOptions {
  groupId: string;
  filters: GamesFilters;
  /**
   * May be a promise (the page's session read): it is awaited only when the rows' own lines are
   * drawn, so the list's reads never wait for the session.
   */
  viewerPuuid: string | null | PromiseLike<string | null>;
  timeZone: string;
  /** Injected in tests. */
  now?: Date;
  /**
   * The calibration line's reader. Pages pass `cachedGroupCalibration` (cross-request cache, tagged
   * per group); the default reads it with `client`, which is what tests and scripts get.
   */
  calibration?: (groupId: string) => Promise<Calibration>;
}

export async function loadGamesList(
  client: PublicClient,
  options: LoadGamesListOptions,
): Promise<GamesListView> {
  const { groupId, timeZone } = options;
  const now = options.now ?? new Date();

  // app-perf (2026-10-04): the select's members, the calibration line and the page itself start
  // together. Only a player filter waits, for one small read that resolves the focus, and the page
  // and its count are one request on page 1. Every promise ends inside one `Promise.all`.
  const idsRead = readRatedIds(client, groupId);
  const membersRead = readMembers(client, groupId, idsRead);
  const focusRead: Promise<PlayerRef | undefined> =
    options.filters.player === null
      ? Promise.resolve(undefined)
      : readFocus(client, idsRead, options.filters.player);
  const pageRead = focusRead.then(async (focus) => {
    const filters: GamesFilters = { ...options.filters, player: focus === undefined ? null : focus.puuid };
    const range = gamesRange(filters.window, now, timeZone);
    const page = await readClampedPage(client, {
      groupId,
      filters,
      range,
      focusPlayerId: focus?.playerId ?? null,
    });
    const [groupHasGames, items] = await Promise.all([
      page.total > 0 ? true : countGroupGames(client, groupId).then((count) => count > 0),
      assembleItems(client, page.games, membersRead, {
        viewerPuuid: options.viewerPuuid,
        focusPuuid: filters.player,
        timeZone,
      }),
    ]);
    return { focus, filters, page, groupHasGames, items };
  });
  const [members, calibration, { focus, filters, page, groupHasGames, items }] = await Promise.all([
    membersRead,
    options.calibration?.(groupId) ?? readGroupCalibration(client, groupId),
    pageRead,
  ]);

  return {
    filters,
    total: page.total,
    pages: page.pages,
    members: members.list,
    // The same distinct name the select prints (M14.69).
    focusName:
      focus === undefined
        ? null
        : (members.list.find((member) => member.puuid === focus.puuid)?.name ?? renderWebName(focus.name)),
    items,
    calibration,
    groupHasGames,
  };
}

interface GameHead {
  id: string;
  startedAt: string;
  durationS: number;
  winningSide: 100 | 200;
  lobbyId: string | null;
  aram: boolean;
  /** `games.rated` (M15.18): false for a game played not rated. */
  rated: boolean;
  /** M15.19: the rule it was played under, only when checked against it (a Rift game); else null. */
  rule: Mode | null;
}

interface PageInput {
  groupId: string;
  filters: GamesFilters;
  range: { start: Date | null; end: Date | null };
  focusPlayerId: string | null;
}

/**
 * `matchesQueue` in SQL, trim and case included, so the list and calibration (which runs
 * `matchesQueue` on the same `game_mode`, 0039) can never sort a game onto different maps: Rift is a
 * missing, blank or `CLASSIC` mode (every night before the toggle had none), ARAM is the ARAM family.
 * POSIX `[[:space:]]`, not `\s`: inside an `or=(...)` value the regex must be double-quoted, and
 * PostgREST's quoted values treat a backslash as an escape, so `\s` would arrive as `s`.
 */
export const RIFT_MODE_FILTER = 'game_mode.is.null,game_mode.imatch."^[[:space:]]*(classic)?[[:space:]]*$"';
/** The ARAM family (`isAramGameMode`): `ARAM`, Mayhem `KIWI` / `KIWI_*`, `KINGPORO` (owner bug 2026-10-05). */
export const ARAM_MODE_PATTERN = ARAM_GAME_MODE_PATTERN;

/** The page's filters on a `games` query. Generic so the count and the ranged read share it. */
function withListFilters<
  Q extends { filter(column: string, operator: string, value: unknown): Q; or(filters: string): Q },
>(query: Q, input: PageInput): Q {
  let next = query.filter('group_id', 'eq', input.groupId).filter('winning_side', 'in', '(100,200)');
  if (input.focusPlayerId !== null) next = next.filter('game_players.player_id', 'eq', input.focusPlayerId);
  if (input.range.start !== null) next = next.filter('started_at', 'gte', input.range.start.toISOString());
  if (input.range.end !== null) next = next.filter('started_at', 'lt', input.range.end.toISOString());
  return input.filters.mode === 'aram'
    ? next.filter('game_mode', 'imatch', ARAM_MODE_PATTERN)
    : next.or(RIFT_MODE_FILTER);
}

async function countGamePage(client: PublicClient, input: PageInput): Promise<number> {
  const query =
    input.focusPlayerId === null
      ? client.from('games').select('id', { count: 'exact', head: true })
      : client.from('games').select('id, game_players!inner(player_id)', { count: 'exact', head: true });
  const { count, error } = await withListFilters(query, input);
  if (error) throw new Error(`games: list count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The page the URL asked for, clamped to one that exists, with the total. Page 1 (every visit from
 * the tab bar) is one request: the ranged read carries the count. A later page counts first, then
 * clamps, then reads the range: PostgREST answers a range past the end with a 416 (PGRST103), so a
 * typed `?page=999` must never reach the ranged read (M14.16 review). Sets `filters.page`.
 */
async function readClampedPage(
  client: PublicClient,
  input: PageInput,
): Promise<{ total: number; pages: number; games: GameHead[] }> {
  const requested = Math.max(1, Math.trunc(input.filters.page) || 1);
  if (requested === 1) {
    input.filters.page = 1;
    const { games, total } = await readGamePage(client, input, true);
    return { total, pages: pageCount(total), games };
  }
  const total = await countGamePage(client, input);
  const pages = pageCount(total);
  input.filters.page = Math.min(requested, pages);
  return { total, pages, games: total === 0 ? [] : (await readGamePage(client, input, false)).games };
}

/** One page of the list. The caller has clamped `filters.page` to a page that exists. */
async function readGamePage(
  client: PublicClient,
  input: PageInput,
  withCount: boolean,
): Promise<{ games: GameHead[]; total: number }> {
  const from = (input.filters.page - 1) * GAMES_PAGE_SIZE;
  const count: { count?: 'exact' } = withCount ? { count: 'exact' } : {};
  // Two literal selects so PostgREST's client can type each row; the inner join is the player filter.
  const query =
    input.focusPlayerId === null
      ? client
          .from('games')
          .select(
            'id, started_at, duration_s, winning_side, lobby_id, rated, rule, rule_class_tag, rule_region_blue, rule_region_red, rule_checked, mode:game_mode',
            count,
          )
      : client
          .from('games')
          .select(
            'id, started_at, duration_s, winning_side, lobby_id, rated, rule, rule_class_tag, rule_region_blue, rule_region_red, rule_checked, mode:game_mode, game_players!inner(player_id)',
            count,
          );
  const {
    data,
    error,
    count: total,
  } = await withListFilters(query, input)
    .order('started_at', { ascending: false })
    .order('lcu_game_id', { ascending: false })
    .range(from, from + GAMES_PAGE_SIZE - 1);
  if (error) throw new Error(`games: list lookup failed: ${error.message}`);

  const games: GameHead[] = [];
  for (const row of data ?? []) {
    if (row.winning_side !== 100 && row.winning_side !== 200) continue;
    games.push({
      id: row.id,
      startedAt: row.started_at,
      durationS: row.duration_s,
      winningSide: row.winning_side,
      lobbyId: row.lobby_id,
      aram: matchesQueue(gameModeFromRaw({ gameMode: row.mode }), 'aram'),
      rated: row.rated,
      // M15.19: named only when the game was checked against it (a Rift game past the remake line).
      rule: row.rule_checked
        ? ruleModeOf({
            rule: row.rule,
            classTag: row.rule_class_tag,
            regionBlue: row.rule_region_blue,
            regionRed: row.rule_region_red,
          })
        : null,
    });
  }
  return { games, total: total ?? games.length };
}

async function countGroupGames(client: PublicClient, groupId: string): Promise<number> {
  const { count, error } = await client
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if (error) throw new Error(`games: group count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The group's players for the select: everybody with a rating row in this group (anon cannot read
 * memberships, and a member who never played has no games to filter to anyway), by name.
 */
/** The `players.id` of everybody with a rating row in the group. */
async function readRatedIds(client: PublicClient, groupId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await client
      .from('ratings')
      .select('player_id')
      .eq('group_id', groupId)
      .order('player_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`games: member lookup failed: ${error.message}`);
    for (const row of data ?? []) ids.add(row.player_id);
    if ((data ?? []).length < 1_000) break;
  }
  return ids;
}

interface Members {
  list: GamesMember[];
  byPuuid: Map<string, PlayerRef>;
  byId: ReadonlyMap<string, PlayerRef>;
}

/**
 * The group's players for the select: everybody with a rating row in this group (anon cannot read
 * memberships, and a member who never played has no games to filter to anyway), by name. The
 * roster labels start at once, beside the ids.
 */
async function readMembers(
  client: PublicClient,
  groupId: string,
  idsRead: Promise<Set<string>>,
): Promise<Members> {
  const [players, labels] = await Promise.all([
    idsRead.then((ids) => readPlayersById(client, [...ids])),
    // Every option unique: two people with the same name are told apart (M14.69).
    loadRosterLabels(client, groupId),
  ]);
  const byPuuid = new Map([...players.values()].map((player) => [player.puuid, player]));
  const list = [...byPuuid.values()]
    .map((player) => ({ puuid: player.puuid, name: printedName(player.name, labels.get(player.puuid)) }))
    .sort(
      (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.puuid.localeCompare(b.puuid),
    );
  return { list, byPuuid, byId: players };
}

/**
 * The player a `?player=` names, when they have a rating row in the group (the select's rule), or
 * undefined: one small read by puuid beside the ids, so the page never waits for the whole roster.
 */
async function readFocus(
  client: PublicClient,
  idsRead: Promise<Set<string>>,
  puuid: string,
): Promise<PlayerRef | undefined> {
  const [ids, { data, error }] = await Promise.all([
    idsRead,
    client
      .from('players_public')
      .select('id, puuid, display_name, game_name, main_role')
      .eq('puuid', puuid)
      .limit(1),
  ]);
  if (error) throw new Error(`games: player lookup failed: ${error.message}`);
  const row = data?.[0];
  if (row === undefined || row.id === null || row.puuid === null || !ids.has(row.id)) return undefined;
  return {
    playerId: row.id,
    puuid: row.puuid,
    name: row.display_name ?? row.game_name ?? null,
    mainRole: row.main_role,
  };
}

async function assembleItems(
  client: PublicClient,
  games: readonly GameHead[],
  membersRead: Promise<Members>,
  options: {
    viewerPuuid: string | null | PromiseLike<string | null>;
    focusPuuid: string | null;
    timeZone: string;
  },
): Promise<GameListItem[]> {
  if (games.length === 0) return [];
  const lobbyIds = games.map((game) => game.lobbyId).filter((id): id is string => id !== null);
  const [rows, runs, kickoffs] = await Promise.all([
    readScoreRows(
      client,
      games.map((game) => game.id),
    ),
    readSplitRuns(client, lobbyIds),
    readKickoffs(client, lobbyIds),
  ]);
  // Nearly everybody on a scoreboard is already in the select's roster; read only who is not.
  const members = await membersRead;
  const missing = [...new Set(rows.map((row) => row.playerId))].filter((id) => !members.byId.has(id));
  const [extra, viewerPuuid] = await Promise.all([
    missing.length === 0 ? new Map<string, PlayerRef>() : readPlayersById(client, missing),
    options.viewerPuuid,
  ]);
  const players = new Map([...members.byId, ...extra]);
  const rowsByGame = new Map<string, ScoreRow[]>();
  for (const row of rows) {
    const list = rowsByGame.get(row.gameId) ?? [];
    list.push(row);
    rowsByGame.set(row.gameId, list);
  }

  return games.map((game) =>
    gameListItemOf(
      game,
      rowsByGame.get(game.id) ?? [],
      players,
      game.lobbyId === null ? [] : (runs.get(game.lobbyId) ?? []),
      { ...options, viewerPuuid },
      game.lobbyId === null ? null : (kickoffs.get(game.lobbyId) ?? null),
    ),
  );
}

/** One row of the list, from its reads. Pure. Exported for the unit test. */
export function gameListItemOf(
  game: GameHead,
  rows: readonly ScoreRow[],
  players: ReadonlyMap<string, PlayerRef>,
  run: Parameters<typeof gameReceiptOf>[0]['splits'],
  options: { viewerPuuid: string | null; focusPuuid: string | null; timeZone: string },
  kickoff: LobbyKickoff | null = null,
): GameListItem {
  const seats = rows.map((row) => ({
    row,
    // An id no `players_public` row names gets a key that can match nobody.
    puuid: players.get(row.playerId)?.puuid ?? `id:${row.playerId}`,
    name: players.get(row.playerId)?.name ?? null,
  }));
  const receipt = gameReceiptOf({
    aram: game.aram,
    rated: game.rated,
    seats: seats.map(({ row, puuid }) => ({
      puuid,
      side: row.side,
      rBefore: row.rBefore,
    })),
    splits: run,
    kickoff,
  });
  const odds: CompactOdds =
    receipt.kind === 'rolled'
      ? { kind: 'rolled', blueWinProb: receipt.chosen.blueWinProb, rank: receipt.chosen.rank }
      : receipt.kind === 'pre-game'
        ? {
            kind: 'pre-game',
            ratingsBefore: receipt.ratingsBefore,
            kickoffBlueWinProb: receipt.kickoffBlueWinProb,
          }
        : null;

  const lines: GameRowLine[] = [];
  const lineFor = (puuid: string, who: GameRowLine['who']): void => {
    const seat = seats.find((entry) => entry.puuid === puuid);
    if (seat === undefined) return;
    const { row } = seat;
    lines.push({
      who,
      name: renderWebName(seat.name),
      champion: championLabel(row.championId),
      role: row.role,
      kda: kdaLine(row.kills, row.deaths, row.assists),
      won: row.side === game.winningSide,
      delta:
        game.aram || row.rBefore === null || row.rAfter === null
          ? null
          : displayDelta(row.rBefore, row.rAfter),
    });
  };
  if (options.focusPuuid !== null && options.focusPuuid !== options.viewerPuuid)
    lineFor(options.focusPuuid, 'focus');
  if (options.viewerPuuid !== null) lineFor(options.viewerPuuid, 'you');

  const started = new Date(game.startedAt);
  return {
    id: game.id,
    dateLabel: formatDayMonth(nightStart(started, options.timeZone), options.timeZone),
    durationLabel: formatMinutes(game.durationS),
    winningSide: game.winningSide,
    aram: game.aram,
    odds,
    // Not rated as the tape says it: no scoreboard row carries a fold.
    ruleNote: ruleRowNote(game.rule, rows.length > 0 && rows.every((row) => row.rAfter !== null)),
    lines,
  };
}
