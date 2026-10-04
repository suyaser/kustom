import { type AssignableGroupRole, assignableGroupRoleSchema } from '@customs/db/schemas';
import { NOT_A_GROUP_ADMIN } from '../adminAuth';
import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Who runs a group (M13.4, owner-aware since M14.11; `redesign/STRATEGY.md` §3.5): promote and
 * demote, remove a member, hand ownership on. Each write is one `security definer` function
 * (`0023`) that locks the group's row and re-checks the **actor's** role inside it, so the
 * owner-only rules hold even when two admins press in the same second. The actor is always the
 * session's player as the admin gate resolved it, never an id from the request body.
 *
 * The rules, in one place:
 *
 *   - Any admin (or the owner) makes a member an admin.
 *   - Only the owner makes an admin a member -- except an admin stepping down themselves.
 *   - Any admin removes a member; only the owner removes an admin; nobody removes the owner.
 *   - The owner hands ownership to an admin and stays an admin. There is always exactly one owner.
 *   - A group with no owner yet (an unpaired creator; the original group before
 *     `bootstrap_admin` runs) keeps M13.4's rule instead: admins manage admins, and the last admin
 *     can be neither demoted nor removed.
 */

/** Product's words (M14.11 brief, [NEW COPY]): an owner-only write by an admin. 403. */
export const ONLY_OWNER = 'Only the owner can do that.';

/** Product's words (M14.11 brief, [NEW COPY]): removing the owner. 409. */
export const OWNER_CANNOT_BE_REMOVED = "The owner can't be removed. Hand ownership to an admin first.";

/**
 * Demoting the owner to a member (409). Platform's sentence in the shape of product's removal one,
 * listed in the M14.11 report for product to replace.
 */
export const OWNER_CANNOT_BE_DEMOTED = "The owner can't be made a member. Hand ownership to an admin first.";

/**
 * Handing ownership to someone who is not an admin (409). Platform's sentence, listed in the M14.11
 * report for product to replace.
 */
export const OWNER_NEEDS_ADMIN = 'Make them an admin first.';

/** M13.4's 409, still the answer in a group that has no owner yet. Product's words. */
export const LAST_ADMIN = 'This group needs at least one admin.';

/** A player who is not a member of the request's group (404, never 403: see the routes). */
export const NO_SUCH_MEMBER = 'no such player';

type DefinerOutcome<T extends string> = { data: unknown; outcomes: readonly T[]; name: string };

function outcomeOf<T extends string>({ data, outcomes, name }: DefinerOutcome<T>): T {
  if (typeof data === 'string' && (outcomes as readonly string[]).includes(data)) return data as T;
  throw new Error(`${name}: unexpected answer ${String(data)}`);
}

// ---------------------------------------------------------------------------
// member <-> admin
// ---------------------------------------------------------------------------

export interface SetMemberRoleInput {
  groupId: string;
  /** The session's player, as the admin gate resolved it. */
  actorId: string;
  playerId: string;
  role: AssignableGroupRole;
}

export interface SetMemberRoleResult {
  playerId: string;
  role: AssignableGroupRole;
  /** False for a repeat press: the member already had that role and nothing was written. */
  changed: boolean;
}

const ROLE_OUTCOMES = [
  'ok',
  'unchanged',
  'not_member',
  'forbidden',
  'owner_only',
  'is_owner',
  'last_admin',
] as const;

export async function setMemberRole(
  client: ServiceClient,
  input: SetMemberRoleInput,
): Promise<AdminWriteResult<SetMemberRoleResult>> {
  const role = assignableGroupRoleSchema.parse(input.role);
  const { data, error } = await client.rpc('set_group_member_role_v2', {
    p_group_id: input.groupId,
    p_actor_id: input.actorId,
    p_player_id: input.playerId,
    p_role: role,
  });
  if (error) throw new Error(`setMemberRole failed: ${error.message}`);

  switch (outcomeOf({ data, outcomes: ROLE_OUTCOMES, name: 'setMemberRole' })) {
    case 'not_member':
      return writeFailed(404, NO_SUCH_MEMBER);
    case 'forbidden':
      return writeFailed(403, NOT_A_GROUP_ADMIN);
    case 'owner_only':
      return writeFailed(403, ONLY_OWNER);
    case 'is_owner':
      return writeFailed(409, OWNER_CANNOT_BE_DEMOTED);
    case 'last_admin':
      return writeFailed(409, LAST_ADMIN);
    case 'unchanged':
      return writeOk({ playerId: input.playerId, role, changed: false });
    case 'ok':
      return writeOk({ playerId: input.playerId, role, changed: true });
  }
}

// ---------------------------------------------------------------------------
// remove a member
// ---------------------------------------------------------------------------

export interface RemoveMemberInput {
  groupId: string;
  actorId: string;
  playerId: string;
}

const REMOVE_OUTCOMES = ['ok', 'not_member', 'forbidden', 'owner_only', 'is_owner', 'last_admin'] as const;

/**
 * Deletes the membership and revokes the player's companion tokens **in this group**. Their
 * `ratings` row, their games and the names on them stay; playing with the group again re-adds them
 * as a `member` with that rating (M13.3's playing-is-joining). Not a ban.
 */
export async function removeMember(
  client: ServiceClient,
  input: RemoveMemberInput,
): Promise<AdminWriteResult<{ playerId: string }>> {
  const { data, error } = await client.rpc('remove_group_member', {
    p_group_id: input.groupId,
    p_actor_id: input.actorId,
    p_player_id: input.playerId,
  });
  if (error) throw new Error(`removeMember failed: ${error.message}`);

  switch (outcomeOf({ data, outcomes: REMOVE_OUTCOMES, name: 'removeMember' })) {
    case 'not_member':
      return writeFailed(404, NO_SUCH_MEMBER);
    case 'forbidden':
      return writeFailed(403, NOT_A_GROUP_ADMIN);
    case 'owner_only':
      return writeFailed(403, ONLY_OWNER);
    case 'is_owner':
      return writeFailed(409, OWNER_CANNOT_BE_REMOVED);
    case 'last_admin':
      return writeFailed(409, LAST_ADMIN);
    case 'ok':
      return writeOk({ playerId: input.playerId });
  }
}

// ---------------------------------------------------------------------------
// hand ownership on
// ---------------------------------------------------------------------------

export interface TransferOwnershipInput {
  groupId: string;
  actorId: string;
  /** The admin who becomes the owner. */
  playerId: string;
}

export interface TransferOwnershipResult {
  ownerId: string;
  /** The actor's role now. */
  role: 'owner' | 'admin';
  changed: boolean;
}

const TRANSFER_OUTCOMES = ['ok', 'unchanged', 'not_member', 'owner_only', 'not_admin'] as const;

export async function transferOwnership(
  client: ServiceClient,
  input: TransferOwnershipInput,
): Promise<AdminWriteResult<TransferOwnershipResult>> {
  const { data, error } = await client.rpc('transfer_group_ownership', {
    p_group_id: input.groupId,
    p_actor_id: input.actorId,
    p_player_id: input.playerId,
  });
  if (error) throw new Error(`transferOwnership failed: ${error.message}`);

  switch (outcomeOf({ data, outcomes: TRANSFER_OUTCOMES, name: 'transferOwnership' })) {
    case 'not_member':
      return writeFailed(404, NO_SUCH_MEMBER);
    case 'owner_only':
      return writeFailed(403, ONLY_OWNER);
    case 'not_admin':
      return writeFailed(409, OWNER_NEEDS_ADMIN);
    case 'unchanged':
      return writeOk({ ownerId: input.actorId, role: 'owner', changed: false });
    case 'ok':
      return writeOk({ ownerId: input.playerId, role: 'admin', changed: true });
  }
}
