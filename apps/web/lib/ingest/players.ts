import type { PlayerInsert, PlayerUpdate } from '@customs/db';
import { invalidateNames } from '../cache/tags';
import type { ServiceClient } from '../supabase';

/**
 * Lazy player creation. A `players` row appears the first time a PUUID shows up in a lobby,
 * a game or a rank report (`docs/01-architecture.md` "Data model") — there is no sign-up.
 *
 * PUUID is the identity. Riot IDs and summoner ids are display data: refreshed when the
 * client reports them, never used to match a row and never overwritten with null.
 *
 * `display_name` (M1.7) is the name the group reads on every surface. It follows the Riot
 * `gameName` automatically until an admin overrides it, and goes back on automatic when the
 * admin clears the override — see `isDisplayNameAutomatic`.
 */

export interface PlayerIdentityInput {
  puuid: string;
  summonerId?: string | null;
  gameName?: string | null;
  tagLine?: string | null;
}

/** PUUID to `players.id`, for every PUUID passed in. */
export type PlayerIdsByPuuid = ReadonlyMap<string, string>;

export interface EnsurePlayersOptions {
  /**
   * **Fill, never patch** (M5.1 review). A player the database has never met is created with
   * the names given; a row that already exists is not touched at all — not its `game_name`,
   * not its `tag_line`, not its automatic `display_name`, not its `summoner_id`.
   *
   * Backfill is the caller. A match detail carries the Riot ID as it was **when the game was
   * played**, so the ordinary refresh below would walk a friend's name backwards: the walker
   * goes newest-first, so the *oldest* game in the batch wins, and a second friend's
   * overlapping backfill does it again the next day. The names in old history are not news
   * about who somebody is now.
   *
   * The good half of backfill's names survives: the commonest outcome is a friend who has
   * never been in a lobby with a companion running, and they still get a row **and** a name,
   * because that name arrives on the insert.
   */
  fillOnly?: boolean;
  /**
   * Called once for every existing row this call refreshed (a Riot ID, tag line or summoner id
   * that moved). Lobby and game ingest use it to know whether the post wrote anything (M19.8,
   * M19.9): a rename is a change Tonight prints, a repeated post is not. New rows are not
   * reported here; a new player always arrives with a new `lobby_members` or `game_players` row,
   * which the caller already counts.
   */
  onRefresh?: () => void;
}

/**
 * Creates the missing rows, refreshes changed display data, and returns the id of every
 * PUUID given. Safe to run concurrently: the insert is `on conflict do nothing`.
 *
 * `options.fillOnly` turns the refresh off; see {@link EnsurePlayersOptions}.
 */
export async function ensurePlayers(
  client: ServiceClient,
  inputs: readonly PlayerIdentityInput[],
  options: EnsurePlayersOptions = {},
): Promise<PlayerIdsByPuuid> {
  const wanted = mergeByPuuid(inputs);
  if (wanted.size === 0) return new Map();

  const puuids = [...wanted.keys()];

  // Read first, insert only who is missing (M19.8): a repeated post of a known roster is one
  // select and no write request at all, not an insert that conflicts on every row.
  const known = await selectPlayers(client, puuids);
  const seen = new Set(known.map((row) => row.puuid));
  const missing = puuids.filter((puuid) => !seen.has(puuid));

  let created: PlayerRow[] = [];
  if (missing.length > 0) {
    // A new row is created with everything the client just told us, `display_name` included:
    // on creation the display name *is* the reported `gameName` (null when none was reported,
    // e.g. a PUUID first seen in an eog block). Existing rows are untouched here, and a row a
    // concurrent request created a moment ago is too (`on conflict do nothing`, read back below).
    const inserts: PlayerInsert[] = missing.map((puuid) => {
      const input = wanted.get(puuid);
      return {
        puuid,
        summoner_id: input?.summonerId ?? null,
        game_name: input?.gameName ?? null,
        tag_line: input?.tagLine ?? null,
        display_name: input?.gameName ?? null,
      };
    });
    const { error: insertError } = await client
      .from('players')
      .upsert(inserts, { onConflict: 'puuid', ignoreDuplicates: true });
    if (insertError) {
      throw new Error(`ensurePlayers: insert failed: ${insertError.message}`);
    }
    created = await selectPlayers(client, missing);
  }

  const ids = new Map<string, string>();
  for (const row of [...known, ...created]) {
    ids.set(row.puuid, row.id);

    const input = wanted.get(row.puuid);
    if (!input) continue;
    // Fill-only: this row already existed, so nothing about it is this caller's business.
    if (options.fillOnly) continue;

    // Only fields the client actually reported, and only when they changed, so a repeated
    // post of the same roster writes nothing at all.
    const patch: PlayerUpdate = {};
    if (input.summonerId != null && input.summonerId !== row.summoner_id) {
      patch.summoner_id = input.summonerId;
    }
    if (input.gameName != null) {
      if (input.gameName !== row.game_name) patch.game_name = input.gameName;
      // The Riot ID moved: carry the display name with it, but only while nobody has
      // overridden it. An admin's name survives every rename after it.
      if (isDisplayNameAutomatic(row) && input.gameName !== row.display_name) {
        patch.display_name = input.gameName;
      }
    }
    if (input.tagLine != null && input.tagLine !== row.tag_line) patch.tag_line = input.tagLine;
    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await client.from('players').update(patch).eq('id', row.id);
    if (updateError) {
      throw new Error(`ensurePlayers: refresh of ${row.puuid} failed: ${updateError.message}`);
    }
    options.onRefresh?.();
    // A rename (or a moved tag line, which the same-name labels read) reaches every cached slice
    // that prints a name, in every group (performance plan, phase 2; `lib/cache/tags.ts`).
    if ('game_name' in patch || 'display_name' in patch || 'tag_line' in patch) invalidateNames();
  }

  const absent = puuids.filter((puuid) => !ids.has(puuid));
  if (absent.length > 0) {
    throw new Error(`ensurePlayers: ${absent.length} puuid(s) missing after insert`);
  }

  return ids;
}

/** A `players` row as {@link ensurePlayers} compares it with what the client reported. */
interface PlayerRow {
  id: string;
  puuid: string;
  summoner_id: string | null;
  game_name: string | null;
  tag_line: string | null;
  display_name: string | null;
}

async function selectPlayers(client: ServiceClient, puuids: readonly string[]): Promise<PlayerRow[]> {
  const { data, error } = await client
    .from('players')
    .select('id, puuid, summoner_id, game_name, tag_line, display_name')
    .in('puuid', [...puuids]);
  if (error) {
    throw new Error(`ensurePlayers: select failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * "Nobody has overridden this name." True while `display_name` still equals the `gameName` we
 * stored last time, and true when it is null — clearing the admin field posts `""`, stores
 * null, and that is how a row is put back on automatic (M1.7).
 */
export function isDisplayNameAutomatic(row: {
  game_name: string | null;
  display_name: string | null;
}): boolean {
  return row.display_name === null || row.display_name === row.game_name;
}

/**
 * The same PUUID can appear twice in one payload (a client quirk, or a spectator listed
 * again). Merge instead of failing, preferring the last non-null value for each field.
 */
function mergeByPuuid(inputs: readonly PlayerIdentityInput[]): Map<string, PlayerIdentityInput> {
  const merged = new Map<string, PlayerIdentityInput>();
  for (const input of inputs) {
    const previous = merged.get(input.puuid);
    merged.set(input.puuid, {
      puuid: input.puuid,
      summonerId: input.summonerId ?? previous?.summonerId ?? null,
      gameName: input.gameName ?? previous?.gameName ?? null,
      tagLine: input.tagLine ?? previous?.tagLine ?? null,
    });
  }
  return merged;
}
