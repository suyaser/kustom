import type { RoleValue } from '@customs/db';
import { gameModeFromRaw, matchesQueue } from '../games/queue';
import { formatNightLabel, nightStart } from '../night';
import type { PublicClient } from '../publicClient';
import { resultOfGame } from '../tonight/load';
import type { ResultView } from '../tonight/types';

/**
 * One stored game, for `/g/[gameId]` and its card (M11.4). Read with the anon key through the
 * same `resultOfGame` the tonight page's result block uses, so the poster on this page has the
 * odds, MVP and deltas it had on the night.
 */
export interface GamePageView {
  gameId: string;
  /** `Tuesday 22 September`: the night the game was played, from its `started_at`. */
  nightLabel: string;
  aram: boolean;
  result: ResultView;
  /** The chosen split's stored `splits.explanation`, verbatim, or `null` with no split. */
  explanation: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `games.id` is a uuid; anything else is a 404 before it reaches Postgres, which would 400 on it. */
export function isGameId(value: string): boolean {
  return UUID.test(value);
}

export async function loadGamePage(
  client: PublicClient,
  gameId: string,
  timeZone: string,
): Promise<GamePageView | null> {
  if (!isGameId(gameId)) return null;

  const { data: game, error } = await client
    .from('games')
    .select('id, lobby_id, duration_s, winning_side, started_at, raw->gameMode')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw new Error(`og: game lookup failed: ${error.message}`);
  if (!game) return null;

  const loaded = await resultOfGame(client, game, game.lobby_id);
  if (loaded === null) return null;

  const started = new Date(game.started_at);
  return {
    gameId: game.id,
    nightLabel: formatNightLabel(nightStart(started, timeZone), timeZone),
    aram: matchesQueue(gameModeFromRaw({ gameMode: game.gameMode }), 'aram'),
    result: loaded.result,
    explanation: loaded.explanation,
  };
}

/** `players_public`'s two role columns for one player, for the card's `main · backup` line. */
export async function loadPlayerRoles(
  client: PublicClient,
  puuid: string,
): Promise<{ main: RoleValue | null; backup: RoleValue | null }> {
  const { data, error } = await client
    .from('players_public')
    .select('main_role, secondary_role')
    .eq('puuid', puuid)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`og: player role lookup failed: ${error.message}`);
  return { main: data?.main_role ?? null, backup: data?.secondary_role ?? null };
}
