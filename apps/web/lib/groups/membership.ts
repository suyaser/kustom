import { type GroupRole, groupIdSchema, groupRoleSchema } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * Who is what in which group (M13.4), for the session routes.
 *
 * A signed-in person can be in several groups, so a session alone never says what they may do:
 * every `/api/me/*` and `/api/admin/*` request names a `groupId` and the answer is the
 * `group_memberships` row for **that** group and the session's player. Read with the service
 * role -- the table is service-role only, because who is a group's admin is not public
 * (`0018_groups.sql`).
 */

/** The session player's role in one group, or `null` when they are not a member of it. */
export type GroupRoleLookup = (playerId: string, groupId: string) => Promise<GroupRole | null>;

export function supabaseGroupRole(client: ServiceClient): GroupRoleLookup {
  return async (playerId, groupId) => {
    // A group id that is not a uuid names no group: answered as "not a member" rather than as
    // Postgres's 22P02, which would surface as a 500.
    if (!groupIdSchema.safeParse(groupId).success) return null;
    const { data, error } = await client
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) throw new Error(`group role lookup failed: ${error.message}`);
    if (data === null) return null;
    // A role the union does not know (a hand-edited row) grants nothing.
    const parsed = groupRoleSchema.safeParse(data.role);
    return parsed.success ? parsed.data : null;
  };
}

/** True when `playerId` has a membership row in `groupId`, whatever its role. */
export async function isGroupMember(
  client: ServiceClient,
  groupId: string,
  playerId: string,
): Promise<boolean> {
  return (await supabaseGroupRole(client)(playerId, groupId)) !== null;
}

/**
 * True when the lobby exists **and** is one of the group's. A lobby of another group answers
 * exactly like a lobby that does not exist (M13.4: 404, not 403, so an admin of A does not learn
 * which of B's lobby ids are real). A path segment that is not a uuid is false, not a 22P02.
 */
export async function lobbyInGroup(
  client: ServiceClient,
  lobbyId: string,
  groupId: string,
): Promise<boolean> {
  if (!groupIdSchema.safeParse(lobbyId).success) return false;
  const { data, error } = await client
    .from('lobbies')
    .select('id')
    .eq('id', lobbyId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`lobby group lookup failed: ${error.message}`);
  return data !== null;
}

/**
 * The group's admins' display names -- the owner counts as one (M14.11) -- oldest player row first (the order the strip has always
 * used) -- the tonight strip's `Waiting on Yasser or Omar to roll the teams.` (2026-10-03), per
 * group since M13.4. Service role: the role column is not public, and only the names leave the
 * server. Sorted here rather than in the query: ordering a to-one embed in PostgREST sorts inside
 * the embed, which is a no-op.
 */
export async function groupAdminNames(client: ServiceClient, groupId: string): Promise<Array<string | null>> {
  const { data, error } = await client
    .from('group_memberships')
    .select('players!inner(display_name, game_name, created_at)')
    .eq('group_id', groupId)
    .in('role', ['owner', 'admin']);
  if (error) throw new Error(`group admin lookup failed: ${error.message}`);
  return [...(data ?? [])]
    .sort((a, b) => a.players.created_at.localeCompare(b.players.created_at))
    .map((row) => row.players.display_name ?? row.players.game_name ?? null);
}
