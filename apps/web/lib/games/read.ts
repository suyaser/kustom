import { type Calibration, calibration } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { receiptSplitFromRow } from '@/components/receipt/model';
import type { StoredSplit } from '@/components/receipt/types';
import { mapChunks } from '../chunks';
import { readAssignments } from '../discord/assemble';
import type { PublicClient } from '../publicClient';
import type { PlayerName } from '../tonight/types';
import { gameModeFromRaw, matchesQueue } from './queue';
import { type CalibrationCandidate, calibrationGameOf } from './receipt';

/**
 * The reads the Games list and the game page share (M14.16), all with the anon key through RLS.
 * Every one is batched by `mapChunks` (chunks in parallel), so a page is a handful of round trips and never one per row,
 * and none selects `games.raw` whole except the one game page (champion names): the 1.0 list read
 * the blob for every game in the window, which is most of why it was 4.5 MB.
 */

/** One `game_players` row, as both pages read it. */
export interface ScoreRow {
  gameId: string;
  playerId: string;
  side: 100 | 200;
  role: RoleValue | null;
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
  /**
   * The all-time Kustom Ratings around the game (`r_before`, `r_after`, 0036), unrounded: the
   * printed change, the "did the fold rate it" mark, and the pre-game odds of a split-less game.
   * `null` on a game the all-time track did not rate.
   */
  rBefore: number | null;
  rAfter: number | null;
}

export async function readScoreRows(client: PublicClient, gameIds: readonly string[]): Promise<ScoreRow[]> {
  const rows: ScoreRow[] = [];
  for (const { data, error } of await mapChunks(gameIds, (chunk) =>
    client
      .from('game_players')
      .select(
        'game_id, player_id, side, role, champion_id, kills, deaths, assists, gold, damage_to_champs, cs, vision_score, damage_self_mitigated, damage_to_objectives, r_before, r_after',
      )
      .in('game_id', chunk),
  )) {
    if (error) throw new Error(`games: scoreboard lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.side !== 100 && row.side !== 200) continue;
      rows.push({
        gameId: row.game_id,
        playerId: row.player_id,
        side: row.side,
        role: row.role,
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
        rBefore: row.r_before,
        rAfter: row.r_after,
      });
    }
  }
  return rows;
}

export interface PlayerRef {
  playerId: string;
  puuid: string;
  name: PlayerName;
  mainRole: RoleValue | null;
}

/** `players_public` by id: the only players relation anon reads. */
export async function readPlayersById(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerRef>> {
  const players = new Map<string, PlayerRef>();
  for (const { data, error } of await mapChunks(playerIds, (chunk) =>
    client.from('players_public').select('id, puuid, display_name, game_name, main_role').in('id', chunk),
  )) {
    if (error) throw new Error(`games: player lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      players.set(row.id, {
        playerId: row.id,
        puuid: row.puuid,
        name: row.display_name ?? row.game_name ?? null,
        mainRole: row.main_role,
      });
    }
  }
  return players;
}

/** Names by puuid, for the people a stored split names who are not on the scoreboard. */
export async function readNamesByPuuid(
  client: PublicClient,
  puuids: readonly string[],
): Promise<Map<string, PlayerName>> {
  const names = new Map<string, PlayerName>();
  for (const { data, error } of await mapChunks(puuids, (chunk) =>
    client.from('players_public').select('puuid, display_name, game_name').in('puuid', chunk),
  )) {
    if (error) throw new Error(`games: name lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.puuid === null) continue;
      names.set(row.puuid, row.display_name ?? row.game_name ?? null);
    }
  }
  return names;
}

/**
 * Each lobby's **run**: the chosen split and the other ranks rolled with it (same `roster_key`),
 * as the receipt reads them. A lobby with no chosen split has no entry: history only trusts
 * `is_chosen`, so such a game is a split-less game (pre-game odds).
 */
export async function readSplitRuns(
  client: PublicClient,
  lobbyIds: readonly string[],
): Promise<Map<string, StoredSplit[]>> {
  const byLobby = new Map<string, { rosterKey: string; split: StoredSplit }[]>();
  for (const { data, error } of await mapChunks(lobbyIds, (chunk) =>
    client
      .from('splits')
      .select(
        'lobby_id, roster_key, rank, is_chosen, blue_win_prob, gap, off_role_count, blue, red, explanation',
      )
      .in('lobby_id', chunk),
  )) {
    if (error) throw new Error(`games: split lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const list = byLobby.get(row.lobby_id) ?? [];
      list.push({
        rosterKey: row.roster_key,
        split: receiptSplitFromRow({
          rank: row.rank,
          is_chosen: row.is_chosen,
          blue_win_prob: row.blue_win_prob,
          gap: row.gap,
          off_role_count: row.off_role_count,
          blue: readAssignments(row.blue),
          red: readAssignments(row.red),
          explanation: row.explanation,
        }),
      });
      byLobby.set(row.lobby_id, list);
    }
  }

  const runs = new Map<string, StoredSplit[]>();
  for (const [lobbyId, list] of byLobby) {
    const chosen = list.find((entry) => entry.split.isChosen);
    if (chosen === undefined) continue;
    runs.set(
      lobbyId,
      list
        .filter((entry) => entry.rosterKey === chosen.rosterKey)
        .map((entry) => entry.split)
        .sort((a, b) => a.rank - b.rank),
    );
  }
  return runs;
}

/** PostgREST answers at most a thousand rows a request. */
const PAGE = 1_000;

/**
 * The group's calibration line (STRATEGY §4.8): every game of the group that **could** qualify (it
 * has a lobby), whatever the page's filters, through {@link calibrationGameOf} and core's
 * `calibration`. Reads ids, sides and odds only; never `raw` (`game_mode`, 0039).
 */
export async function readGroupCalibration(client: PublicClient, groupId: string): Promise<Calibration> {
  const games: { id: string; lobbyId: string; winningSide: 100 | 200; aram: boolean }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('games')
      .select('id, lobby_id, winning_side, mode:game_mode')
      .eq('group_id', groupId)
      .not('lobby_id', 'is', null)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`games: calibration game lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.lobby_id === null || (row.winning_side !== 100 && row.winning_side !== 200)) continue;
      games.push({
        id: row.id,
        lobbyId: row.lobby_id,
        winningSide: row.winning_side,
        aram: !matchesQueue(gameModeFromRaw({ gameMode: row.mode }), 'sr'),
      });
    }
    if ((data ?? []).length < PAGE) break;
  }

  const rift = games.filter((game) => !game.aram);
  const chosen = new Map<string, NonNullable<CalibrationCandidate['chosen']>>();
  for (const { data, error } of await mapChunks(
    rift.map((game) => game.lobbyId),
    (chunk) =>
      client
        .from('splits')
        .select('lobby_id, blue, red, blue_win_prob, odds_model')
        .in('lobby_id', chunk)
        .eq('is_chosen', true)
        // M18.6: only odds made by the function the line checks (`winProbability`) count, so the
        // line restarts at `0 of 20` at the switch (05-design 11.7).
        .eq('odds_model', 'kustom'),
  )) {
    if (error) throw new Error(`games: calibration split lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      chosen.set(row.lobby_id, {
        blue: readAssignments(row.blue),
        red: readAssignments(row.red),
        blueWinProb: row.blue_win_prob,
        oddsModel: row.odds_model === 'kustom' ? 'kustom' : 'openskill',
      });
    }
  }

  const candidates = rift.filter((game) => chosen.has(game.lobbyId));
  const seatsByGame = new Map<string, { playerId: string; side: 100 | 200; rated: boolean }[]>();
  for (const { data, error } of await mapChunks(
    candidates.map((game) => game.id),
    (chunk) => client.from('game_players').select('game_id, player_id, side, r_after').in('game_id', chunk),
  )) {
    if (error) throw new Error(`games: calibration seat lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.side !== 100 && row.side !== 200) continue;
      const seats = seatsByGame.get(row.game_id) ?? [];
      seats.push({ playerId: row.player_id, side: row.side, rated: row.r_after !== null });
      seatsByGame.set(row.game_id, seats);
    }
  }

  const players = await readPlayersById(
    client,
    [...seatsByGame.values()].flatMap((seats) => seats.map((seat) => seat.playerId)),
  );

  const counted = [];
  for (const game of candidates) {
    const seats = seatsByGame.get(game.id) ?? [];
    const candidate: CalibrationCandidate = {
      aram: game.aram,
      winningSide: game.winningSide,
      rated: seats.length > 0 && seats.every((seat) => seat.rated),
      seats: seats.map((seat) => ({
        // An id no `players_public` row names cannot match a split's puuid, so the game drops out.
        puuid: players.get(seat.playerId)?.puuid ?? `id:${seat.playerId}`,
        side: seat.side,
        rBefore: null,
      })),
      chosen: chosen.get(game.lobbyId) ?? null,
    };
    const entry = calibrationGameOf(candidate);
    if (entry !== null) counted.push(entry);
  }
  return calibration(counted);
}
