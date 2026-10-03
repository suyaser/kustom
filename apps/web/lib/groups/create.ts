import { type GroupRole, type GroupSummary, groupRoleSchema } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { SLUG_TAKEN } from './copy';
import { type GroupResult, groupFailed, groupOk } from './result';

/**
 * Creating a group (M13.5, `POST /api/groups`) and listing the session's groups
 * (`GET /api/groups/mine`).
 *
 * Anyone signed in may create one (decision row 2026-10-03, "Self-serve groups"; no quota in
 * v1). The whole write is `create_group` (`0021`): the group, its fearless cursor, its invite and
 * -- when the session is already linked to a player -- that player's `admin` membership, in one
 * transaction, so a group never exists without its cursor or its invite. An unlinked creator gets
 * no membership here; `groups.created_by` is their auth user id, and their pairing
 * (`lib/groups/pairing.ts`) makes their PUUID the group's admin.
 */

export interface CreateGroupInput {
  /** Already trimmed and checked by `createGroupRequestSchema`. */
  name: string;
  /** Already checked by `groupSlugSchema`. Stored exactly as given. */
  slug: string;
  /** The session's auth user id: `groups.created_by`. */
  createdBy: string;
  /** The session's player, when linked: the group's first admin. */
  playerId: string | null;
}

export interface CreatedGroup {
  group: GroupSummary;
  /** `admin` for a linked creator; `null` until an unlinked creator pairs. */
  role: GroupRole | null;
}

export async function createGroup(
  client: ServiceClient,
  input: CreateGroupInput,
): Promise<GroupResult<CreatedGroup>> {
  const { data, error } = await client.rpc('create_group', {
    p_slug: input.slug,
    p_name: input.name,
    p_created_by: input.createdBy,
    // The generated type says `string`, but the function takes null for "no player yet".
    p_player_id: input.playerId as string,
  });
  if (error) throw new Error(`createGroup failed: ${error.message}`);
  const row = data?.[0];
  if (row === undefined) throw new Error('createGroup: create_group answered no row');

  if (row.outcome === 'slug_taken') return groupFailed(409, SLUG_TAKEN);
  // The schema checked both fields before this call, so a check violation here means the schema
  // and the constraints drifted: our bug, not the caller's sentence.
  if (row.outcome !== 'ok' || row.group_id === null) {
    throw new Error(`createGroup: unexpected outcome ${row.outcome}`);
  }

  const group = await groupSummaryById(client, row.group_id);
  if (group === null) throw new Error('createGroup: the new group is not readable');
  return groupOk({ group, role: input.playerId === null ? null : 'admin' });
}

/** `id, slug, name` of one group, or null. */
export async function groupSummaryById(client: ServiceClient, groupId: string): Promise<GroupSummary | null> {
  const { data, error } = await client
    .from('groups')
    .select('id, slug, name')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`group lookup failed: ${error.message}`);
  return data === null ? null : { id: data.id, slug: data.slug, name: data.name };
}

export interface MyGroup extends GroupSummary {
  role: GroupRole;
}

/**
 * The player's memberships with their role, oldest membership first -- the same order as
 * `GET /api/overlay/groups` (M13.3), so the web and Kustom list a person's groups alike.
 */
export async function listMyGroups(client: ServiceClient, playerId: string): Promise<MyGroup[]> {
  const { data, error } = await client
    .from('group_memberships')
    .select('role, created_at, groups!inner(id, slug, name)')
    .eq('player_id', playerId)
    .order('created_at', { ascending: true })
    .order('group_id', { ascending: true });
  if (error) throw new Error(`listing groups failed: ${error.message}`);

  const groups: MyGroup[] = [];
  for (const row of data ?? []) {
    // A role the union does not know (a hand-edited row) grants nothing, so it is not listed.
    const role = groupRoleSchema.safeParse(row.role);
    if (!role.success) continue;
    groups.push({ id: row.groups.id, slug: row.groups.slug, name: row.groups.name, role: role.data });
  }
  return groups;
}
