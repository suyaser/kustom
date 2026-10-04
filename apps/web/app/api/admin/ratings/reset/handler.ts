import {
  type RatingsResetRequest,
  ratingsResetRequestSchema,
  ratingsResetResponseSchema,
} from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { resetGroupRatings } from '@/lib/admin/ratingsReset';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { invalidateGroup } from '@/lib/cache/tags';
import { noteWrite, withLiveSignal } from '@/lib/live/bump';
import { siteOrigin } from '@/lib/siteUrl';

/** [NEW COPY] The success notice. */
export const RATINGS_RESET_DONE = 'Ratings reset. Everyone starts at 1200 again.';

/**
 * `POST /api/admin/ratings/reset { groupId, confirmSlug }` (M14.18): the owner's `Reset ratings`.
 * The admin gate lets any admin of the group through; the slug is checked in
 * `resetGroupRatings`, and the owner rule and the live-lobby / 15-minute guard inside
 * `reset_group_ratings()` (`0027`) under the group's row lock.
 */
export async function handleRatingsReset(
  input: RatingsResetRequest,
  context: AdminContext,
  fetchImpl?: typeof fetch,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  // Tonight's live signal (M19.9), flushed after the reset, its audit row and its Discord post, and
  // also when a step after the reset throws.
  const result = await withLiveSignal(context.client, (live) =>
    noteWrite(
      live,
      context.groupId,
      'ratings',
      () =>
        resetGroupRatings(context.client, {
          groupId: context.groupId,
          actorId: context.admin.playerId,
          confirmSlug: input.confirmSlug,
          requestOrigin: siteOrigin(context.request),
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
        }),
      (reset) => reset.ok,
    ),
  );
  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  invalidateGroup(context.groupId, ['stats', 'games']);
  if (context.form) return redirectBack(context.request, back, { notice: RATINGS_RESET_DONE });
  return context.respond(
    ratingsResetResponseSchema,
    { ok: true, groupId: context.groupId, ratingsSince: result.value.ratingsSince, post: result.value.post },
    RATINGS_RESET_DONE,
  );
}

export function ratingsResetRoute(
  options: AdminRouteOptions & { fetchImpl?: typeof fetch } = {},
): (request: Request) => Promise<NextResponse> {
  const { fetchImpl, ...rest } = options;
  return withAdminAuth(
    ratingsResetRequestSchema,
    (input, context) => handleRatingsReset(input, context, fetchImpl),
    {
      ...rest,
    },
  );
}
