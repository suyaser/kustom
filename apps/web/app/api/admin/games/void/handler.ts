import { type GameVoidRequest, gameVoidRequestSchema, gameVoidResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { setGameVoided } from '@/lib/admin/voidGame';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { invalidateGroup } from '@/lib/cache/tags';
import { RESTORE_DONE, VOID_DONE } from '@/lib/games/copy';
import { noteWrite, withLiveSignal } from '@/lib/live/bump';

/**
 * `POST /api/admin/games/void { groupId, gameId, action: 'void' | 'restore', redirectTo? }` (M23.1)
 * -> `{ ok: true, voided, changed, folded }`. 401 signed out, 403 for anyone who is not an admin or
 * the owner of the body's group, 400 for a bad body, 404 for a game of another group, 409 `This
 * game is not rated.` (a void of a game played not rated) or `Finish tonight's game first.` (a live
 * lobby or a game in the last 15 minutes: nothing written). The rules and the rebuild are
 * `lib/admin/voidGame.ts`. A no-JS form post goes back to the page.
 */
export async function handleGameVoid(input: GameVoidRequest, context: AdminContext): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const result = await withLiveSignal(context.client, (live) =>
    noteWrite(
      live,
      context.groupId,
      'ratings',
      () =>
        setGameVoided(context.client, {
          groupId: context.groupId,
          gameId: input.gameId,
          action: input.action,
        }),
      (outcome) => outcome.ok && outcome.value.changed,
    ),
  );
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }
  if (result.value.changed) invalidateGroup(context.groupId, ['stats', 'games']);
  const notice = result.value.voided ? VOID_DONE : RESTORE_DONE;
  if (context.form) return redirectBack(context.request, back, { notice });
  return context.respond(gameVoidResponseSchema, { ok: true, ...result.value }, notice);
}

export function gameVoidRoute(options: AdminRouteOptions = {}) {
  return withAdminAuth(gameVoidRequestSchema, handleGameVoid, options);
}
