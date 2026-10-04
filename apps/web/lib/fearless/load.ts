import type { RoleValue, SideValue } from '@customs/db';
import { type GroupMode, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { championName, isRosterChampion } from '../champs/names';
import { mapChunks } from '../chunks';
import { gameModeFromRaw } from '../games/queue';
import { loadGroupModeState } from '../mode/load';
import type { PublicClient } from '../publicClient';
import { foldFearless } from './fold';
import { presentFearless, storedChampionNames } from './present';
import { EMPTY_FEARLESS, FEARLESS_MAX_GAMES, type FearlessPool } from './types';

/**
 * The fearless pool, read with whichever client the caller already has (M10).
 *
 * Tonight uses the **anon key**; the Discord post and the admin reset use the service role.
 * Both see the same row: RLS lets anon select `fearless_state` (every column but `reset_by` since
 * `0029`, M14.40, so name the columns; `select('*')` with the anon key is a 42501), and the pool itself is a
 * join over `games` / `game_players`, which are already public. A failed read logs and
 * returns an empty pool so the tonight page never 500s over a ban list.
 *
 * **One pool per group** (M13.3): the group's own `fearless_state` row (one per group since
 * `0019`) and the group's own games after its `reset_at`. A group with no row yet has an empty
 * pool, not another group's. `groupId` defaults to the original group for the pages that do not
 * pass one yet (they move with M13.9 to M13.14); every ingest-side caller passes it.
 *
 * **The one pool read** (M14.29): only games stamped `games.mode = 'fearless'` count, so a game
 * recorded while the group was on Normal never joins the list, and the view carries the group's
 * standing `mode`. Tonight, the Discord post, the reset and the overlay all read this; none of them
 * re-implements the rule. In Normal the pool is still read (it is the paused list, which the Mode
 * card counts); whether to show it as bans is the caller's `isFearlessMode(view.mode)`.
 */

/** The `games.mode` stamp that puts a game in the pool. */
const FEARLESS_GAME_MODE: GroupMode = 'fearless';

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
  /** `raw->>gameMode` only: the blob is read whole just for the few games `clientNames` needs. */
  gameMode: string | null;
  game_players: PlayerRow[] | PlayerRow | null;
}

export async function loadFearless(
  client: PublicClient,
  groupId: string = ORIGINAL_GROUP_ID,
  options: {
    /**
     * The standing mode when the caller reads `group_modes` itself (Tonight reads the row once for
     * the pool and the card, `loadModeFacts`). Absent: read here.
     */
    modeState?: Promise<{ mode: GroupMode; since: string | null }>;
  } = {},
): Promise<FearlessPool> {
  const [{ data: state, error: stateError }, modeState] = await Promise.all([
    client.from('fearless_state').select('reset_at').eq('group_id', groupId).maybeSingle(),
    options.modeState ?? loadGroupModeState(client, groupId),
  ]);
  const { mode, since: modeSince } = modeState;

  if (stateError) {
    console.error('fearless: reading the cursor failed', stateError.message);
    return { ...EMPTY_FEARLESS, mode, modeSince };
  }

  const resetAt = (state as StateRow | null)?.reset_at ?? null;
  if (resetAt === null) return { ...EMPTY_FEARLESS, mode, modeSince };

  const { data: rows, error: gamesError } = await client
    .from('games')
    .select(
      'id, started_at, duration_s, gameMode:raw->>gameMode, game_players(player_id, side, champion_id, role)',
    )
    .eq('group_id', groupId)
    // M14.29: the mode in force when the game was recorded. Normal games never join the pool.
    .eq('mode', FEARLESS_GAME_MODE)
    // M15.3 (R4): only rated games feed the pool. A not-rated class or region game adds nothing;
    // a rated mirror game under standing Fearless adds its champions like any game.
    .eq('rated', true)
    .gt('started_at', resetAt)
    .order('started_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(FEARLESS_MAX_GAMES);

  if (gamesError) {
    console.error('fearless: reading games since the cursor failed', gamesError.message);
    return { mode, modeSince, champions: [], resetAt };
  }

  const games = (rows ?? []) as GameRow[];
  const picks = foldFearless(
    games.map((row) => ({
      id: row.id,
      durationS: row.duration_s,
      gameMode: gameModeFromRaw({ gameMode: row.gameMode }),
      players: asPlayers(row.game_players).map((player) => ({
        puuid: player.player_id,
        side: player.side,
        championId: player.champion_id,
        role: player.role,
      })),
    })),
  );

  return {
    mode,
    modeSince,
    resetAt,
    games: games.length,
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

  const seatsOf = (row: GameRow) =>
    asPlayers(row.game_players).filter(
      (player) => player.champion_id !== null && wanted.has(player.champion_id),
    );
  const named = games.filter((row) => seatsOf(row).length > 0);
  const playerIds = named.flatMap((row) => seatsOf(row).map((player) => player.player_id));
  // The blobs of only the games that locked one of those ids (app-perf: the pool read itself
  // carries `raw->>gameMode`, never the blob), beside the puuids.
  const [people, blobs] = await Promise.all([
    mapChunks(playerIds, (chunk) => client.from('players_public').select('id, puuid').in('id', chunk)),
    mapChunks(
      named.map((row) => row.id),
      (chunk) => client.from('games').select('id, raw').in('id', chunk),
    ),
  ]);
  const puuidOf = new Map<string, string>();
  const rawOf = new Map<string, unknown>();
  for (const { data, error } of people) {
    if (error) {
      console.error('fearless: reading puuids for champion names failed', error.message);
      return new Map();
    }
    for (const row of data ?? []) {
      if (row.id !== null && row.puuid !== null) puuidOf.set(row.id, row.puuid);
    }
  }
  for (const { data, error } of blobs) {
    if (error) {
      console.error('fearless: reading games for champion names failed', error.message);
      return new Map();
    }
    for (const row of data ?? []) rawOf.set(row.id, row.raw);
  }

  return storedChampionNames(
    named.map((row) => ({
      raw: rawOf.get(row.id) ?? null,
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
