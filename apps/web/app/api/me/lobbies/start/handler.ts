import type { NextResponse } from 'next/server';
// Registers the `onAcked` listener that fans the invites out (M4.2) and the `balanced` listener
// that queues `switch_side` (M4.1). A side-effect import, exactly as on the companion routes:
// with this line removed the press still queues its `create_lobby` and nothing else happens.
import '@/lib/commands/register';
import { openingOnPcLine, type StartLobbyOptions, startLobby } from '@/lib/lobbyStart';
import { START_LOBBY_NOT_LINKED } from '@/lib/me/copy';
import { type MeContext, type MeRouteOptions, withViewerAuth } from '@/lib/me/route';
import { nightTimeZone } from '@/lib/tonight/night';
import { type StartLobbyRequest, startLobbyRequestSchema, startLobbyResponseSchema } from './schema';

/**
 * Start a lobby (M4.2's rules, M4.13's gate). The rules — who hosts, the name, the password, the
 * four refusals — are `lib/lobbyStart.ts`; this is the boundary and nothing else.
 *
 * **Every linked player may press it** (M4.13). This route lives on M3.6's third class
 * (`lib/me/route.ts`'s `withViewerAuth`, `lib/me/identity.ts`'s `resolveMe`), the same wrapper
 * `/api/me/role-tonight` and `/api/me/link` run on: a session, a `players` row, and no admin
 * flag anywhere in the decision. The 2026-09-10 decision row called the widening "an auth swap
 * and a moved file" in advance, and that is exactly what it was — the admin path is deleted
 * rather than aliased, because two paths for one command is the second copy that drifts.
 *
 * **Admins need no branch.** `authorizeAdmin` can only return true for a session whose Discord
 * id matched a `players` row, so every admin is a linked player and passes the gate below on
 * the same line everybody else does. `me.player.isAdmin` is read by nothing in this file.
 *
 * Both shapes, like every other write on this class: the envelope for a JSON caller, a 303 back
 * to the page carrying the sentence for a browser form, and authentication failures always the
 * envelope so "401 without a session, 403 without a player row" is one assertion either way.
 */
export async function handleStartLobby(
  _input: StartLobbyRequest,
  context: MeContext,
  options: StartLobbyOptions = {},
): Promise<NextResponse> {
  /**
   * A signed-in visitor who matches no player row, answered the way `/api/me/role-tonight`
   * answers `ROLE_TAP_NOT_LINKED`: a sentence they can act on. The page cannot produce this
   * request — the control is drawn for linked viewers only — so it is the forged-post answer and
   * the honest one, and it is **never** a 500 from a rule that assumed a player row.
   */
  const presser = context.me.player;
  if (presser === null) return context.fail(403, START_LOBBY_NOT_LINKED);

  const result = await startLobby(
    context.client,
    // The presser comes from the **session**, never from the body: whose client opens a lobby is
    // a real decision, and a body that could name someone else would be a request to open a
    // lobby on a stranger's PC.
    { pressedByPlayerId: presser.playerId },
    { timeZone: nightTimeZone(), ...options },
  );

  // One of the four sentences, every one of them a 409 and none of them a write. `context.fail`
  // is the 303 with `?error=` for a form post and the envelope for JSON, so the words are the
  // route's own either way.
  if (!result.ok) return context.fail(result.status, result.error);

  const value = result.value;

  return context.respond(
    startLobbyResponseSchema,
    {
      ok: true,
      commandId: value.commandId,
      host: { playerId: value.host.playerId, puuid: value.host.puuid, name: value.hostName },
      lobbyName: value.lobbyName,
      lobbyPassword: value.lobbyPassword,
      cycle: value.cycle,
      expiresAt: value.expiresAt,
    },
    openingOnPcLine(value.hostName),
  );
}

export interface StartLobbyRouteOptions extends MeRouteOptions {
  /** Tests only: the clock, the gate override and the password source. */
  start?: StartLobbyOptions;
}

/**
 * The route. `redirectTo` defaults to `/` — this is the tonight page's control first and the
 * one button on `/admin` second, and that page's form names `/admin` in its body. With
 * JavaScript neither of them navigates at all (M3.20); both post JSON and print the answer
 * where the button is.
 */
export function startLobbyRoute(
  options: StartLobbyRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withViewerAuth(
    startLobbyRequestSchema,
    (input, context) => handleStartLobby(input, context, options.start ?? {}),
    {
      redirectTo: options.redirectTo ?? '/',
      getClient: options.getClient,
      authorize: options.authorize,
    },
  );
}
