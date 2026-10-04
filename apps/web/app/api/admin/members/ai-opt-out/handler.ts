import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, withAdminAuth } from '@/lib/adminRoute';
import { setAiOptOut } from '@/lib/ai/store';
import { ADMIN_CANNOT_OPT_IN } from '@/lib/aiLinesCopy';
import {
  type MemberAiOptOutRequest,
  memberAiOptOutRequestSchema,
  memberAiOptOutResponseSchema,
} from './schema';

/**
 * `Don't write about <Name>` (M16.3b; brief 1.4, D6). Any admin or the owner of the body's group may
 * switch a member **off**; switching back on is the player's alone, on their You page, so
 * `optOut: false` is a 403 with that sentence and writes nothing (`setAiOptOut` refuses it). A
 * player outside the group is a 404, never a 403: an admin of A must not learn who is in B.
 */
export async function handleMemberAiOptOut(
  input: MemberAiOptOutRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const result = await setAiOptOut(context.client, {
    groupId: context.groupId,
    playerId: input.playerId,
    optOut: input.optOut,
    actor: 'group_admin',
  });
  if (!result.ok) {
    return result.reason === 'admin_cannot_opt_in'
      ? context.fail(403, ADMIN_CANNOT_OPT_IN)
      : context.fail(404, 'not a member of this group');
  }
  return context.respond(
    memberAiOptOutResponseSchema,
    { ok: true, groupId: context.groupId, playerId: input.playerId, optOut: true },
    'Left out of AI lines.',
  );
}

export function memberAiOptOutRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(memberAiOptOutRequestSchema, handleMemberAiOptOut, { section: 'members', ...options });
}
