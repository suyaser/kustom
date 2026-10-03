import {
  type InviteRotateRequest,
  inviteRotateRequestSchema,
  inviteRotateResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { INVITE_ROTATED } from '@/lib/groups/copy';
import { rotateGroupInvite } from '@/lib/groups/invites';

/**
 * `POST /api/admin/invite/rotate { groupId }` (M13.5): a new invite code for the body's group. The
 * old `/join/<code>` link stops at once, and every unused pairing code a non-creator got through it
 * is expired (`rotate_group_invite`, `0021`). Group admin only, through the same gate as every
 * `/api/admin/*` write (M13.4). M13.14's invite card (`New link`) posts here.
 */
export async function handleInviteRotate(
  input: InviteRotateRequest,
  context: AdminContext,
): Promise<NextResponse> {
  // `context.groupId`, the one the gate checked.
  const code = await rotateGroupInvite(context.client, context.groupId, context.admin.userId);
  if (code === null) return context.fail(404, 'no such group');

  if (context.form) {
    const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
    return redirectBack(context.request, back, { notice: INVITE_ROTATED });
  }
  return context.respond(
    inviteRotateResponseSchema,
    { ok: true, groupId: context.groupId, code },
    INVITE_ROTATED,
  );
}

export function inviteRotateRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(inviteRotateRequestSchema, handleInviteRotate, { redirectTo: '/admin', ...options });
}
