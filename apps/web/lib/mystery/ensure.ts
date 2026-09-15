import type { DailyMysteryRow, Json, RoleValue } from '@customs/db';
import { mysteryPublicHookSchema } from '@customs/db/schemas';
import { championName } from '../champs/names';
import { inChunks } from '../chunks';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { civilDayKey, civilDayStart, nextCivilMidnight } from '../night';
import { rawFactsFromUnknown } from '../stats/rawFacts';
import type { ServiceClient } from '../supabase';
import { type BuildGame, type BuildSeat, type BuiltChallenge, planChallenge } from './build';
import { MYSTERY_RECENT_GAME_DAYS, MYSTERY_RECENT_PLAYER_DAYS } from './select';
import type { MysteryKind, MysteryPublicHook } from './types';

/**
 * The one writer of a daily challenge (M5.32, second game added by M8.4).
 *
 * There is exactly one `ensureToday*` in this project and this is it: both games, one row per
 * civil day, one unique on `day` so two simultaneous first visitors cannot fork the day, and
 * the service role for every read and write, because the answer and the unrevealed clues are
 * not public facts.
 *
 * All of the deciding is `build.ts`, which takes no client. This file reads rows, hands them
 * over, and inserts what comes back.
 */

const CANDIDATE_GAMES = 500;

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
  vision_score: number | null;
  damage_self_mitigated: number | null;
  damage_to_objectives: number | null;
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
  const built = await buildToday(client, now, day);
  if (built === null) return null;

  const challengeNumber = await nextChallengeNumber(client, built.kind);
  const activeFrom = civilDayStart(now, timeZone);
  const expiresAt = nextCivilMidnight(now, timeZone);

  const { data, error } = await client
    .from('daily_mysteries')
    .insert({
      day,
      kind: built.kind,
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

/**
 * The next number **within this kind** (M8.4). `Daily Mystery #41` must not become `#43`
 * because two award days fell between; the unique on `(kind, challenge_number)` is what makes
 * that a rule rather than a hope.
 */
async function nextChallengeNumber(client: ServiceClient, kind: MysteryKind): Promise<number> {
  const { data: last } = await client
    .from('daily_mysteries')
    .select('challenge_number')
    .eq('kind', kind)
    .order('challenge_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (last?.challenge_number ?? 0) + 1;
}

/** Read the window, hand it to the pure builder, give back whatever it decided today is. */
async function buildToday(client: ServiceClient, now: Date, day: string): Promise<BuiltChallenge | null> {
  const games = await loadGames(client);
  if (games.length === 0) return null;

  const seats = await loadSeats(
    client,
    games.map((game) => game.id),
  );
  if (seats.length === 0) return null;

  const puuids = await loadPuuids(
    client,
    seats.map((seat) => seat.player_id),
  );
  const avoid = await loadAvoid(client, now);

  const seatsByGame = new Map<string, SeatRow[]>();
  for (const seat of seats) {
    const list = seatsByGame.get(seat.game_id) ?? [];
    list.push(seat);
    seatsByGame.set(seat.game_id, list);
  }

  const built: BuildGame[] = games.map((game) => {
    const raw = rawFactsFromUnknown(game.raw);
    return {
      id: game.id,
      startedAt: new Date(game.started_at),
      durationS: game.duration_s,
      isRift: matchesQueue(gameModeFromRaw(game.raw), 'sr'),
      seats: (seatsByGame.get(game.id) ?? []).map((seat) => {
        const facts = raw.byPuuid[puuids.get(seat.player_id) ?? ''] ?? raw.byPuuid[seat.player_id];
        return {
          playerId: seat.player_id,
          side: seat.side,
          role: seat.role ?? facts?.role ?? null,
          championId: seat.champion_id,
          championName:
            facts?.championName ?? (seat.champion_id === null ? null : championName(seat.champion_id)),
          kills: seat.kills,
          deaths: seat.deaths,
          assists: seat.assists,
          gold: seat.gold,
          damageToChamps: seat.damage_to_champs,
          cs: seat.cs,
          // The column first, the blob second: `copy-raw-stats` fills the column from the
          // blob, so a row that has one has the other, and a row that has neither is a game
          // Guess the Award cannot be about.
          visionScore: seat.vision_score ?? facts?.visionScore ?? null,
          damageSelfMitigated: seat.damage_self_mitigated ?? facts?.damageSelfMitigated ?? null,
          damageToObjectives: seat.damage_to_objectives ?? facts?.damageToObjectives ?? null,
          damageTaken: facts?.damageTaken ?? null,
          longestLivedS: facts?.longestLivedS ?? null,
        } satisfies BuildSeat;
      }),
    };
  });

  return planChallenge({ dayKey: day, games: built, avoid });
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
        'game_id, player_id, side, role, champion_id, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives',
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

/**
 * What both games have to stay off: games used in the last three weeks and anybody who has
 * been the answer in the last week. **No `kind` filter, on purpose** — the two games share
 * one memory, or yesterday's Daily Mystery answers today's Guess the Award.
 */
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
