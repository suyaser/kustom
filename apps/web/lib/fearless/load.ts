import type { RoleValue, SideValue } from '@customs/db';
import { championName, isRosterChampion } from '../champs/names';
import { inChunks } from '../chunks';
import { gameModeFromRaw } from '../games/queue';
import type { PublicClient } from '../publicClient';
import { foldFearless } from './fold';
import { presentFearless, storedChampionNames } from './present';
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

  const games = (rows ?? []) as GameRow[];
  const picks = foldFearless(
    games.map((row) => ({
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
    champions: presentFearless(picks, championName, await clientNames(client, games, picks)),
  };
}

/**
 * The client's own name for every pooled id the roster table cannot name — the champion
 * released after `lib/champs/names.ts` was last edited — so the chip says `Yunara` with her
 * icon and not `Champion 804` with none. Same source `/games` prints from (`championLabel`
 * over `rawFactsFromUnknown(...).byPuuid[puuid].championName`).
 *
 * **Free on an ordinary night**: with every id on the roster it returns before any read. When
 * it does read, it is one `players_public` lookup by the seats that locked those ids (the
 * blob is keyed by puuid and `game_players` by player id), and a failure logs and keeps the
 * `Champion ${id}` fallback rather than emptying the card.
 */
async function clientNames(
  client: PublicClient,
  games: readonly GameRow[],
  picks: readonly { id: number }[],
): Promise<Map<number, string>> {
  const wanted = new Set(picks.map((pick) => pick.id).filter((id) => !isRosterChampion(id)));
  if (wanted.size === 0) return new Map();

  const playerIds = games.flatMap((row) =>
    asPlayers(row.game_players)
      .filter((player) => player.champion_id !== null && wanted.has(player.champion_id))
      .map((player) => player.player_id),
  );
  const puuidOf = new Map<string, string>();
  for (const chunk of inChunks(playerIds)) {
    const { data, error } = await client.from('players_public').select('id, puuid').in('id', chunk);
    if (error) {
      console.error('fearless: reading puuids for champion names failed', error.message);
      return new Map();
    }
    for (const row of data ?? []) {
      if (row.id !== null && row.puuid !== null) puuidOf.set(row.id, row.puuid);
    }
  }

  return storedChampionNames(
    games.map((row) => ({
      raw: row.raw,
      seats: asPlayers(row.game_players).map((player) => ({
        puuid: puuidOf.get(player.player_id) ?? null,
        championId: player.champion_id,
      })),
    })),
    wanted,
  );
}

function asPlayers(value: GameRow['game_players']): PlayerRow[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
