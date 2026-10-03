import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';
import { LINK_ALREADY_LINKED, LINK_NOT_IN_LOBBY, LINK_TAKEN, UNKNOWN_PLAYER } from './copy';
import type { MeIdentity } from './identity';

/**
 * Picking yourself, once (M3.6, "Picking yourself, once").
 *
 * `players.discord_id` was set nowhere but `/admin/players`, so without this every friend's
 * first role tap is blocked on somebody else doing a chore. Instead: a signed-in visitor who
 * matches no player row is shown **tonight's lobby members** — the rows the page is already
 * rendering — and picks themselves once. That writes their Discord id onto that player's row
 * and nothing else; from then on they are a linked player everywhere in the product.
 *
 * Three rules, and they are the whole security of it:
 *
 *   1. only a member of tonight's lobby may be claimed, so a friend cannot claim somebody who
 *      is not in the room with them;
 *   2. a player row that already carries a `discord_id` is never offered and a post naming one
 *      is refused (409) — including the race, which is why the write itself is conditional;
 *   3. a session that is already linked cannot claim a second player.
 *
 * The repair path is unchanged and is an admin's: `/admin/players` clears the link, and the
 * visitor is asked once again.
 */

export type SelfLinkResult =
  | { ok: true; value: { puuid: string; playerId: string } }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * What the conditional write answered. Three outcomes and not a boolean, because the two
 * failures are two different sentences: somebody else has that player, or this session already
 * has one.
 */
export type LinkWrite = 'linked' | 'player taken' | 'session taken';

export interface SelfLinkStore {
  /** The players in tonight's newest non-`abandoned` lobby — exactly what the page shows. */
  tonightMemberPuuids(): Promise<Set<string>>;
  findPlayerByPuuid(puuid: string): Promise<{ playerId: string; discordId: string | null } | null>;
  /** Writes the link **only** while the row is still unlinked. */
  linkIfUnlinked(playerId: string, discordId: string): Promise<LinkWrite>;
}

/** Postgres `unique_violation`: `players_discord_id_key`, in the only place that can hit it. */
const UNIQUE_VIOLATION = '23505';

export async function linkSelf(store: SelfLinkStore, me: MeIdentity, puuid: string): Promise<SelfLinkResult> {
  // Asked once and never twice: a session that already has a player is not in this flow at
  // all, and the page does not draw the list for them.
  if (me.player !== null) return { ok: false, status: 409, error: LINK_ALREADY_LINKED };

  const members = await store.tonightMemberPuuids();
  if (!members.has(puuid)) return { ok: false, status: 403, error: LINK_NOT_IN_LOBBY };

  const player = await store.findPlayerByPuuid(puuid);
  if (player === null) return { ok: false, status: 404, error: UNKNOWN_PLAYER };
  if (player.discordId !== null) return { ok: false, status: 409, error: LINK_TAKEN };

  // Conditional on `discord_id is null`, so two friends tapping the same name in the same
  // second cannot both win. The loser reads the same sentence as the slow case above; a
  // session that turns out to hold a player already reads the sentence for that instead.
  const written = await store.linkIfUnlinked(player.playerId, me.discordId);
  if (written === 'player taken') return { ok: false, status: 409, error: LINK_TAKEN };
  if (written === 'session taken') return { ok: false, status: 409, error: LINK_ALREADY_LINKED };

  return { ok: true, value: { puuid, playerId: player.playerId } };
}

export interface SupabaseSelfLinkOptions {
  now?: Date;
  timeZone: string;
  /**
   * The group whose tonight lobby may be claimed out of (M13.4): the body's `groupId`. Only that
   * group's lobbies are considered, so a visitor on group A's page can never claim somebody out of
   * group B's lobby.
   */
  groupId: string;
}

export function supabaseSelfLinkStore(
  client: ServiceClient,
  options: SupabaseSelfLinkOptions,
): SelfLinkStore {
  return {
    async tonightMemberPuuids() {
      // The same lobby the page is rendering: the newest non-`abandoned` row of tonight
      // (`lib/tonight/load.ts`). Resolved here rather than taken from the body — which lobby
      // may be claimed out of is not the caller's to say.
      const since = nightStart(options.now ?? new Date(), options.timeZone).toISOString();
      const { data: lobby, error: lobbyError } = await client
        .from('lobbies')
        .select('id')
        .eq('group_id', options.groupId)
        .gte('created_at', since)
        .neq('status', 'abandoned')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lobbyError) throw new Error(`self link: lobby lookup failed: ${lobbyError.message}`);
      if (!lobby) return new Set();

      const { data, error } = await client
        .from('lobby_members')
        .select('players!inner(puuid)')
        .eq('lobby_id', lobby.id);
      if (error) throw new Error(`self link: member lookup failed: ${error.message}`);

      return new Set((data ?? []).map((row) => row.players.puuid));
    },

    async findPlayerByPuuid(puuid) {
      const { data, error } = await client
        .from('players')
        .select('id, discord_id')
        .eq('puuid', puuid)
        .maybeSingle();
      if (error) throw new Error(`self link: player lookup failed: ${error.message}`);
      if (!data) return null;
      return { playerId: data.id, discordId: data.discord_id };
    },

    async linkIfUnlinked(playerId, discordId) {
      const { data, error } = await client
        .from('players')
        .update({ discord_id: discordId })
        .eq('id', playerId)
        .is('discord_id', null)
        .select('id');
      // `players_discord_id_key`: this Discord account is already on **another** player row,
      // which is a 409 a friend can read and act on — not a 500. It is the same race the
      // `is('discord_id', null)` guard covers from the other side: that one is two people
      // claiming one player, this one is one person claiming two players (two tabs, or a link
      // an admin made between the page load and the tap).
      if (error !== null && error.code === UNIQUE_VIOLATION) return 'session taken';
      if (error) throw new Error(`self link: write failed: ${error.message}`);
      return (data ?? []).length > 0 ? 'linked' : 'player taken';
    },
  };
}
