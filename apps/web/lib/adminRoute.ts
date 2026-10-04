import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { type AdminPage, adminHref } from './admin/adminNav';
import {
  type AdminAuthResult,
  type AdminIdentity,
  type AdminReader,
  type AdminReadResult,
  resolveAdmin,
  resolveAdminRead,
  resolveSetupWrite,
  type SetupWriteResult,
  type SetupWriter,
  toSetupWrite,
} from './adminAuth';
import { ServerEnvError } from './env';
import { groupSummaryById } from './groups/create';
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
 * `group_memberships` row (`admin` or `owner`, M14.11), and only then is the route's own schema — which
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

/** What every gated write's handler gets, whichever gate let it through. */
export interface WriteContext {
  client: ServiceClient;
  /**
   * The group this request acts on: the body's `groupId`, already checked — the session may write
   * to it. Anything a handler reads or writes is scoped to it, and an id (lobby, player, token)
   * outside it is a 404.
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

export interface AdminContext extends WriteContext {
  /** Who the session says this is. Never a player id out of the request body. Its `groupId` is `groupId`. */
  admin: AdminIdentity;
}

/**
 * A setup write's context (M14.40): a group admin, or the group's creator before they link a player
 * (`authorizeSetupWrite`). Only Connect Discord, the Discord test post, `discord-config` and the
 * invite rotate use it.
 */
export interface SetupContext extends WriteContext {
  writer: SetupWriter;
}

export type AdminHandler<T> = (input: T, context: AdminContext) => Promise<NextResponse>;
export type SetupHandler<T> = (input: T, context: SetupContext) => Promise<NextResponse>;

export interface AdminRouteOptions {
  /**
   * Where a browser form post is redirected after the write. Defaults to the request's own group
   * admin, `/g/<slug>/admin`, from the body's checked `groupId` (M14.39; it was `/admin`, which
   * lands on the original group's admin), and to {@link FALLBACK_REDIRECT} when no group resolves.
   * A fixed path wins over {@link section}; no route passes one any more (M14.40).
   */
  redirectTo?: string;
  /**
   * Which of the checked group's admin pages a form post goes back to, `/g/<slug>/admin/<section>`
   * (M14.40). Defaults to the admin home. The 1.0 `/admin/*` paths are never built here.
   */
  section?: AdminPage;
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: () => ServiceClient;
  /**
   * Injection point for tests: the whole session-and-group step. The integration tests hand this
   * a fake session instead of driving a real Discord OAuth flow. `groupId` is the body's, or null
   * when the body named none.
   */
  authorize?: (request: Request, client: ServiceClient, groupId: string | null) => Promise<AdminAuthResult>;
}

export interface SetupRouteOptions extends Omit<AdminRouteOptions, 'authorize'> {
  /** As {@link AdminRouteOptions.authorize}; an admin-gate answer is read as a `group_admin`. */
  authorize?: (
    request: Request,
    client: ServiceClient,
    groupId: string | null,
  ) => Promise<AdminAuthResult | SetupWriteResult>;
}

/** The body's `groupId` when it is a string, before any schema has looked at the body. */
export function peekGroupId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = (raw as { groupId?: unknown }).groupId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Where a form post goes when no group could be resolved: same-origin, and every viewer has a home there. */
export const FALLBACK_REDIRECT = '/';

/**
 * `/g/<slug>/admin[/<section>]` for a checked group, or {@link FALLBACK_REDIRECT} when the group
 * cannot be read. Never throws: a failed lookup must not turn a write that already happened into a 500.
 */
export async function groupAdminPath(
  client: ServiceClient,
  groupId: string,
  section: AdminPage = 'home',
): Promise<string> {
  try {
    const group = await groupSummaryById(client, groupId);
    return group === null ? FALLBACK_REDIRECT : adminHref(group, section);
  } catch (error) {
    console.error('admin route: group slug lookup failed', error);
    return FALLBACK_REDIRECT;
  }
}

/** A gate's answer, reduced to what {@link gatedWrite} needs: the checked group and the handler's extra fields. */
type GateResult<E> =
  | { ok: true; groupId: string; extra: E }
  | { ok: false; status: 400 | 401 | 403; error: string };

type Gate<E> = (request: Request, client: ServiceClient, groupId: string | null) => Promise<GateResult<E>>;

/** The admin gate: an `admin` or `owner` membership in the body's group. Every admin write but four. */
export function withAdminAuth<S extends z.ZodType>(
  schema: S,
  handle: AdminHandler<z.output<S>>,
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const gate: Gate<{ admin: AdminIdentity }> = async (request, client, groupId) => {
    const auth = options.authorize
      ? await options.authorize(request, client, groupId)
      : await resolveAdmin(requestCookieJar(request), client, groupId);
    return auth.ok ? { ok: true, groupId: auth.admin.groupId, extra: { admin: auth.admin } } : auth;
  };
  return gatedWrite(schema, gate, handle, options);
}

/**
 * The setup gate (M14.40): the admin gate, or the group's unlinked creator. **An allow-list**: only
 * `discord-config`, `discord/test` and `invite/rotate` are wrapped in this (Connect Discord's two GET
 * routes call `resolveSetupWrite` through `lib/discord/connectRoute.ts`). `setupGate.test.ts` pins
 * that list.
 */
export function withSetupWriteAuth<S extends z.ZodType>(
  schema: S,
  handle: SetupHandler<z.output<S>>,
  options: SetupRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const gate: Gate<{ writer: SetupWriter }> = async (request, client, groupId) => {
    const auth = options.authorize
      ? toSetupWrite(await options.authorize(request, client, groupId))
      : await resolveSetupWrite(requestCookieJar(request), client, groupId);
    return auth.ok ? { ok: true, groupId: auth.writer.groupId, extra: { writer: auth.writer } } : auth;
  };
  return gatedWrite(schema, gate, handle, options);
}

function gatedWrite<S extends z.ZodType, E extends object>(
  schema: S,
  gate: Gate<E>,
  handle: (input: z.output<S>, context: WriteContext & E) => Promise<NextResponse>,
  options: {
    redirectTo?: string | undefined;
    section?: AdminPage | undefined;
    getClient?: (() => ServiceClient) | undefined;
  },
): (request: Request) => Promise<NextResponse> {
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

      const auth = await gate(request, client, groupId);
      if (!auth.ok) {
        // A signed-in caller whose body could not even be read: say that, not "groupId is
        // required" — the missing group is a symptom of the unreadable body.
        if (auth.status === 400 && !raw.ok) {
          return raw.form
            ? redirectBack(request, options.redirectTo ?? FALLBACK_REDIRECT, {
                error: 'that form was not valid',
              })
            : raw.response;
        }
        return jsonError(auth.status, auth.error);
      }

      // Only a form post is ever sent back, so only a form post pays for the slug lookup.
      const redirectTo =
        options.redirectTo ??
        (raw.form ? await groupAdminPath(client, auth.groupId, options.section) : FALLBACK_REDIRECT);

      const body = raw.ok ? validateBody(schema, raw.raw, raw.form) : raw;
      if (!body.ok) {
        if (body.form) {
          return redirectBack(request, redirectTo, { error: 'that form was not valid' });
        }
        return body.response;
      }

      const context: WriteContext & E = {
        ...auth.extra,
        client,
        groupId: auth.groupId,
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

// ---------------------------------------------------------------------------
// GET /api/admin/*: the read gate (M13.6 / M14.19)
// ---------------------------------------------------------------------------

/**
 * Everything an admin GET has in common. The group is the **query's** `groupId` (a read has no
 * body); the gate is {@link resolveAdminRead}, so a group admin and the operator
 * (`SUPER_ADMIN_USER_IDS`, read-only) both pass, and the handler learns which from
 * `context.reader`. JSON only: no form, no redirect.
 *
 * Never wrap a write in this. Every write stays {@link withAdminAuth}, whose gate does not read the
 * super-admin list; `superAdmin.test.ts` checks that no admin route exports a write through here.
 */
export interface AdminReadContext {
  client: ServiceClient;
  reader: AdminReader;
  /** The query's `groupId`, already checked. Equal to `reader.groupId`. */
  groupId: string;
  request: Request;
}

export type AdminReadHandler<T> = (query: T, context: AdminReadContext) => Promise<NextResponse>;

export interface AdminReadRouteOptions {
  getClient?: () => ServiceClient;
  /** Injection point for tests: the whole session-and-group step. */
  authorize?: (request: Request, client: ServiceClient, groupId: string | null) => Promise<AdminReadResult>;
}

/** The query string as a plain object (last value wins), for a schema to parse. */
export function queryObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export function withAdminRead<S extends z.ZodType>(
  querySchema: S,
  handle: AdminReadHandler<z.output<S>>,
  options: AdminReadRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`admin read route: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      const raw = queryObject(request);
      const groupId = peekGroupId(raw);
      const auth = options.authorize
        ? await options.authorize(request, client, groupId)
        : await resolveAdminRead(requestCookieJar(request), client, groupId);
      if (!auth.ok) return jsonError(auth.status, auth.error);

      const parsed = querySchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return jsonError(400, 'query failed validation', issues);
      }

      return await handle(parsed.data, {
        client,
        reader: auth.reader,
        groupId: auth.reader.groupId,
        request,
      });
    } catch (error) {
      // Our bug or the database being down. Never leak the message.
      console.error('admin read route failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
