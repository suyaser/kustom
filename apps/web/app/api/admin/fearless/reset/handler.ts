import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { FEARLESS_SKIPPED_NORMAL, postFearlessReset } from '@/lib/discord/post';
import {
  FEARLESS_RESET_FAILED,
  FEARLESS_RESET_NOTICE,
  FEARLESS_RESET_POSTED,
  FEARLESS_RESET_SKIPPED,
} from '@/lib/fearless/copy';
import { resetFearless } from '@/lib/fearless/reset';
import { siteOrigin } from '@/lib/siteUrl';
import { type FearlessResetRequest, fearlessResetRequestSchema, fearlessResetResponseSchema } from './schema';

/**
 * Clear the fearless pool (M10) of the body's group (M13.4). Cursor first, post second: the empty
 * list is what the group agreed to and it stands whatever Discord answers. The post goes to that
 * group's channel.
 *
 * On Normal (M14.29) the cursor still moves and the post is skipped (`post: 'skipped'`): nobody is
 * drafting under fearless, so an empty ban list is not news. The notice then says only that the
 * pool was cleared, not that no webhook is configured.
 */
export async function handleFearlessReset(
  input: FearlessResetRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const { resetAt } = await resetFearless(context.client, {
    playerId: context.admin.playerId,
    groupId: context.groupId,
  });
  const outcome = await postFearlessReset(context.client, {
    requestOrigin: siteOrigin(context.request),
    groupId: context.groupId,
  });
  const message = outcome.reason === FEARLESS_SKIPPED_NORMAL ? FEARLESS_RESET_NOTICE : notice(outcome.status);

  if (context.form) return redirectBack(context.request, back, { notice: message });

  return context.respond(fearlessResetResponseSchema, { ok: true, resetAt, post: outcome.status }, message);
}

export function notice(post: 'posted' | 'skipped' | 'failed'): string {
  switch (post) {
    case 'posted':
      return FEARLESS_RESET_POSTED;
    case 'skipped':
      return FEARLESS_RESET_SKIPPED;
    default:
      return FEARLESS_RESET_FAILED;
  }
}

export function fearlessResetRoute(
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(fearlessResetRequestSchema, handleFearlessReset, options);
}
