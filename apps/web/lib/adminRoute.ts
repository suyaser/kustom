import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { type AdminAuthResult, type AdminIdentity, resolveAdmin } from './adminAuth';
import { ServerEnvError } from './env';
import { jsonError, jsonOk, readFormOrJsonBody, validateBody } from './http';
import { siteOrigin } from './siteUrl';
import { getServiceClient, type ServiceClient } from './supabase';
import { requestCookieJar } from './supabaseAuth';

/**
 * Everything `/api/admin/*` has in common, mirroring `lib/companionRoute.ts`: the service-role
 * client, the session check, the group check, then the zod parse of the body — in that order, so
 * an unauthenticated caller learns nothing about the payload we expect, and a caller who is not an
 * admin of the group learns only that every admin body names a `groupId` (M13.4).
 *
 * **The group is the body's `groupId`** (M13.4): a session can be in several groups, so it alone
 * never names one. The body is read once, its `groupId` is checked against the session player's
 * `group_memberships` row (`role = 'admin'`), and only then is the route's own schema — which
 * carries the same `groupId` field — run over it. The handler gets the checked group as
 * `context.groupId` and scopes everything to it.
 *
 * Authentication failures are always the JSON envelope, never a redirect, so "401 without a
 * session, 403 for a non-admin" is one assertion whichever way the request arrived.
 *
 * Successes and validation failures are the envelope for a JSON caller and a 303 back to the
 * page for a browser form, because the admin pages ship no client JavaScript.
 *
 * Cross-site forgery: the session cookies `@supabase/ssr` writes are `SameSite=Lax`, which a
 * browser does not attach to a cross-site POST, so a form on someone else's page arrives here
 * with no session and gets a 401. If a future change ever loosens that to `None`, these routes
 * need a token.
 */

export interface AdminContext {
  client: ServiceClient;
  /** Who the session says this is. Never a player id out of the request body. */
  admin: AdminIdentity;
  /**
   * The group this request acts on: the body's `groupId`, already checked — the session's player
   * is an admin of it. Equal to `admin.groupId`. Anything a handler reads or writes is scoped to
   * it, and an id (lobby, player, token) outside it is a 404.
   */
  groupId: string;
  request: Request;
  /** True when the body came from an HTML form rather than JSON. */
  form: boolean;
  /** The page a form post is sent back to. */
  redirectTo: string;
  /** A success: the envelope, or a 303 back to the page carrying `notice`. */
  respond<S extends z.ZodType>(schema: S, value: z.input<S>, notice: string): NextResponse;
  /** A refusal the handler decided on (a business rule, not auth). */
  fail(status: number, error: string): NextResponse;
}

export type AdminHandler<T> = (input: T, context: AdminContext) => Promise<NextResponse>;

export interface AdminRouteOptions {
  /** Where a browser form post is redirected after the write. Defaults to `/admin`. */
  redirectTo?: string;
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: () => ServiceClient;
  /**
   * Injection point for tests: the whole session-and-group step. The integration tests hand this
   * a fake session instead of driving a real Discord OAuth flow. `groupId` is the body's, or null
   * when the body named none.
   */
  authorize?: (request: Request, client: ServiceClient, groupId: string | null) => Promise<AdminAuthResult>;
}

/** The body's `groupId` when it is a string, before any schema has looked at the body. */
export function peekGroupId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as { groupId?: unknown }).groupId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function withAdminAuth<S extends z.ZodType>(
  schema: S,
  handle: AdminHandler<z.output<S>>,
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const redirectTo = options.redirectTo ?? '/admin';

  return async (request) => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`admin route: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      const raw = await readFormOrJsonBody(request);
      const groupId = raw.ok ? peekGroupId(raw.raw) : null;

      const auth = options.authorize
        ? await options.authorize(request, client, groupId)
        : await resolveAdmin(requestCookieJar(request), client, groupId);
      if (!auth.ok) {
        // A signed-in caller whose body could not even be read: say that, not "groupId is
        // required" — the missing group is a symptom of the unreadable body.
        if (auth.status === 400 && !raw.ok) {
          return raw.form
            ? redirectBack(request, redirectTo, { error: 'that form was not valid' })
            : raw.response;
        }
        return jsonError(auth.status, auth.error);
      }

      const body = raw.ok ? validateBody(schema, raw.raw, raw.form) : raw;
      if (!body.ok) {
        if (body.form) {
          return redirectBack(request, redirectTo, { error: 'that form was not valid' });
        }
        return body.response;
      }

      const context: AdminContext = {
        client,
        admin: auth.admin,
        groupId: auth.admin.groupId,
        request,
        form: body.form,
        redirectTo,
        respond: (responseSchema, value, notice) =>
          body.form ? redirectBack(request, redirectTo, { notice }) : jsonOk(responseSchema, value),
        fail: (status, error) =>
          body.form ? redirectBack(request, redirectTo, { error }) : jsonError(status, error),
      };

      return await handle(body.data, context);
    } catch (error) {
      // Our bug or the database being down. Never leak the message.
      console.error('admin route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}

/**
 * 303 (not 302) so the browser turns the POST into a GET of the page. `notice` and `error` are
 * our own sentences; the page renders them as text.
 *
 * The origin comes from `siteOrigin`, not from `request.url`: in `next dev` the latter is
 * normalised to `localhost` even when the browser asked for `127.0.0.1`, which would bounce an
 * admin to a different origin — and a different cookie jar — after every save.
 */
export function redirectBack(
  request: Request,
  path: string,
  message: { notice?: string; error?: string },
): NextResponse {
  const url = new URL(path, siteOrigin(request));
  if (message.notice) url.searchParams.set('notice', message.notice);
  if (message.error) url.searchParams.set('error', message.error);
  return NextResponse.redirect(url, 303);
}
