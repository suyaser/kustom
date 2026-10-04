import type { ServiceClient } from '../supabase';
import { claimSetPuuids, holdsAdminRole } from './claimable';
import { LINK_ALREADY_LINKED, LINK_NOT_CLAIMABLE, LINK_TAKEN, UNKNOWN_PLAYER } from './copy';
import type { MeIdentity } from './identity';

/**
 * Picking yourself, once (M3.6, "Picking yourself, once").
 *
 * `players.discord_id` was set nowhere but the 1.0 players page, so without this every friend's
 * first role tap is blocked on somebody else doing a chore. Instead: a signed-in visitor who
 * matches no player row is shown **tonight's lobby members** — the rows the page is already
 * rendering — and picks themselves once. That writes their Discord id onto that player's row
 * and nothing else; from then on they are a linked player everywhere in the product.
 *
 * Three rules, and they are the whole security of it:
 *
 *   1. only a PUUID in the claim set may be claimed: tonight's lobby, or the ten of a game of
 *      this group that ended in the last 12 hours (M14.34, `claimable.ts`), so a friend cannot
 *      claim somebody who was not in the room with them that night;
 *   2. a player row that already carries a `discord_id` is never offered and a post naming one
 *      is refused (409) — including the race, which is why the write itself is conditional;
 *   3. a session that is already linked cannot claim a second player;
 *   4. an unlinked player who is an `owner` or `admin` of **any** group is never claimable
 *      (M14.26): the claim set asks nothing of the visitor, so without this a stranger could
 *      take the bootstrap owner's row before they self-link and walk in as owner. Admins and
 *      owners link through host pairing instead. The refusal is rule 1's 403 and sentence, so
 *      nothing tells a stranger *why* that name is out of reach, and `claimable.ts` leaves them
 *      off the list so the page never offers a tap that can only be refused.
 *
 * The repair is an admin's `Unlink Discord` in the member's Manage panel (M14.60,
 * `/api/admin/members/unlink-discord`, after M14.56 retired the 1.0 write): it sets
 * `players.discord_id` to null, and the visitor is asked once again.
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
  /**
   * The claim set (`claimable.ts`): tonight's lobby plus the ten of every game of the group that
   * ended in the last 12 hours, linked or not. Asked again here, never taken from the page.
   */
  claimSetPuuids(): Promise<Set<string>>;
  /**
   * The row and, in the same read, whether it holds an `owner` or `admin` membership in any group
   * (`holdsAdminRole`, rule 4).
   */
  findPlayerByPuuid(
    puuid: string,
  ): Promise<{ playerId: string; discordId: string | null; holdsAdminRole: boolean } | null>;
  /** Writes the link **only** while the row is still unlinked. */
  linkIfUnlinked(playerId: string, discordId: string): Promise<LinkWrite>;
}

/** Postgres `unique_violation`: `players_discord_id_key`, in the only place that can hit it. */
const UNIQUE_VIOLATION = '23505';

export async function linkSelf(store: SelfLinkStore, me: MeIdentity, puuid: string): Promise<SelfLinkResult> {
  // Asked once and never twice: a session that already has a player is not in this flow at
  // all, and the page does not draw the list for them.
  if (me.player !== null) return { ok: false, status: 409, error: LINK_ALREADY_LINKED };

  const claimSet = await store.claimSetPuuids();
  if (!claimSet.has(puuid)) return { ok: false, status: 403, error: LINK_NOT_CLAIMABLE };

  const player = await store.findPlayerByPuuid(puuid);
  if (player === null) return { ok: false, status: 404, error: UNKNOWN_PLAYER };
  if (player.discordId !== null) return { ok: false, status: 409, error: LINK_TAKEN };
  // Rule 4: the same 403 and sentence as a name outside the claim set, on purpose.
  if (player.holdsAdminRole) return { ok: false, status: 403, error: LINK_NOT_CLAIMABLE };

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
   * The group whose tonight lobby and recent games may be claimed out of (M13.4, M14.34): the
   * body's `groupId`. Only that group's lobbies and games are considered, so a visitor on group
   * A's page can never claim somebody out of group B's lobby or games.
   */
  groupId: string;
}

export function supabaseSelfLinkStore(
  client: ServiceClient,
  options: SupabaseSelfLinkOptions,
): SelfLinkStore {
  return {
    async claimSetPuuids() {
      // Resolved here rather than taken from the body: who may be claimed is not the caller's
      // to say. The same function the page's list is drawn from.
      return claimSetPuuids(client, options);
    },

    async findPlayerByPuuid(puuid) {
      const { data, error } = await client
        .from('players')
        .select('id, discord_id, group_memberships(role)')
        .eq('puuid', puuid)
        .maybeSingle();
      if (error) throw new Error(`self link: player lookup failed: ${error.message}`);
      if (!data) return null;
      return {
        playerId: data.id,
        discordId: data.discord_id,
        holdsAdminRole: holdsAdminRole(data.group_memberships),
      };
    },

    async linkIfUnlinked(playerId, discordId) {
      // Race note (M14.26): the role in rule 4 is read with the row, a moment before this write.
      // Only an admin can make an unlinked player an admin in between, and that admin could link
      // the row themselves, so the window grants a stranger nothing an admin did not just hand
      // over; the `discord_id is null` guard below still settles two claimants.
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
