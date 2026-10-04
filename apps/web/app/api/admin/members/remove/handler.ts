import {
  type MemberRemoveRequest,
  memberRemoveRequestSchema,
  memberRemoveResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { removeMember } from '@/lib/admin/members';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { invalidateGroup } from '@/lib/cache/tags';
import { bumpGroupLive } from '@/lib/live/bump';

/** The success notice. Platform's words, listed in the M14.11 report for product to replace. */
export const MEMBER_REMOVED = 'Removed from the group.';

/**
 * `POST /api/admin/members/remove { groupId, playerId }` (M14.11). Admins remove members, the owner
 * removes admins, nobody removes the owner. The rules are `remove_group_member` (`0023`), behind
 * `lib/admin/members.ts`; this is the boundary. The actor is the session's player as the gate
 * resolved it, never the body's.
 *
 * Removing is not banning: the person's games and rating stay, their companion tokens in this
 * group stop, and playing with the group again brings them back as a member with their rating.
 * A player outside the group (or already removed) is a 404, not a 403.
 */
export async function handleMemberRemove(
  input: MemberRemoveRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  const result = await removeMember(context.client, {
    groupId: context.groupId,
    actorId: context.admin.playerId,
    playerId: input.playerId,
  });
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  invalidateGroup(context.groupId, ['roster', 'admins']);
  // Tonight's live signal (M19.9), after the removal's one write.
  await bumpGroupLive(context.client, context.groupId, 'roster');
  if (context.form) return redirectBack(context.request, back, { notice: MEMBER_REMOVED });

  return context.respond(
    memberRemoveResponseSchema,
    { ok: true, groupId: context.groupId, playerId: result.value.playerId },
    MEMBER_REMOVED,
  );
}

export function memberRemoveRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(memberRemoveRequestSchema, handleMemberRemove, {
    section: 'members',
    ...options,
  });
}
