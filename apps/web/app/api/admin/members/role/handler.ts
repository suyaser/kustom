import type { AssignableGroupRole } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { setMemberRole } from '@/lib/admin/members';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { type MemberRoleRequest, memberRoleRequestSchema, memberRoleResponseSchema } from './schema';

/** The success notice for the role the member has now, and whether this press changed it. */
const ROLE_NOTICES: Record<AssignableGroupRole, { changed: string; unchanged: string }> = {
  admin: { changed: 'Made an admin.', unchanged: 'Already an admin.' },
  member: { changed: 'No longer an admin.', unchanged: 'Already not an admin.' },
};

/**
 * Promote or demote a member of the body's group (M13.4, owner-aware since M14.11). The rules —
 * any admin promotes; only the owner demotes an admin (or the admin themselves); nobody demotes
 * the owner; a group with no owner keeps its last admin — are `lib/admin/members.ts` and the
 * `set_group_member_role_v2` function behind it; this is the boundary.
 *
 * A player outside the group is a 404 and not a 403: an admin of group A must not learn which
 * players are in group B by trying ids.
 */
export async function handleMemberRole(
  input: MemberRoleRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  // `context.groupId` and `context.admin.playerId`, not anything from the body: the group the gate
  // checked, and the actor it resolved from the session.
  const result = await setMemberRole(context.client, {
    groupId: context.groupId,
    actorId: context.admin.playerId,
    playerId: input.playerId,
    role: input.role,
  });
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  const { role, changed } = result.value;
  const notice = changed ? ROLE_NOTICES[role].changed : ROLE_NOTICES[role].unchanged;

  if (context.form) return redirectBack(context.request, back, { notice });

  return context.respond(
    memberRoleResponseSchema,
    { ok: true, groupId: context.groupId, playerId: result.value.playerId, role, changed },
    notice,
  );
}

export function memberRoleRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(memberRoleRequestSchema, handleMemberRole, {
    section: 'members',
    ...options,
  });
}
