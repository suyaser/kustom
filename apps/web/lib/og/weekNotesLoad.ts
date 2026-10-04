import { SETTLING_GAMES } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { ruleModeOf } from '@customs/db/schemas';
import { z } from 'zod';
import { loadBoard } from '../board/load';
import { championName, isRosterChampion } from '../champs/names';
import { loadFearless } from '../fearless/load';
import { availableFearless, storedChampionNames } from '../fearless/present';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { ruleRowName } from '../mode/rowNote';
import { civilDayKey, formatDayName, nightStart, weekStart, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import { loadFunFacts, loadStats } from '../stats/load';
import {
  isNearlyEmpty,
  mostPlayedRole,
  WEEK_START_PATTERN,
  type WeekNotesInput,
  type WeekNotesMode,
  type WeekNotesModel,
  type WeekNotesRecord,
  weekNotesModel,
} from './weekNotes';

/**
 * The reads behind the "Week N notes" image (M14.79), with the **anon key**, like every other OG
 * loader: what the picture can show is what RLS lets a stranger read, and the public board
 * already shows all of it.
 *
 * - The board: `loadBoard` on `last-week` (net points, W–L, the settling chip, and the roster's
 *   same-name labels, so a name reads as it does on the board).
 * - The awards: `loadStats`' closed-week blocks, the Sunday post's own lines.
 * - Records: `loadFunFacts` over all time; a group best whose game was this week is NEW.
 * - The week's games, once: roles (the medallion's mark), nights, Mode of the night runs, and the
 *   ids the two small queries and the Fearless count need.
 * - Two small queries: **first nights** (week players with no game in the group before the week)
 *   and **first picks** (champions locked on the Rift this week that nobody in the group had
 *   locked before).
 *
 * No opt-out applies: `group_memberships.ai_opt_out` covers AI-written lines only, and every
 * number here is one the public board, Stats or Fun already prints.
 */

export interface WeekBounds {
  /** The Sunday 06:00 the week opens on. */
  start: Date;
  /** The next Sunday 06:00 (exclusive). */
  end: Date;
  /** `2026-09-27`. */
  key: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The route's `[weekStart]` segment: an ISO calendar date (`2026-09-27`). Sunday and closed are checked after. */
export const weekStartSchema = z.iso.date();

/**
 * The image's `cache-control`: a day at the CDN, not immutable, so a `rebuild-ratings` that
 * refolds a closed week shows by the next day (Discord's proxy keeps its own copy anyway).
 */
export const WEEK_NOTES_CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

/**
 * The closed week a `[weekStart]` segment names, or null: a malformed date, a day that does not
 * open a week (not a Sunday), or a week that has not closed by `now`.
 */
export function weekFromParam(param: string, timeZone: string, now: Date): WeekBounds | null {
  // The boundary (CLAUDE.md): a real ISO calendar date, or a 404.
  if (!weekStartSchema.safeParse(param).success) return null;
  const match = WEEK_START_PATTERN.exec(param);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  if (noon.getUTCFullYear() !== year || noon.getUTCMonth() !== month - 1 || noon.getUTCDate() !== day) {
    return null;
  }
  const start = weekStart(noon, timeZone);
  if (civilDayKey(start, timeZone) !== param) return null;
  // `last-week` read from a day inside the following week is exactly this one.
  const range = windowRange('last-week', new Date(start.getTime() + 8 * DAY_MS), timeZone);
  const end = range.end as Date;
  if (end.getTime() > now.getTime()) return null;
  return { start, end, key: param };
}

/** Records that are a brag, not a roast (M16.7's tone: nobody mocked). Best first. */
const BRAG_RECORDS = ['damage', 'kills', 'assists', 'spree', 'clean', 'glue'] as const;

interface WeekSeat {
  player_id: string;
  role: RoleValue | null;
  champion_id: number | null;
  mu_after: number | null;
}

interface WeekGame {
  id: string;
  started_at: string;
  rated: boolean;
  mode: string | null;
  rule: string | null;
  rule_class_tag: string | null;
  rule_region_blue: string | null;
  rule_region_red: string | null;
  gameMode: unknown;
  game_players: WeekSeat[] | WeekSeat | null;
}

/**
 * The week's model, or null when the week has no counted game or nothing worth a picture
 * (`isNearlyEmpty`): the route's 404, and no image on the Sunday post. Every read but
 * the board and the week's games degrades to "nothing new" on failure, logged: a missing tile is
 * better than no picture.
 */
export async function loadWeekNotes(
  client: PublicClient,
  group: { id: string; name: string },
  week: WeekBounds,
  timeZone: string,
): Promise<WeekNotesModel | null> {
  const now = new Date(week.start.getTime() + 8 * DAY_MS);
  const board = await loadBoard(client, { window: 'last-week', groupId: group.id, now, timeZone });
  if (board.games === 0 || board.rows.length === 0 || board.range === null) return null;

  const games = await readWeekGames(client, group.id, week);
  const seats = games.flatMap((game) => asSeats(game.game_players).map((seat) => ({ game, seat })));
  const puuidOf = await readPuuids(client, [...new Set(seats.map(({ seat }) => seat.player_id))]);

  const rolesByPuuid = new Map<string, (RoleValue | null)[]>();
  for (const { seat } of seats) {
    if (seat.mu_after === null) continue;
    const puuid = puuidOf.get(seat.player_id);
    if (puuid === undefined) continue;
    rolesByPuuid.set(puuid, [...(rolesByPuuid.get(puuid) ?? []), seat.role]);
  }

  const counted = games.filter((game) => asSeats(game.game_players).some((seat) => seat.mu_after !== null));
  const nights = new Set(
    counted.map((game) => civilDayKey(nightStart(new Date(game.started_at), timeZone), timeZone)),
  );

  const [firstNights, firstPicks, records, awards, fearless, weekNumber] = await Promise.all([
    soft('first nights', [], () => readFirstNights(client, group.id, week, games, puuidOf, timeZone)),
    soft('first picks', [], () => readFirstPicks(client, group.id, week, games, puuidOf)),
    soft('records', [], () => readRecords(client, group.id, week, timeZone)),
    soft('awards', [], () => readAwards(client, group.id, now, timeZone)),
    soft('fearless', null, () => readFearless(client, group.id, games)),
    soft('week number', 1, () => readWeekNumber(client, group.id, week, timeZone)),
  ]);

  const input: WeekNotesInput = {
    group: group.name,
    weekNumber,
    range: board.range,
    games: board.games,
    nights: nights.size,
    players: board.rows.map((row) => ({
      puuid: row.puuid,
      name: row.name,
      nameSuffix: row.nameSuffix ?? null,
      points: row.points ?? 0,
      wins: row.wins,
      losses: row.losses,
      games: row.games,
      ratedGames: row.ratedGames,
      settling: row.settlingChip,
      role: mostPlayedRole(rolesByPuuid.get(row.puuid) ?? []),
    })),
    firstNights,
    records,
    firstPicks,
    modes: modeRuns(games),
    fearless,
    awards,
    settlingGames: SETTLING_GAMES,
  };
  const model = weekNotesModel(input);
  // Nothing worth a picture: the route 404s and the Sunday post sends no image (the lead, 2026-10-04).
  return isNearlyEmpty(model) ? null : model;
}

async function soft<T>(what: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`week notes: reading ${what} failed`, error);
    return fallback;
  }
}

async function readWeekGames(client: PublicClient, groupId: string, week: WeekBounds): Promise<WeekGame[]> {
  const { data, error } = await client
    .from('games')
    .select(
      'id, started_at, rated, mode, rule, rule_class_tag, rule_region_blue, rule_region_red, raw->gameMode, game_players(player_id, role, champion_id, mu_after)',
    )
    .eq('group_id', groupId)
    .gte('started_at', week.start.toISOString())
    .lt('started_at', week.end.toISOString())
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1_000);
  if (error) throw new Error(`week notes: reading the week's games failed: ${error.message}`);
  return (data ?? []) as unknown as WeekGame[];
}

function asSeats(value: WeekGame['game_players']): WeekSeat[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const isRift = (game: WeekGame): boolean => matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'sr');

async function readPuuids(client: PublicClient, playerIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; from < playerIds.length; from += 90) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid')
      .in('id', playerIds.slice(from, from + 90));
    if (error) throw new Error(`week notes: player lookup failed: ${error.message}`);
    for (const row of data ?? []) if (row.id !== null && row.puuid !== null) out.set(row.id, row.puuid);
  }
  return out;
}

/**
 * The ids in `wanted` that appear in `column` of this group's scoreboard rows before the week.
 * One query per round, each round dropping what it found, so a busy history costs a few rounds of
 * at most a thousand rows and never a full scan into PostgREST's row cap.
 */
async function seenBefore(
  client: PublicClient,
  groupId: string,
  week: WeekBounds,
  column: 'player_id' | 'champion_id',
  wanted: readonly (string | number)[],
): Promise<Set<string | number>> {
  const seen = new Set<string | number>();
  let remaining = [...wanted];
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, 90);
    const { data, error } = await client
      .from('game_players')
      .select(`${column}, games!inner(started_at)`)
      .eq('group_id', groupId)
      // `player_id` takes the uuids, `champion_id` the numbers; the callers pass the matching kind.
      .in(column, chunk as never[])
      .lt('games.started_at', week.start.toISOString())
      .limit(1_000);
    if (error) throw new Error(`week notes: reading earlier ${column} failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<typeof column, string | number>[];
    for (const row of rows) seen.add(row[column]);
    const answered = rows.length < 1_000 ? new Set(chunk) : new Set(rows.map((row) => row[column]));
    // A full page may not have reached every id of the chunk: only the ones it found are done.
    remaining = remaining.filter((id) => !answered.has(id) && !seen.has(id));
  }
  return seen;
}

async function readFirstNights(
  client: PublicClient,
  groupId: string,
  week: WeekBounds,
  games: readonly WeekGame[],
  puuidOf: ReadonlyMap<string, string>,
  timeZone: string,
): Promise<{ puuid: string; day: string }[]> {
  // The night of each counted player's first game this week, in the week's order.
  const firstGame = new Map<string, string>();
  for (const game of games) {
    for (const seat of asSeats(game.game_players)) {
      if (seat.mu_after !== null && !firstGame.has(seat.player_id))
        firstGame.set(seat.player_id, game.started_at);
    }
  }
  const seen = await seenBefore(client, groupId, week, 'player_id', [...firstGame.keys()]);
  return [...firstGame].flatMap(([playerId, startedAt]) => {
    const puuid = puuidOf.get(playerId);
    if (seen.has(playerId) || puuid === undefined) return [];
    return [{ puuid, day: formatDayName(nightStart(new Date(startedAt), timeZone), timeZone) }];
  });
}

async function readFirstPicks(
  client: PublicClient,
  groupId: string,
  week: WeekBounds,
  games: readonly WeekGame[],
  puuidOf: ReadonlyMap<string, string>,
): Promise<string[]> {
  const order: number[] = [];
  for (const game of games.filter(isRift)) {
    for (const seat of asSeats(game.game_players)) {
      if (seat.champion_id !== null && seat.champion_id > 0 && !order.includes(seat.champion_id)) {
        order.push(seat.champion_id);
      }
    }
  }
  if (order.length === 0) return [];
  const seen = await seenBefore(client, groupId, week, 'champion_id', order);
  const fresh = order.filter((id) => !seen.has(id));
  const named = await newerChampionNames(client, games, fresh, puuidOf);
  // A champion nobody can name (no roster entry, no client name in the blob) is left out rather
  // than printed as `Champion 804` on a picture that travels.
  return fresh.flatMap((id) => {
    const name = isRosterChampion(id) ? championName(id) : named.get(id);
    return name === undefined ? [] : [name];
  });
}

/**
 * The client's own name for a champion released after `lib/champs/names.ts` was last edited, off
 * the week's end-of-game blobs (Fearless's `storedChampionNames`). Free on an ordinary week: with
 * every id on the roster it reads nothing; otherwise one `raw` read for the games that locked them.
 */
async function newerChampionNames(
  client: PublicClient,
  games: readonly WeekGame[],
  ids: readonly number[],
  puuidOf: ReadonlyMap<string, string>,
): Promise<Map<number, string>> {
  const wanted = new Set(ids.filter((id) => !isRosterChampion(id)));
  if (wanted.size === 0) return new Map();
  const locking = games.filter((game) =>
    asSeats(game.game_players).some((seat) => seat.champion_id !== null && wanted.has(seat.champion_id)),
  );
  const { data, error } = await client
    .from('games')
    .select('id, raw')
    .in(
      'id',
      locking.map((game) => game.id),
    );
  if (error) throw new Error(`week notes: reading champion names failed: ${error.message}`);
  const raws = new Map((data ?? []).map((row) => [row.id, row.raw]));
  return storedChampionNames(
    locking.map((game) => ({
      raw: raws.get(game.id) ?? null,
      seats: asSeats(game.game_players).map((seat) => ({
        puuid: puuidOf.get(seat.player_id) ?? null,
        championId: seat.champion_id,
      })),
    })),
    wanted,
  );
}

async function readRecords(
  client: PublicClient,
  groupId: string,
  week: WeekBounds,
  timeZone: string,
): Promise<WeekNotesRecord[]> {
  const fun = await loadFunFacts(client, { window: 'all-time', groupId, timeZone });
  const inWeek = (startedAt: string | undefined): boolean => {
    if (startedAt === undefined) return false;
    const at = Date.parse(startedAt);
    return at >= week.start.getTime() && at < week.end.getTime();
  };
  return BRAG_RECORDS.flatMap((id) => {
    const record = fun.records.find((candidate) => candidate.id === id);
    const holder = record?.holders[0];
    if (record === undefined || holder === undefined) return [];
    // A tie with an older game is not a new best.
    if (!record.holders.every((each) => inWeek(each.game?.startedAt))) return [];
    return [{ title: record.title, puuid: holder.puuid, name: holder.name, valueLabel: holder.valueLabel }];
  });
}

async function readAwards(
  client: PublicClient,
  groupId: string,
  now: Date,
  timeZone: string,
): Promise<{ label: string; line: string }[]> {
  const stats = await loadStats(client, { window: 'last-week', now, timeZone, groupId });
  if (stats.awards === null || stats.awards.kind !== 'closed') return [];
  return stats.awards.blocks
    .filter((block) => block.won)
    .map((block) => ({ label: block.label, line: block.lines.map((line) => line.text).join('\n') }));
}

async function readFearless(
  client: PublicClient,
  groupId: string,
  games: readonly WeekGame[],
): Promise<WeekNotesInput['fearless']> {
  const fearlessGames = new Set(
    games.filter((game) => game.mode === 'fearless' && game.rated).map((game) => game.id),
  );
  if (fearlessGames.size === 0) return null;
  const pool = await loadFearless(client, groupId);
  return {
    total: pool.champions.length,
    added: pool.champions.filter(
      (champion) => champion.gameId !== undefined && fearlessGames.has(champion.gameId),
    ).length,
    open: availableFearless(pool.champions).length,
  };
}

/** Weeks since the week of the group's first game, that week being 1. */
async function readWeekNumber(
  client: PublicClient,
  groupId: string,
  week: WeekBounds,
  timeZone: string,
): Promise<number> {
  const { data, error } = await client
    .from('games')
    .select('started_at')
    .eq('group_id', groupId)
    .order('started_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const first = data?.[0]?.started_at;
  if (first === undefined) return 1;
  const firstWeek = weekStart(new Date(first), timeZone);
  return Math.max(1, Math.round((week.start.getTime() - firstWeek.getTime()) / (7 * DAY_MS)) + 1);
}

/** The week's rule games, one run per rule name and rated flag, in order of first play. */
export function modeRuns(
  games: readonly Pick<
    WeekGame,
    'rule' | 'rule_class_tag' | 'rule_region_blue' | 'rule_region_red' | 'rated'
  >[],
): WeekNotesMode[] {
  const runs: WeekNotesMode[] = [];
  for (const game of games) {
    const name = ruleRowName(
      ruleModeOf({
        rule: game.rule,
        classTag: game.rule_class_tag,
        regionBlue: game.rule_region_blue,
        regionRed: game.rule_region_red,
      }),
    );
    if (name === null) continue;
    const run = runs.find((each) => each.name === name && each.rated === game.rated);
    if (run === undefined) runs.push({ name, count: 1, rated: game.rated });
    else run.count += 1;
  }
  return runs;
}
