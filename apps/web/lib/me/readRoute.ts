import { type GroupRole, groupIdSchema, groupRoleSchema } from '@customs/db/schemas';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { discordIdFromUser, type SessionUserLike, supabaseSessionUser } from '../adminAuth';
import { ServerEnvError } from '../env';
import { jsonError } from '../http';
import { getServiceClient, type ServiceClient } from '../supabase';
import { createAuthClient, requestCookieJar } from '../supabaseAuth';
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
 * - **One database wave after GoTrue.** The player and their membership in the group are one
 *   query (`players` with its `group_memberships` row for that group embedded), and the route's
 *   own read starts **beside** it rather than after it. The read's answer is only returned once
 *   the membership says yes; for anyone else it is dropped unread, so the speculative start costs
 *   a non-member's forged request one wasted row read and tells them nothing.
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
  /** Injection point for tests: the GoTrue step. Defaults to `getUser()` on the request's cookies. */
  resolveSessionUser?: ((request: Request) => Promise<SessionUserLike | null>) | undefined;
  /** Injection point for tests: the player-and-membership lookup. */
  lookupMember?: ((client: ServiceClient) => MemberLookup) | undefined;
}

/** What a read is handed: the parsed query and the service-role client. Never the session. */
export type MemberRead<Q, R> = (query: Q, client: ServiceClient) => Promise<R>;

function defaultSessionUser(request: Request): Promise<SessionUserLike | null> {
  return supabaseSessionUser(createAuthClient(requestCookieJar(request)))();
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
      const user = await (options.resolveSessionUser ?? defaultSessionUser)(request);
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
      const member = await (options.lookupMember ?? supabaseMemberLookup)(client)(discordId, query.groupId);
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
