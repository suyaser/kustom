import {
  type OwnerTransferRequest,
  ownerTransferRequestSchema,
  ownerTransferResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { transferOwnership } from '@/lib/admin/members';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { invalidateGroup } from '@/lib/cache/tags';
import { bumpIfWrote } from '@/lib/live/bump';

/** The success notices. Platform's words, listed in the M14.11 report for product to replace. */
export const OWNERSHIP_HANDED_ON = "Ownership handed over. You're an admin now.";
export const ALREADY_OWNER = "You're already the owner.";

/**
 * `POST /api/admin/owner/transfer { groupId, playerId }` (M14.11): the owner hands the group to
 * one of its admins and stays an admin. The admin gate lets any admin through; the owner check is
 * inside `transfer_group_ownership` (`0023`), under the group's row lock, so two handovers pressed
 * at once leave exactly one owner.
 */
export async function handleOwnerTransfer(
  input: OwnerTransferRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  const result = await transferOwnership(context.client, {
    groupId: context.groupId,
    actorId: context.admin.playerId,
    playerId: input.playerId,
  });
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  const notice = result.value.changed ? OWNERSHIP_HANDED_ON : ALREADY_OWNER;
  invalidateGroup(context.groupId, ['admins']);
  // Tonight's live signal (M19.9): only when ownership moved.
  await bumpIfWrote(context.client, context.groupId, 'roster', result.value.changed);
  if (context.form) return redirectBack(context.request, back, { notice });

  return context.respond(
    ownerTransferResponseSchema,
    {
      ok: true,
      groupId: context.groupId,
      ownerId: result.value.ownerId,
      role: result.value.role,
      changed: result.value.changed,
    },
    notice,
  );
}

export function ownerTransferRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(ownerTransferRequestSchema, handleOwnerTransfer, {
    section: 'members',
    ...options,
  });
}
