import type { DailyMysteryRow, Json, RoleValue } from '@customs/db';
import { mysteryPublicHookSchema } from '@customs/db/schemas';
import { championName } from '../champs/names';
import { inChunks } from '../chunks';
import { formatDuration } from '../discord/embeds';
import { gameModeFromRaw, mapIdFromRaw, matchesQueue } from '../games/queue';
import { civilDayKey, civilDayStart, nextCivilMidnight } from '../night';
import { rawFactsFromUnknown } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';
import { buildStoredClues, hookLines } from './clues';
import { kdaLine } from './copy';
import { scorePerformance } from './score';
import {
  MYSTERY_RECENT_GAME_DAYS,
  MYSTERY_RECENT_PLAYER_DAYS,
  type MysteryCandidate,
  pickMystery,
  shuffleSuspects,
} from './select';
import type { MysteryCategory, MysteryPublicHook } from './types';

const CANDIDATE_GAMES = 500;
const SUSPECT_COUNT = 6;

interface GameRow {
  id: string;
  started_at: string;
  duration_s: number;
  winning_side: number;
  raw: unknown;
}

interface SeatRow {
  game_id: string;
  player_id: string;
  side: number;
  role: RoleValue | null;
  champion_id: number | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage_to_champs: number;
  cs: number;
}

export async function loadExistingDay(client: ServiceClient, day: string): Promise<DailyMysteryRow | null> {
  const { data, error } = await client.from('daily_mysteries').select('*').eq('day', day).maybeSingle();
  if (error) throw new Error(`daily mystery: failed to read ${day}: ${error.message}`);
  return data;
}

export async function ensureTodayMystery(
  client: ServiceClient,
  now: Date,
  timeZone: string,
): Promise<DailyMysteryRow | null> {
  const day = civilDayKey(now, timeZone);
  const existing = await loadExistingDay(client, day);
  if (existing !== null) return existing;

  const created = await createDay(client, now, timeZone, day);
  if (created !== null) return created;
  return loadExistingDay(client, day);
}

async function createDay(
  client: ServiceClient,
  now: Date,
  timeZone: string,
  day: string,
): Promise<DailyMysteryRow | null> {
  const built = await buildCandidate(client, now, day);
  if (built === null) return null;

  const { data: last } = await client
    .from('daily_mysteries')
    .select('challenge_number')
    .order('challenge_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const challengeNumber = (last?.challenge_number ?? 0) + 1;
  const activeFrom = civilDayStart(now, timeZone);
  const expiresAt = nextCivilMidnight(now, timeZone);

  const { data, error } = await client
    .from('daily_mysteries')
    .insert({
      day,
      challenge_number: challengeNumber,
      game_id: built.gameId,
      mystery_player_id: built.playerId,
      interesting_score: built.score,
      category: built.category,
      suspect_ids: built.suspectIds,
      hook: built.hook as unknown as Json,
      active_from: activeFrom.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return null;
    throw new Error(`daily mystery: failed to create ${day}: ${error.message}`);
  }

  if (built.clues.length > 0) {
    const { error: clueError } = await client.from('daily_mystery_clues').insert(
      built.clues.map((clue) => ({
        challenge_id: data.id,
        clue_type: clue.type,
        clue_value: clue.value,
        reveal_order: clue.revealOrder,
      })),
    );
    if (clueError && clueError.code !== '23505') {
      throw new Error(`daily mystery: failed to store clues: ${clueError.message}`);
    }
  }

  return data;
}

async function buildCandidate(
  client: ServiceClient,
  now: Date,
  day: string,
): Promise<{
  gameId: string;
  playerId: string;
  score: number;
  category: MysteryCategory;
  suspectIds: string[];
  hook: MysteryPublicHook;
  clues: ReturnType<typeof buildStoredClues>;
} | null> {
  const games = await loadGames(client);
  if (games.length === 0) return null;

  const seats = await loadSeats(
    client,
    games.map((game) => game.id),
  );
  if (seats.length === 0) return null;

  const seatsByGame = new Map<string, SeatRow[]>();
  for (const seat of seats) {
    const list = seatsByGame.get(seat.game_id) ?? [];
    list.push(seat);
    seatsByGame.set(seat.game_id, list);
  }

  const avoid = await loadAvoid(client, now);
  const puuids = await loadPuuids(
    client,
    seats.map((seat) => seat.player_id),
  );
  const scored: MysteryCandidate[] = [];
  const riftFirst: MysteryCandidate[] = [];

  for (const game of games) {
    const roster = seatsByGame.get(game.id) ?? [];
    const raw = rawFactsFromUnknown(game.raw);
    const rift = matchesQueue(gameModeFromRaw(game.raw), 'sr', mapIdFromRaw(game.raw));
    for (const seat of roster) {
      const facts = raw.byPuuid[puuids.get(seat.player_id) ?? ''] ?? raw.byPuuid[seat.player_id];
      const damageTaken = facts?.damageTaken ?? null;
      const scoredRow = scorePerformance({
        kills: seat.kills,
        deaths: seat.deaths,
        assists: seat.assists,
        cs: seat.cs,
        damage: seat.damage_to_champs,
        damageTaken,
        durationS: game.duration_s,
      });
      if (scoredRow === null) continue;
      const candidate: MysteryCandidate = {
        gameId: game.id,
        playerId: seat.player_id,
        score: scoredRow.score,
        category: scoredRow.category,
        startedAt: new Date(game.started_at),
      };
      scored.push(candidate);
      if (rift) riftFirst.push(candidate);
    }
  }

  const pool = riftFirst.length > 0 ? riftFirst : scored;
  const picked = pickMystery(pool, day, avoid);
  if (picked === null) return null;

  const game = games.find((row) => row.id === picked.gameId);
  const roster = game === undefined ? [] : (seatsByGame.get(game.id) ?? []);
  const seat = roster.find((row) => row.player_id === picked.playerId);
  if (game === undefined || seat === undefined) return null;

  const raw = rawFactsFromUnknown(game.raw);
  const facts = raw.byPuuid[puuids.get(seat.player_id) ?? ''] ?? undefined;
  const champion = facts?.championName ?? (seat.champion_id === null ? null : championName(seat.champion_id));
  const teamKills = roster.filter((row) => row.side === seat.side).reduce((sum, row) => sum + row.kills, 0);
  const kp = teamKills <= 0 ? null : Math.round(((seat.kills + seat.assists) / teamKills) * 100);
  const hook: MysteryPublicHook = {
    kills: seat.kills,
    deaths: seat.deaths,
    assists: seat.assists,
    kda: kdaLine(seat.kills, seat.deaths, seat.assists),
    durationS: game.duration_s,
    durationLabel: formatDuration(game.duration_s),
    lines: hookLines({
      category: picked.category,
      deaths: seat.deaths,
      kp,
      cs: seat.cs,
      damage: seat.damage_to_champs,
      damageTaken: facts?.damageTaken ?? null,
      durationS: game.duration_s,
    }),
  };
  const parsedHook = mysteryPublicHookSchema.parse(hook);

  const championTimes =
    champion === null || seat.champion_id === null
      ? null
      : seats.filter((row) => row.player_id === seat.player_id && row.champion_id === seat.champion_id)
          .length;
  const gamesPlayed = new Set(
    seats.filter((row) => row.player_id === seat.player_id).map((row) => row.game_id),
  ).size;

  const clues = buildStoredClues({
    category: picked.category,
    champion,
    role: seat.role ?? facts?.role ?? null,
    damage: seat.damage_to_champs,
    cs: seat.cs,
    gold: seat.gold,
    damageTaken: facts?.damageTaken ?? null,
    longestLivedS: facts?.longestLivedS ?? null,
    championTimes,
    gamesPlayed,
  });

  const suspectIds = pickSuspects(seat.player_id, roster, seats, day);

  return {
    gameId: picked.gameId,
    playerId: picked.playerId,
    score: picked.score,
    category: picked.category,
    suspectIds,
    hook: parsedHook,
    clues,
  };
}

function pickSuspects(answerId: string, roster: SeatRow[], allSeats: SeatRow[], day: string): string[] {
  const counts = new Map<string, number>();
  for (const seat of allSeats) counts.set(seat.player_id, (counts.get(seat.player_id) ?? 0) + 1);
  const sameGame = roster.map((row) => row.player_id).filter((id) => id !== answerId);
  const frequent = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id)
    .filter((id) => id !== answerId);
  const unique: string[] = [answerId];
  for (const id of [...sameGame, ...frequent]) {
    if (unique.includes(id)) continue;
    unique.push(id);
    if (unique.length >= SUSPECT_COUNT) break;
  }
  return shuffleSuspects(unique, day);
}

async function loadGames(client: ServiceClient): Promise<GameRow[]> {
  const { data, error } = await client
    .from('games')
    .select('id, started_at, duration_s, winning_side, raw')
    .order('started_at', { ascending: false })
    .limit(CANDIDATE_GAMES);
  if (error) throw new Error(`daily mystery: failed to read games: ${error.message}`);
  return (data ?? []) as GameRow[];
}

async function loadSeats(client: ServiceClient, gameIds: string[]): Promise<SeatRow[]> {
  const out: SeatRow[] = [];
  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client
      .from('game_players')
      .select(
        'game_id, player_id, side, role, champion_id, kills, deaths, assists, gold, damage_to_champs, cs',
      )
      .in('game_id', chunk);
    if (error) throw new Error(`daily mystery: failed to read scoreboard: ${error.message}`);
    out.push(...((data ?? []) as SeatRow[]));
  }
  return out;
}

async function loadPuuids(client: ServiceClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const chunk of inChunks(ids)) {
    const { data, error } = await client.from('players_public').select('id, puuid').in('id', chunk);
    if (error) throw new Error(`daily mystery: failed to read puuids: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      map.set(row.id, row.puuid);
    }
  }
  return map;
}

async function loadAvoid(
  client: ServiceClient,
  now: Date,
): Promise<{
  recentGameIds: Set<string>;
  recentPlayerIds: Set<string>;
}> {
  const gameCut = new Date(now.getTime() - MYSTERY_RECENT_GAME_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const playerCut = new Date(now.getTime() - MYSTERY_RECENT_PLAYER_DAYS * 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await client
    .from('daily_mysteries')
    .select('game_id, mystery_player_id, active_from')
    .gte('active_from', gameCut);
  if (error) throw new Error(`daily mystery: failed to read recent mysteries: ${error.message}`);
  const recentGameIds = new Set<string>();
  const recentPlayerIds = new Set<string>();
  for (const row of data ?? []) {
    recentGameIds.add(row.game_id);
    if (row.active_from >= playerCut) recentPlayerIds.add(row.mystery_player_id);
  }
  return { recentGameIds, recentPlayerIds };
}

export function parseStoredHook(value: unknown): MysteryPublicHook | null {
  const parsed = mysteryPublicHookSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
