import { type GroupRole, groupRoleSchema, isAtLeast } from '@customs/db/schemas';
import { NOT_A_GROUP_ADMIN } from '../adminAuth';
import type { ServiceClient } from '../supabase';
import { ONLY_OWNER_UNLINKS_OWNER, OWNER_UNLINKS_SELF } from './homeCopy';
import { NO_SUCH_MEMBER, ONLY_OWNER } from './members';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * `Unlink Discord` (M14.60): undo a Discord account linked to the wrong player -- a mistaken
 * `That's me` (`/api/me/link`) -- now that `POST /api/admin/players` is gone (M14.56). Clears
 * `players.discord_id` and nothing else: the player's ratings, games and memberships stay. A member
 * links again by tapping their name (`That's me`); an admin is never offered that tap (M14.26) and
 * pairs Kustom again with a code from the group's invite link, which keeps their role.
 *
 * **A Discord link belongs to the player**, not to a membership, so unlinking reaches every group
 * the player is in. The confirm says so.
 *
 * The rules mirror remove and demote (`lib/admin/members.ts`, `0023`):
 *
 * | actor \ target | owner                       | another admin                      | member | themselves |
 * |----------------|-----------------------------|------------------------------------|--------|------------|
 * | owner          | (themselves)                | yes                                | yes    | 403 OWNER_UNLINKS_SELF |
 * | admin          | 403 ONLY_OWNER_UNLINKS_OWNER | 403 ONLY_OWNER (yes if no owner yet) | yes    | yes        |
 *
 * The rule is checked here, from one read of the group's memberships, not inside a `security
 * definer` function under the group's row lock as remove/demote are. Accepted (decision row,
 * M14.60): the worst a race can do is let an admin demoted in the same second unlink one Discord
 * account, which its player undoes by linking again; no rating, game or membership can move. Not
 * worth a migration.
 */

/** The 403 sentences. Client-safe copy lives in `homeCopy` so the confirm can show them. */
export { ONLY_OWNER_UNLINKS_OWNER, OWNER_UNLINKS_SELF };

/** The success notice, for a form post. [NEW COPY] */
export const DISCORD_UNLINKED = 'Discord unlinked.';

export type UnlinkVerdict = 'ok' | 'not_member' | 'forbidden' | 'owner_only' | 'is_owner' | 'owner_self';

/**
 * Pure: may `actorRole` unlink the Discord of a member with `targetRole`? `targetRole` null means
 * the player is not a member of this group (a 404, never a 403: an admin of A must not learn who is
 * in B). `groupHasOwner` false is M13.4's ownerless group, where admins manage admins.
 */
export function unlinkVerdict(input: {
  actorRole: GroupRole | null;
  targetRole: GroupRole | null;
  self: boolean;
  groupHasOwner: boolean;
}): UnlinkVerdict {
  if (input.targetRole === null) return 'not_member';
  if (!isAtLeast(input.actorRole, 'admin')) return 'forbidden';
  // Lead's ruling (round 2): the owner hands ownership on before unlinking themselves, so a group is
  // never left with an owner nobody can sign in as.
  if (input.self) return input.actorRole === 'owner' ? 'owner_self' : 'ok';
  if (input.actorRole === 'owner') return 'ok';
  if (input.targetRole === 'owner') return 'is_owner';
  // The owner is answered above, so admin-or-above here is another admin.
  if (isAtLeast(input.targetRole, 'admin') && input.groupHasOwner) return 'owner_only';
  return 'ok';
}

/** The two things the write needs from the database, injectable for the route's unit tests. */
export interface UnlinkDiscordStore {
  /** The roles of `playerIds` in the group (absent: not a member), and whether it has an owner. */
  memberships(
    groupId: string,
    playerIds: readonly string[],
  ): Promise<{ roles: ReadonlyMap<string, GroupRole>; hasOwner: boolean }>;
  /** Sets `players.discord_id` to null. True when it was set before (a row changed). */
  clearDiscordId(playerId: string): Promise<boolean>;
}

export function supabaseUnlinkDiscordStore(client: ServiceClient): UnlinkDiscordStore {
  return {
    async memberships(groupId, playerIds) {
      // Both ids are uuids already: the actor from the session's player row, the target from zod.
      const { data, error } = await client
        .from('group_memberships')
        .select('player_id, role')
        .eq('group_id', groupId)
        .or(`player_id.in.(${playerIds.join(',')}),role.eq.owner`);
      if (error) throw new Error(`unlinkDiscord: reading memberships failed: ${error.message}`);
      const roles = new Map<string, GroupRole>();
      let hasOwner = false;
      for (const row of data ?? []) {
        // A role the union does not know (a hand-edited row) grants nothing.
        const role = groupRoleSchema.safeParse(row.role);
        if (!role.success) continue;
        if (role.data === 'owner') hasOwner = true;
        if (playerIds.includes(row.player_id)) roles.set(row.player_id, role.data);
      }
      return { roles, hasOwner };
    },
    async clearDiscordId(playerId) {
      const { data, error } = await client
        .from('players')
        .update({ discord_id: null })
        .eq('id', playerId)
        .not('discord_id', 'is', null)
        .select('id');
      if (error) throw new Error(`unlinkDiscord: clearing discord_id failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

export interface UnlinkDiscordInput {
  groupId: string;
  /** The session's player, as the admin gate resolved it. Never an id from the body. */
  actorId: string;
  playerId: string;
}

export async function unlinkMemberDiscord(
  store: UnlinkDiscordStore,
  input: UnlinkDiscordInput,
): Promise<AdminWriteResult<{ playerId: string; changed: boolean }>> {
  const { roles, hasOwner } = await store.memberships(input.groupId, [input.actorId, input.playerId]);
  const verdict = unlinkVerdict({
    actorRole: roles.get(input.actorId) ?? null,
    targetRole: roles.get(input.playerId) ?? null,
    self: input.actorId === input.playerId,
    groupHasOwner: hasOwner,
  });
  switch (verdict) {
    case 'not_member':
      return writeFailed(404, NO_SUCH_MEMBER);
    case 'forbidden':
      return writeFailed(403, NOT_A_GROUP_ADMIN);
    case 'is_owner':
      return writeFailed(403, ONLY_OWNER_UNLINKS_OWNER);
    case 'owner_only':
      return writeFailed(403, ONLY_OWNER);
    case 'owner_self':
      return writeFailed(403, OWNER_UNLINKS_SELF);
    case 'ok': {
      const changed = await store.clearDiscordId(input.playerId);
      if (changed) {
        // The admin log there is: one line per write, ids only (never the Discord id itself).
        console.info(
          `admin ${input.actorId} unlinked the Discord of player ${input.playerId} (group ${input.groupId})`,
        );
      }
      return writeOk({ playerId: input.playerId, changed });
    }
  }
}
