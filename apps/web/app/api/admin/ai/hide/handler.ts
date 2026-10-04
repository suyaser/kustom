import {
  type HideAiLineRequest,
  hideAiLineRequestSchema,
  hideAiLineResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { HIDDEN_NOTICE } from '@/lib/ai/recapCopy';
import { hideLine } from '@/lib/ai/store';
import { safeNextPath } from '@/lib/authNext';

/**
 * `POST /api/admin/ai/hide` (M16.4; brief 1.5, D8): `{ groupId, lineId, redirectTo? }` ->
 * `{ ok: true, hidden }`. 401 signed out, 403 for anyone who is not an admin or the owner of the
 * body's group, 400 for a bad body. The line becomes `hidden` for everybody, for good: every
 * surface reads through `loadShownLine`, which shows only `published`. A line of another group, or
 * one already hidden, changes nothing (`hidden: false`). A no-JS form post goes back to the page.
 */
export async function handleHideAiLine(
  input: HideAiLineRequest,
  context: AdminContext,
  deps: { now?: () => Date } = {},
): Promise<NextResponse> {
  const hidden = await hideLine(context.client, {
    groupId: context.groupId,
    lineId: input.lineId,
    hiddenBy: context.admin.playerId,
    now: deps.now?.() ?? new Date(),
  });
  if (context.form) {
    return redirectBack(context.request, safeNextPath(input.redirectTo) ?? context.redirectTo, {
      notice: HIDDEN_NOTICE,
    });
  }
  return context.respond(hideAiLineResponseSchema, { ok: true, hidden }, HIDDEN_NOTICE);
}

export function hideAiLineRoute(options: AdminRouteOptions = {}) {
  return withAdminAuth(
    hideAiLineRequestSchema,
    (input, context) => handleHideAiLine(input, context),
    options,
  );
}
