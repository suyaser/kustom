import { type GroupRole, type GroupSummary, groupRoleSchema, INVITE_CODE_PATTERN } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { INVITE_DEAD, JOIN_NOT_LINKED } from './copy';
import { type GroupResult, groupFailed, groupOk } from './result';

/**
 * The group's one invite link, `/join/<code>` (M13.5; `group_invites`, `0021`).
 *
 * One live code per group, 22 url-safe characters, stored as is: it is meant to be pasted into a
 * group chat, and an admin must be able to see it again (M13.14's invite card). Rotating replaces
 * it, and the old link stops at once. The code grants exactly two things to a signed-in person:
 * joining with one tap when they are already linked, and a pairing code when they are not.
 */

/** The group behind a live invite code, or null for a rotated, unknown or malformed one. */
export async function groupByInviteCode(
  client: ServiceClient,
  code: string,
): Promise<(GroupSummary & { createdBy: string | null }) | null> {
  // A string that cannot be a code is answered without a query, like a code that matches nothing.
  if (!INVITE_CODE_PATTERN.test(code)) return null;
  const { data, error } = await client
    .from('group_invites')
    .select('groups!inner(id, slug, name, created_by)')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  if (data === null) return null;
  const group = data.groups;
  return { id: group.id, slug: group.slug, name: group.name, createdBy: group.created_by };
}

/** The group's live code, for its admin page (M13.14), or null when it has none. */
export async function readGroupInvite(
  client: ServiceClient,
  groupId: string,
): Promise<{ code: string; rotatedAt: string } | null> {
  const { data, error } = await client
    .from('group_invites')
    .select('code, rotated_at')
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`invite read failed: ${error.message}`);
  return data === null ? null : { code: data.code, rotatedAt: data.rotated_at };
}

/**
 * A new code for the group; the old link stops. `rotate_group_invite` (`0021`) also expires every
 * unused pairing code a non-creator got through the old link, so rotating a leaked link stops the
 * codes it already handed out (Kustom then reads `That code ran out.`). Null for a group that does not exist.
 */
export async function rotateGroupInvite(
  client: ServiceClient,
  groupId: string,
  rotatedBy: string,
): Promise<string | null> {
  const { data, error } = await client.rpc('rotate_group_invite', {
    p_group_id: groupId,
    p_rotated_by: rotatedBy,
  });
  if (error) throw new Error(`invite rotation failed: ${error.message}`);
  return data ?? null;
}

export interface JoinInput {
  code: string;
  /** The session's auth user id, to recognise the group's creator. */
  userId: string;
  /** The session's player. `null` is the unlinked visitor, who pairs instead. */
  playerId: string | null;
}

export interface Joined {
  group: GroupSummary;
  role: GroupRole;
  outcome: 'joined' | 'already_member';
}

/**
 * `Join <Group>` (M13.5, `POST /api/groups/join`): a linked session with the live code becomes a
 * `member`. An existing membership is kept as it is -- an admin who opens their own link stays
 * admin -- with one exception: the group's creator always ends up `admin`, because that is what
 * `created_by` means (the same rule their pairing follows). Idempotent: a second press is
 * `already_member` and writes nothing.
 */
export async function joinGroup(client: ServiceClient, input: JoinInput): Promise<GroupResult<Joined>> {
  if (input.playerId === null) return groupFailed(403, JOIN_NOT_LINKED);

  const group = await groupByInviteCode(client, input.code);
  if (group === null) return groupFailed(404, INVITE_DEAD);

  const summary: GroupSummary = { id: group.id, slug: group.slug, name: group.name };
  const isCreator = group.createdBy !== null && group.createdBy === input.userId;
  const wanted: GroupRole = isCreator ? 'admin' : 'member';

  const { data: inserted, error: insertError } = await client
    .from('group_memberships')
    .upsert(
      { group_id: group.id, player_id: input.playerId, role: wanted },
      { onConflict: 'group_id,player_id', ignoreDuplicates: true },
    )
    .select('role');
  if (insertError) throw new Error(`join failed: ${insertError.message}`);
  if ((inserted ?? []).length > 0) return groupOk({ group: summary, role: wanted, outcome: 'joined' });

  // Already a member. The creator is raised to admin; anyone else keeps their role.
  if (isCreator) {
    const { error } = await client
      .from('group_memberships')
      .update({ role: 'admin' })
      .eq('group_id', group.id)
      .eq('player_id', input.playerId);
    if (error) throw new Error(`join: raising the creator failed: ${error.message}`);
    return groupOk({ group: summary, role: 'admin', outcome: 'already_member' });
  }

  const { data: existing, error: readError } = await client
    .from('group_memberships')
    .select('role')
    .eq('group_id', group.id)
    .eq('player_id', input.playerId)
    .single();
  if (readError) throw new Error(`join: reading the membership failed: ${readError.message}`);
  return groupOk({ group: summary, role: groupRoleSchema.parse(existing.role), outcome: 'already_member' });
}
