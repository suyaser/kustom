import type { Rng } from '@customs/core';
import type { NextResponse } from 'next/server';
// Registers the command queue's `balanced` listener on `hooks.ts` at module load (M4.1): a roll
// is what fires `emitLobbyBalanced` now, so this route is what puts `switch_side` rows on the
// queue. Imported here rather than in `route.ts` so the tests that call the handler get it too.
import '@/lib/commands/register';
// Registers the Discord listeners on `hooks.ts` at module load (M3.1): the teams embed.
import '@/lib/ingest/discord';
import { NO_SUCH_LOBBY } from '@/lib/admin/reroll';
import { rollLobby } from '@/lib/admin/roll';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { readServerEnv } from '@/lib/env';
import { lobbyInGroup } from '@/lib/groups/membership';
import { siteOrigin } from '@/lib/siteUrl';
import { type RollRequest, rollRequestSchema, rollResponseSchema } from './schema';

/**
 * Roll (2026-10-03). Session-gated like every `/api/admin/*` route: 401 without a session, 403
 * for anyone who is not an admin of the body's `groupId` (M13.4), then the zod parse, then a 404
 * for a lobby outside that group, then `rollLobby`.
 *
 * The lobby id is a path segment and `rollLobby` validates it first, so a non-uuid is a 404 —
 * and only after the session check, so an unauthenticated caller learns nothing.
 */
export async function handleRoll(
  lobbyId: string,
  input: RollRequest,
  context: AdminContext,
  now: Date = new Date(),
  rng?: Rng,
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  // A lobby of another group answers exactly like one that does not exist (M13.4).
  if (!(await lobbyInGroup(context.client, lobbyId, context.groupId))) {
    return context.form
      ? redirectBack(context.request, back, { error: NO_SUCH_LOBBY })
      : context.fail(404, NO_SUCH_LOBBY);
  }

  const result = await rollLobby(context.client, {
    lobbyId,
    rosterKey: input.rosterKey,
    now,
    timeZone: readServerEnv().CUSTOMS_NIGHT_TZ,
    requestOrigin: siteOrigin(context.request),
    // Region wars' draw (M15.3): the server's RNG unless a test pins it (M15.10).
    ...(rng === undefined ? {} : { rng }),
  });

  if (!result.ok) {
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  const { splitId, outcome } = result.value;
  const notice =
    outcome === 'rolled'
      ? 'Teams are up.'
      : 'Those teams were already up for this lobby. Nothing was posted.';

  if (context.form) return redirectBack(context.request, back, { notice });

  return context.respond(
    rollResponseSchema,
    { ok: true, lobbyId, status: 'balanced', splitId, outcome },
    notice,
  );
}

/** The route, with the lobby id from the path already in hand. */
export function rollRoute(
  lobbyId: string,
  options: AdminRouteOptions & { now?: () => Date; rng?: Rng } = {},
): (request: Request) => Promise<NextResponse> {
  const { now, rng, ...routeOptions } = options;
  return withAdminAuth(
    rollRequestSchema,
    (input, context) => handleRoll(lobbyId, input, context, now?.(), rng),
    { ...routeOptions },
  );
}
