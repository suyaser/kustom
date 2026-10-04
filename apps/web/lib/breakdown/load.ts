import type { DeltaReason } from '@customs/core';
import type { SideValue } from '@customs/db';
import { inChunks } from '../chunks';
import type { PublicClient } from '../publicClient';
import {
  BREAKDOWN_COLUMNS,
  type BreakdownGame,
  type RawBreakdownRow,
  type ResultOdds,
  resultOdds,
  rowReason,
  toBreakdownRow,
} from './read';

/**
 * The read the game page, the Tonight poster and any other per-game surface calls for M14.58's
 * tap-to-explain and M14.59's result line (the web half lands after M15.5 and M16.4). Anon key,
 * through the existing `game_players` policy; the four `0034` columns are public game facts.
 */
export interface GameBreakdown {
  gameId: string;
  /** The result line's two odds and whether they differ (M14.59); `null` with neither number. */
  odds: ResultOdds | null;
  /**
   * Each player's reason, keyed by **puuid** (the key every page renders on), `null` for a row
   * with no change to explain. A player missing from the map has no row in the game.
   */
  reasons: ReadonlyMap<string, DeltaReason | null>;
}

/**
 * One {@link GameBreakdown} per game id that exists and has a winner; ids that do not are absent.
 * Three reads, chunked: the games, their `game_players` rows (with the breakdown), and the
 * players' puuids; plus the chosen split of any game the bot picked.
 */
export async function loadGameBreakdowns(
  client: PublicClient,
  gameIds: readonly string[],
): Promise<Map<string, GameBreakdown>> {
  const out = new Map<string, GameBreakdown>();
  if (gameIds.length === 0) return out;

  const games = new Map<string, { winningSide: SideValue; lobbyId: string | null }>();
  const rows = new Map<string, RawBreakdownRow[]>();
  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client.from('games').select('id, winning_side, lobby_id').in('id', chunk);
    if (error) throw new Error(`breakdown: game lookup failed: ${error.message}`);
    for (const game of data ?? []) {
      if (game.winning_side !== 100 && game.winning_side !== 200) continue;
      games.set(game.id, { winningSide: game.winning_side, lobbyId: game.lobby_id });
    }

    const { data: players, error: playersError } = await client
      .from('game_players')
      .select(`game_id, ${BREAKDOWN_COLUMNS}`)
      .in('game_id', chunk);
    if (playersError) throw new Error(`breakdown: game player lookup failed: ${playersError.message}`);
    for (const row of players ?? []) {
      const list = rows.get(row.game_id) ?? [];
      list.push(row);
      rows.set(row.game_id, list);
    }
  }

  const lobbyIds = [...games.values()].flatMap((game) => (game.lobbyId === null ? [] : [game.lobbyId]));
  const botOdds = await loadChosenBlueWinProbs(client, lobbyIds);
  const puuids = await loadPuuids(
    client,
    [...rows.values()].flatMap((list) => list.map((row) => row.player_id)),
  );

  for (const [gameId, game] of games) {
    const breakdownGame: BreakdownGame = {
      winningSide: game.winningSide,
      botBlueWinProb: game.lobbyId === null ? null : (botOdds.get(game.lobbyId) ?? null),
      rows: (rows.get(gameId) ?? []).map(toBreakdownRow),
    };
    const reasons = new Map<string, DeltaReason | null>();
    for (const row of breakdownGame.rows) {
      const puuid = puuids.get(row.playerId);
      if (puuid !== undefined) reasons.set(puuid, rowReason(breakdownGame, row.playerId));
    }
    out.set(gameId, { gameId, odds: resultOdds(breakdownGame), reasons });
  }
  return out;
}

/** The chosen split's `blue_win_prob` per lobby: the bot's claim (M14.59). */
async function loadChosenBlueWinProbs(
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
    if (error) throw new Error(`breakdown: split lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.blue_win_prob !== null) odds.set(row.lobby_id, row.blue_win_prob);
    }
  }
  return odds;
}

async function loadPuuids(client: PublicClient, playerIds: readonly string[]): Promise<Map<string, string>> {
  const puuids = new Map<string, string>();
  for (const chunk of inChunks([...new Set(playerIds)])) {
    const { data, error } = await client.from('players_public').select('id, puuid').in('id', chunk);
    if (error) throw new Error(`breakdown: player lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.id !== null && row.puuid !== null) puuids.set(row.id, row.puuid);
    }
  }
  return puuids;
}

/**
 * {@link loadGameBreakdowns} for one game, or `null` when the read fails or the game has no
 * winner. A page's explanation is an extra (M14.58): a failed read leaves the change as a plain
 * number and the page still renders, as the other `…OrNone` reads do.
 */
export async function loadGameBreakdownOrNone(
  client: PublicClient,
  gameId: string,
): Promise<GameBreakdown | null> {
  try {
    return (await loadGameBreakdowns(client, [gameId])).get(gameId) ?? null;
  } catch (error) {
    console.error(`breakdown: the breakdown read for game ${gameId} failed`, error);
    return null;
  }
}
