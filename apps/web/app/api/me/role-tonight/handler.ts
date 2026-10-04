import { type RoleTonightRequest, roleTonightRequestSchema, roleTonightResponseSchema } from '@customs/db';
import { isAtLeast } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { noteWrite, withLiveSignal } from '@/lib/live/bump';
import { NOT_IN_THIS_GROUP, ROLE_TAP_NOT_LINKED } from '@/lib/me/copy';
import {
  type RoleTonightStore,
  savedForNextGame,
  setRoleTonight,
  supabaseRoleTonightStore,
} from '@/lib/me/roleTonight';
import type { MeContext, MeRouteOptions } from '@/lib/me/route';
import { withViewerAuth } from '@/lib/me/route';
import { nightTimeZone } from '@/lib/tonight/night';

/**
 * `POST /api/me/role-tonight` (M3.6). Separate from `route.ts` because a Next route file may
 * only export HTTP verbs, and the tests need the handler with a fake session and a fake store
 * around it — there is no way to drive a real Discord OAuth flow from vitest.
 *
 * The caller is the session. The body carries the group, the lobby, the role, and — for an admin
 * of that group only — whose row to write. The caller must be a member of the group (M13.4), and
 * the lobby must be the group's. Nothing rebalances and nothing is posted to Discord: a tap on a lobby
 * whose teams are up is stored and answered with `savedForNextGame`, which is the sentence the
 * control prints.
 */

export interface RoleTonightRouteOptions extends MeRouteOptions {
  /** Injection point for tests. Defaults to the Supabase-backed store. */
  store?: (context: MeContext) => RoleTonightStore;
}

export function roleTonightRoute(options: RoleTonightRouteOptions = {}) {
  return withViewerAuth(roleTonightRequestSchema, (input, context) => handle(input, context, options), {
    redirectTo: '/',
    getClient: options.getClient,
    authorize: options.authorize,
    groupRole: options.groupRole,
  });
}

async function handle(
  input: RoleTonightRequest,
  context: MeContext,
  options: RoleTonightRouteOptions,
): Promise<NextResponse> {
  const player = context.me.player;
  if (player === null) return context.fail(403, ROLE_TAP_NOT_LINKED);
  if (context.role === null) return context.fail(403, NOT_IN_THIS_GROUP);

  const store = options.store ? options.store(context) : supabaseRoleTonightStore(context.client);
  const isAdmin = isAtLeast(context.role, 'admin');
  // Tonight's live signal (M19.9): the role landed on the player and the lobby row. Also when the
  // row write throws after the player write landed (the next companion post heals the row).
  const result = await withLiveSignal(context.client, (live) =>
    noteWrite(
      live,
      context.groupId,
      'lobby',
      () =>
        setRoleTonight(
          store,
          // Admin (or owner, M14.11) of **this** group (M13.4): an admin of another group is a
          // member here, nothing more.
          { ...player, isAdmin },
          { groupId: context.groupId, lobbyId: input.lobbyId, role: input.role, puuid: input.puuid },
          // The night this preference belongs to ends at 06:00 in the deployment's zone, and the
          // route is the only place that knows which zone that is.
          { timeZone: nightTimeZone() },
        ),
      (tapped) => tapped.ok,
    ),
  );
  if (!result.ok) return context.fail(result.status, result.error);

  const { puuid, role, status } = result.value;

  return context.respond(
    roleTonightResponseSchema,
    {
      ok: true,
      puuid,
      lobbyId: input.lobbyId,
      role,
      status,
      savedForNextGame: savedForNextGame(status),
    },
    // The no-JavaScript path's sentence, in the query string of the 303 back to the page. With
    // JavaScript the role word turning `brand` is the whole receipt: no toast, no flash.
    role === null ? 'role cleared' : `role for tonight: ${role}`,
  );
}
