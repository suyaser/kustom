import { gameModeFromRaw, matchesQueue } from '../games/queue';
import type { PublicClient } from '../publicClient';
import { resultOfGame } from './load';
import type { ResultView } from './types';

/**
 * The group's newest finished game, whenever it was (M14.9): the idle page's "last result as a
 * compact poster". `null` means the group has never finished a game, which is the empty-group
 * page. Read with the anon key, like the rest of the page.
 */
export interface LastGame {
  gameId: string;
  /** ISO 8601, `games.started_at`. */
  startedAt: string;
  aram: boolean;
  result: ResultView;
  /** The chosen split's rank, for `pick #2`; `null` with no split. */
  rank: number | null;
}

export async function loadLastGame(client: PublicClient, groupId: string): Promise<LastGame | null> {
  const { data: game, error } = await client
    .from('games')
    .select('id, lobby_id, duration_s, winning_side, started_at, gameMode:raw->gameMode')
    .eq('group_id', groupId)
    .in('winning_side', [100, 200])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`tonight: last game lookup failed: ${error.message}`);
  if (game === null) return null;

  const [outcome, rank] = await Promise.all([
    resultOfGame(client, game, game.lobby_id),
    game.lobby_id === null ? Promise.resolve(null) : chosenRank(client, game.lobby_id),
  ]);
  if (outcome === null) return null;
  return {
    gameId: game.id,
    startedAt: game.started_at,
    aram: matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'aram'),
    result: outcome.result,
    rank,
  };
}

async function chosenRank(client: PublicClient, lobbyId: string): Promise<number | null> {
  const { data, error } = await client
    .from('splits')
    .select('rank')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .maybeSingle();
  if (error) throw new Error(`tonight: last game split lookup failed: ${error.message}`);
  return data?.rank ?? null;
}

/**
 * {@link loadLastGame}, and `undefined` on a failed read: not known, so the idle page shows no
 * poster **and** does not claim the group is empty (that is only `null`, a read that found none).
 */
export async function loadLastGameOrNone(
  client: PublicClient,
  groupId: string,
): Promise<LastGame | null | undefined> {
  try {
    return await loadLastGame(client, groupId);
  } catch (error) {
    console.error('tonight: reading the last game failed', error);
    return undefined;
  }
}
