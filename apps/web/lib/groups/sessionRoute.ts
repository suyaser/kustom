import type { NextResponse } from 'next/server';
import { ServerEnvError } from '../env';
import { jsonError } from '../http';
import { type MeAuthResult, type MeIdentity, resolveMe } from '../me/identity';
import { getServiceClient, type ServiceClient } from '../supabase';
import { requestCookieJar } from '../supabaseAuth';

/**
 * The gate for the M13.5 session routes that come **before** a group is the caller's: creating
 * one (`POST /api/groups`), listing yours (`GET /api/groups/mine`), joining by the invite link
 * (`POST /api/groups/join`), and getting or polling a pairing code (`/api/me/pairing`).
 *
 * The same chain as `lib/me/route.ts` -- service-role client, then `resolveMe` (session ->
 * verified Discord identity -> `players.discord_id`) -- minus the step these routes cannot have:
 * `withViewerAuth` requires every body to name a `groupId` the caller is checked against, and
 * here the group either does not exist yet, or is named by an invite code, or is the thing being
 * asked for. Each handler parses its own body and decides what an unlinked session
 * (`me.player === null`) may do: create and pair, yes; join by one tap, no.
 *
 * 401 without a session, 403 for a session with no Discord identity, before anything else is
 * read. JSON only: the pages that call these (M13.13) are client components.
 */

export interface SessionContext {
  client: ServiceClient;
  /** Who the session says this is. Never anything out of the request body. */
  me: MeIdentity;
  request: Request;
}

export type SessionHandler = (request: Request, context: SessionContext) => Promise<NextResponse>;

export interface SessionRouteOptions {
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: (() => ServiceClient) | undefined;
  /** Injection point for tests: the whole session step. */
  authorize?: ((request: Request, client: ServiceClient) => Promise<MeAuthResult>) | undefined;
}

export function withSession(
  handle: SessionHandler,
  options: SessionRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`session route: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      const auth = options.authorize
        ? await options.authorize(request, client)
        : await resolveMe(requestCookieJar(request), client);
      if (!auth.ok) return jsonError(auth.status, auth.error);

      return await handle(request, { client, me: auth.me, request });
    } catch (error) {
      // Our bug or the database being down. Never leak the message.
      console.error('session route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
