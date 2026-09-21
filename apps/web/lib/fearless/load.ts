import type { RoleValue, SideValue } from '@customs/db';
import { championName } from '../champs/names';
import { gameModeFromRaw } from '../games/queue';
import type { PublicClient } from '../publicClient';
import { foldFearless } from './fold';
import { presentFearless } from './present';
import { EMPTY_FEARLESS, FEARLESS_MAX_GAMES, FEARLESS_STATE_ID, type FearlessView } from './types';

/**
 * The fearless pool, read with whichever client the caller already has (M10).
 *
 * Tonight uses the **anon key**; the Discord post and the admin reset use the service role.
 * Both see the same row: RLS lets anon select `fearless_state`, and the pool itself is a
 * join over `games` / `game_players`, which are already public. A failed read logs and
 * returns {@link EMPTY_FEARLESS} so the tonight page never 500s over a ban list.
 */

interface StateRow {
  reset_at: string;
}

interface PlayerRow {
  player_id: string;
  side: SideValue;
  champion_id: number | null;
  role: RoleValue | null;
}

interface GameRow {
  id: string;
  started_at: string;
  duration_s: number;
  raw: unknown;
  game_players: PlayerRow[] | PlayerRow | null;
}

export async function loadFearless(client: PublicClient): Promise<FearlessView> {
  const { data: state, error: stateError } = await client
    .from('fearless_state')
    .select('reset_at')
    .eq('id', FEARLESS_STATE_ID)
    .maybeSingle();

  if (stateError) {
    console.error('fearless: reading the cursor failed', stateError.message);
    return EMPTY_FEARLESS;
  }

  const resetAt = (state as StateRow | null)?.reset_at ?? null;
  if (resetAt === null) return EMPTY_FEARLESS;

  const { data: rows, error: gamesError } = await client
    .from('games')
    .select('id, started_at, duration_s, raw, game_players(player_id, side, champion_id, role)')
    .gt('started_at', resetAt)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(FEARLESS_MAX_GAMES);

  if (gamesError) {
    console.error('fearless: reading games since the cursor failed', gamesError.message);
    return { champions: [], resetAt };
  }

  const picks = foldFearless(
    ((rows ?? []) as GameRow[]).map((row) => ({
      durationS: row.duration_s,
      gameMode: gameModeFromRaw(row.raw),
      players: asPlayers(row.game_players).map((player) => ({
        puuid: player.player_id,
        side: player.side,
        championId: player.champion_id,
        role: player.role,
      })),
    })),
  );

  return {
    resetAt,
    champions: presentFearless(picks, championName),
  };
}

function asPlayers(value: GameRow['game_players']): PlayerRow[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
