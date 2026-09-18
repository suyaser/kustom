import type { NextResponse } from 'next/server';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { postFearlessReset } from '@/lib/discord/post';
import { FEARLESS_RESET_FAILED, FEARLESS_RESET_POSTED, FEARLESS_RESET_SKIPPED } from '@/lib/fearless/copy';
import { resetFearless } from '@/lib/fearless/reset';
import { siteOrigin } from '@/lib/siteUrl';
import { type FearlessResetRequest, fearlessResetRequestSchema, fearlessResetResponseSchema } from './schema';

/**
 * Clear the fearless pool (M10). Cursor first, post second: the empty list is what the
 * group agreed to and it stands whatever Discord answers.
 */
export async function handleFearlessReset(
  input: FearlessResetRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
  const { resetAt } = await resetFearless(context.client, { playerId: context.admin.playerId });
  const outcome = await postFearlessReset(context.client, {
    requestOrigin: siteOrigin(context.request),
  });
  const message = notice(outcome.status);

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
