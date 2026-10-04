import {
  type InviteRotateRequest,
  inviteRotateRequestSchema,
  inviteRotateResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import {
  redirectBack,
  type SetupContext,
  type SetupRouteOptions,
  withSetupWriteAuth,
} from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { INVITE_ROTATED } from '@/lib/groups/copy';
import { rotateGroupInvite } from '@/lib/groups/invites';

/**
 * `POST /api/admin/invite/rotate { groupId }` (M13.5): a new invite code for the body's group. The
 * old `/join/<code>` link stops at once, and every unused pairing code a non-creator got through it
 * is expired (`rotate_group_invite`, `0021`). M13.14's invite card (`New link`) posts here.
 *
 * The setup gate (M14.40, `withSetupWriteAuth`): a group admin, or the group's creator before they
 * link a player -- the checklist rows can be done in any order (STRATEGY 3.1). `rotated_by` is the
 * session's auth user id either way.
 */
export async function handleInviteRotate(
  input: InviteRotateRequest,
  context: SetupContext,
): Promise<NextResponse> {
  // `context.groupId`, the one the gate checked.
  const code = await rotateGroupInvite(context.client, context.groupId, context.writer.userId);
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
  options: SetupRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withSetupWriteAuth(inviteRotateRequestSchema, handleInviteRotate, {
    ...options,
  });
}
