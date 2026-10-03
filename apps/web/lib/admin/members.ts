import { type GroupRole, groupRoleSchema } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Promote a member to admin of a group, or back (M13.4, `POST /api/admin/members/role`).
 *
 * **A group can never be left with no admin** (decision row 2026-10-03): there is no other way to
 * hand a group on — no owner column, no operator write — so demoting the last admin is refused
 * with a sentence and nothing is written. The rule lives in the database function
 * `set_group_member_role` (`0020`), which locks the group's row while it counts, so two admins
 * demoting each other in the same second cannot both win and orphan the group.
 *
 * Demoting yourself is allowed when another admin remains: that is exactly how a group is handed
 * on (promote the next person, then step down). It replaced M1.6's "you cannot remove your own
 * admin flag", which existed only to stop the last admin locking everybody out — the last-admin
 * rule covers that case for every admin, not just the one pressing.
 */

/** The 409's words, product's (M13.4 brief). */
export const LAST_ADMIN = 'This group needs at least one admin.';

/** A player who is not a member of the request's group (404, never 403: see the route). */
export const NO_SUCH_MEMBER = 'no such player';

export interface SetMemberRoleInput {
  groupId: string;
  playerId: string;
  role: GroupRole;
}

export interface SetMemberRoleResult {
  playerId: string;
  role: GroupRole;
  /** False for a repeat press: the member already had that role and nothing was written. */
  changed: boolean;
}

/** What `set_group_member_role` answers. Anything else is our bug, not the caller's. */
const OUTCOMES = ['ok', 'unchanged', 'not_member', 'last_admin'] as const;
type Outcome = (typeof OUTCOMES)[number];

function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

export async function setMemberRole(
  client: ServiceClient,
  input: SetMemberRoleInput,
): Promise<AdminWriteResult<SetMemberRoleResult>> {
  const role = groupRoleSchema.parse(input.role);
  const { data, error } = await client.rpc('set_group_member_role', {
    p_group_id: input.groupId,
    p_player_id: input.playerId,
    p_role: role,
  });
  if (error) throw new Error(`setMemberRole failed: ${error.message}`);
  if (!isOutcome(data)) throw new Error(`setMemberRole: unexpected answer ${String(data)}`);

  switch (data) {
    case 'not_member':
      return writeFailed(404, NO_SUCH_MEMBER);
    case 'last_admin':
      return writeFailed(409, LAST_ADMIN);
    case 'unchanged':
      return writeOk({ playerId: input.playerId, role, changed: false });
    case 'ok':
      return writeOk({ playerId: input.playerId, role, changed: true });
  }
}
