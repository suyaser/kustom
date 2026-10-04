import { type SelfLinkRequest, selfLinkRequestSchema, selfLinkResponseSchema } from '@customs/db';
import type { NextResponse } from 'next/server';
import { invalidateGroup } from '@/lib/cache/tags';
import type { MeContext, MeRouteOptions } from '@/lib/me/route';
import { withViewerAuth } from '@/lib/me/route';
import { linkSelf, type SelfLinkStore, supabaseSelfLinkStore } from '@/lib/me/selfLink';
import { nightTimeZone } from '@/lib/tonight/night';

/**
 * `POST /api/me/link` (M3.6, "Picking yourself, once"; widened by M14.34): a signed-in visitor
 * claims one of tonight's lobby members, or one of the ten of a game of the group that ended in
 * the last 12 hours, as themselves, once, with no admin involved.
 *
 * It writes `players.discord_id` and nothing else. Which rows may be claimed is decided here
 * from the body's group's tonight lobby and recent games (M13.4, M14.34), never from anything
 * else in the body, and a row
 * that is already linked is refused with product's sentence. No membership is asked of the
 * visitor — they have no player row yet — and `context.role` is not read.
 */

export interface SelfLinkRouteOptions extends MeRouteOptions {
  /** Injection point for tests. Defaults to the Supabase-backed store. */
  store?: (context: MeContext) => SelfLinkStore;
}

export function selfLinkRoute(options: SelfLinkRouteOptions = {}) {
  return withViewerAuth(selfLinkRequestSchema, (input, context) => handle(input, context, options), {
    redirectTo: '/',
    getClient: options.getClient,
    authorize: options.authorize,
    groupRole: options.groupRole,
  });
}

async function handle(
  input: SelfLinkRequest,
  context: MeContext,
  options: SelfLinkRouteOptions,
): Promise<NextResponse> {
  const store = options.store
    ? options.store(context)
    : supabaseSelfLinkStore(context.client, { timeZone: nightTimeZone(), groupId: context.groupId });

  const result = await linkSelf(store, context.me, input.puuid);
  if (!result.ok) return context.fail(result.status, result.error);

  invalidateGroup(context.groupId, ['roster']);
  return context.respond(
    selfLinkResponseSchema,
    { ok: true, puuid: result.value.puuid },
    // The no-JavaScript path's sentence. With JavaScript the page simply knows the reader from
    // the next render on, which is the receipt.
    'that is you from now on',
  );
}
