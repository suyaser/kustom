import { type GroupRole, groupIdSchema, groupRoleSchema } from '@customs/db/schemas';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { discordIdFromUser, type SessionUserLike, sessionLookups } from '../adminAuth';
import { ServerEnvError } from '../env';
import { jsonError } from '../http';
import { getServiceClient, type ServiceClient } from '../supabase';
import { requestCookieJar } from '../supabaseAuth';
import { NOT_IN_THIS_GROUP } from './copy';
import type { MePlayer } from './identity';

/**
 * The gate for the small `GET /api/me/*` status reads (M19.16): a page polls one of these while it
 * waits for one fact, instead of re-rendering itself (performance plan P6).
 *
 * The same chain as `lib/me/route.ts` -- session, then the Discord identity, then `players`, then
 * the membership in the request's `groupId` -- with two differences, both for the poll's cost:
 *
 * - **The query string, not a body.** A GET carries no body; the schema parses `searchParams`.
 * - **Few waves.** By default the session, the player and their role in the query's group are one
 *   verified session lookup (`session_player`, read before the query is parsed so the 401/403
 *   order holds). An injected member lookup runs **beside** the route's own read instead. Either
 *   way the read's answer is only returned once the membership says yes; for anyone else it is
 *   dropped unread, so a non-member's forged request costs one wasted row read and tells them
 *   nothing.
 *
 * Who gets in: a linked player with a membership row in `groupId` (any role). 401 without a
 * session, 403 for a session with no Discord identity, no linked player, or no membership. The
 * 401 and 403 come before the query is parsed (an unauthenticated caller learns nothing about the
 * parameters), exactly like the body routes.
 *
 * JSON only, never cached by anyone: the answer is about this session and this minute.
 */

/** The player behind the session and their role in the asked group (`null`: not a member). */
export interface MemberOfGroup {
  player: MePlayer;
  role: GroupRole | null;
}

/** `players` by Discord id, with the membership in one group; `null` when no player carries the id. */
export type MemberLookup = (discordId: string, groupId: string) => Promise<MemberOfGroup | null>;

/** Refusal strings, exported so the tests assert these and not literals. */
export const READ_SIGN_IN_REQUIRED = 'sign in required';
export const READ_NO_DISCORD = 'this session has no Discord identity';
export const READ_NOT_LINKED = 'pick yourself out of the list first';
export const READ_BAD_QUERY = 'that query was not valid';

/**
 * The one-query player-and-membership lookup, service role (both tables are service-role only).
 * The embedded `group_memberships` is filtered to the asked group, so it is `[]` for a non-member
 * and one row for a member (`(group_id, player_id)` is the primary key).
 */
export function supabaseMemberLookup(client: ServiceClient): MemberLookup {
  return async (discordId, groupId) => {
    const { data, error } = await client
      .from('players')
      .select('id, puuid, group_memberships(role)')
      .eq('discord_id', discordId)
      .eq('group_memberships.group_id', groupId)
      .maybeSingle();
    if (error) throw new Error(`member lookup failed: ${error.message}`);
    if (data === null) return null;
    const row = data.group_memberships[0];
    // A role the union does not know (a hand-edited row) grants nothing, as in `supabaseGroupRole`.
    const parsed = row === undefined ? null : groupRoleSchema.safeParse(row.role);
    return {
      player: { playerId: data.id, puuid: data.puuid },
      role: parsed?.success ? parsed.data : null,
    };
  };
}

export interface MemberReadOptions {
  /** Injection point for tests. Defaults to the process-wide service-role client. */
  getClient?: (() => ServiceClient) | undefined;
  /** Injection point for tests: the session step. Defaults to the verified session lookup (`sessionLookups`). */
  resolveSessionUser?: ((request: Request) => Promise<SessionUserLike | null>) | undefined;
  /** Injection point for tests: the player-and-membership lookup. */
  lookupMember?: ((client: ServiceClient) => MemberLookup) | undefined;
}

/** What a read is handed: the parsed query and the service-role client. Never the session. */
export type MemberRead<Q, R> = (query: Q, client: ServiceClient) => Promise<R>;

/**
 * The default session and member steps, both answered by **one** verified session lookup
 * (`session_player`, `lib/adminAuth.ts`'s `sessionLookups`) for the query's `groupId`: the token
 * checked locally, then the live session row, the player and the role in that group together. The
 * group is read off the raw query here only to pick what the lookup asks about; the parsed query
 * still decides everything after the session step.
 */
function defaultSteps(request: Request, client: ServiceClient) {
  const raw = new URL(request.url).searchParams.get('groupId');
  const groupId = raw !== null && groupIdSchema.safeParse(raw).success ? raw : null;
  const lookups = sessionLookups(requestCookieJar(request), client, groupId);
  const lookupMember: MemberLookup = async (discordId, asked) => {
    const player = await lookups.lookupPlayerByDiscordId(discordId);
    if (player === null) return null;
    return {
      player: { playerId: player.playerId, puuid: player.puuid },
      role: await lookups.lookupGroupRole(player.playerId, asked),
    };
  };
  return { resolveSessionUser: lookups.resolveSessionUser, lookupMember };
}

/** `searchParams` as a plain object, first value per key, for the query schema. */
function queryObject(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

export function withMemberRead<Q extends z.ZodType<{ groupId: string }>, R extends z.ZodType>(
  querySchema: Q,
  responseSchema: R,
  read: MemberRead<z.output<Q>, z.input<R>>,
  options: MemberReadOptions = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    let client: ServiceClient;
    try {
      client = options.getClient ? options.getClient() : getServiceClient();
    } catch (error) {
      if (error instanceof ServerEnvError) {
        console.error(`me read: ${error.message}`);
        return jsonError(500, 'server is not configured');
      }
      throw error;
    }

    try {
      let steps: ReturnType<typeof defaultSteps> | undefined;
      const defaults = () => (steps ??= defaultSteps(request, client));
      const user = await (options.resolveSessionUser ?? (() => defaults().resolveSessionUser()))(request);
      if (user === null) return jsonError(401, READ_SIGN_IN_REQUIRED);
      const discordId = discordIdFromUser(user);
      if (discordId === null) return jsonError(403, READ_NO_DISCORD);

      const parsed = querySchema.safeParse(queryObject(request));
      if (!parsed.success) return jsonError(400, READ_BAD_QUERY);
      const query = parsed.data;
      // Belt and braces: every query schema carries `groupIdSchema`, but a non-uuid here would be
      // a 22P02 from Postgres and a 500.
      if (!groupIdSchema.safeParse(query.groupId).success) return jsonError(400, READ_BAD_QUERY);

      // The one wave: who this is in the group, and the answer, at the same time.
      const answer = read(query, client);
      // Dropped below for a refusal; never an unhandled rejection.
      answer.catch(() => undefined);
      // Production: the member from the same session lookup. A test that injected only the session
      // step gets the plain one-query read (there is no real session to look up).
      const lookupMember = options.lookupMember
        ? options.lookupMember(client)
        : options.resolveSessionUser
          ? supabaseMemberLookup(client)
          : defaults().lookupMember;
      const member = await lookupMember(discordId, query.groupId);
      if (member === null) return jsonError(403, READ_NOT_LINKED);
      if (member.role === null) return jsonError(403, NOT_IN_THIS_GROUP);

      const value = responseSchema.parse(await answer);
      return NextResponse.json(value, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      // Our bug or the database being down. Never leak the message.
      console.error('me read failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
