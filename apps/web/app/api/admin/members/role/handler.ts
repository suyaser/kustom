import type { NextResponse } from 'next/server';
import { setMemberRole } from '@/lib/admin/members';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { type MemberRoleRequest, memberRoleRequestSchema, memberRoleResponseSchema } from './schema';

/**
 * Promote or demote a member of the body's group (M13.4). The rules — a member only, never the
 * group's last admin — are `lib/admin/members.ts` and the `set_group_member_role` function behind
 * it; this is the boundary.
 *
 * A player outside the group is a 404 and not a 403: an admin of group A must not learn which
 * players are in group B by trying ids.
 */
export async function handleMemberRole(
  input: MemberRoleRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  // `context.groupId`, not `input.groupId`: the same value, but this one is the one the gate
  // checked, and handlers act on what the gate checked.
  const result = await setMemberRole(context.client, {
    groupId: context.groupId,
    playerId: input.playerId,
    role: input.role,
  });
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  const { role, changed } = result.value;
  const notice = !changed
    ? role === 'admin'
      ? 'Already an admin.'
      : 'Already not an admin.'
    : role === 'admin'
      ? 'Made an admin.'
      : 'No longer an admin.';

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
    redirectTo: '/admin/players',
    ...options,
  });
}
