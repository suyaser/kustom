import type { NextResponse } from 'next/server';
import { setAiOptOut } from '@/lib/ai/store';
import { NOT_IN_THIS_GROUP } from '@/lib/me/copy';
import { type MeContext, type MeRouteOptions, withViewerAuth } from '@/lib/me/route';
import { type MeAiOptOutRequest, meAiOptOutRequestSchema, meAiOptOutResponseSchema } from './schema';

/**
 * The player's own `Write about me` (M16.3b; brief 1.4, D6), both ways. A session with no player row
 * or no membership in the body's group is a 403 (`NOT_IN_THIS_GROUP`); the page
 * draws the switch for members only, so those are the forged-post answers. Not gated on Premium:
 * asking not to be written about always works (`setAiOptOut`).
 */
export async function handleMeAiOptOut(input: MeAiOptOutRequest, context: MeContext): Promise<NextResponse> {
  const player = context.me.player;
  if (player === null) return context.fail(403, NOT_IN_THIS_GROUP);
  if (context.role === null) return context.fail(403, NOT_IN_THIS_GROUP);

  const result = await setAiOptOut(context.client, {
    groupId: context.groupId,
    playerId: player.playerId,
    optOut: !input.writeAboutMe,
    actor: 'self',
  });
  if (!result.ok) return context.fail(403, NOT_IN_THIS_GROUP);
  return context.respond(
    meAiOptOutResponseSchema,
    { ok: true, groupId: context.groupId, writeAboutMe: !result.optOut },
    result.optOut ? 'Left out of AI lines.' : 'Back in AI lines.',
  );
}

export function meAiOptOutRoute(options: MeRouteOptions = {}): (request: Request) => Promise<NextResponse> {
  return withViewerAuth(meAiOptOutRequestSchema, handleMeAiOptOut, options);
}
