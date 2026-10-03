import { discordIdFromUser, type SessionUserLike, supabaseSessionUser } from '../adminAuth';
import type { ServiceClient } from '../supabase';
import { type CookieJar, createAuthClient } from '../supabaseAuth';

/**
 * Who a **friend** is, for the two writes on the tonight page (M3.6).
 *
 * This is the third route class in the product, and the first of its kind: `/api/companion/*`
 * is a bearer token, `/api/admin/*` is a session plus an admin membership in the request's group,
 * and `/api/me/*` is a session with a linked player. Which group, and what the player is in it,
 * is `lib/me/route.ts`'s step after this one (M13.4). The chain is the only chain this project
 * knows — session → Discord identity → `players.discord_id` → the player row — and no request
 * body is ever part of it.
 *
 * The difference from `lib/adminAuth.ts` is one step, and it is deliberate: **an unlinked
 * session is not a failure here.** `POST /api/me/link` exists precisely for the visitor who
 * matches no player row, so the gate resolves the session and hands the handler a `player` of
 * `null` rather than answering 403 on its behalf.
 *
 * `ensureBootstrapAdmin` is **not** called, unlike `resolveAdmin`: it writes, and the routes
 * that use this are opened by whoever is holding the WhatsApp link.
 */

/**
 * The player row behind a signed-in friend, when their Discord account is linked to one. No
 * admin flag: what a player may do depends on the group, and the group is the request's
 * (`MeContext.role`, M13.4).
 */
export interface MePlayer {
  playerId: string;
  puuid: string;
}

export interface MeIdentity {
  userId: string;
  discordId: string;
  /** `null` for a signed-in visitor who matches no player row: M3.6's `That's me` case. */
  player: MePlayer | null;
}

export type MeAuthResult = { ok: true; me: MeIdentity } | { ok: false; status: 401 | 403; error: string };

export type SessionUserResolver = () => Promise<SessionUserLike | null>;

export type PlayerByDiscordId = (discordId: string) => Promise<MePlayer | null>;

export interface AuthorizeMeOptions {
  resolveSessionUser: SessionUserResolver;
  lookupPlayerByDiscordId: PlayerByDiscordId;
}

/**
 * Session in, identity or 401/403 out. Pure apart from its two injected lookups, so every rule
 * below is a unit test rather than an OAuth round trip.
 */
export async function authorizeMe(options: AuthorizeMeOptions): Promise<MeAuthResult> {
  const user = await options.resolveSessionUser();
  if (user === null) return { ok: false, status: 401, error: 'sign in required' };

  const discordId = discordIdFromUser(user);
  // A Supabase session with no Discord identity cannot be matched to a player at all: there
  // is nothing to link and nothing to write.
  if (discordId === null) return { ok: false, status: 403, error: 'this session has no Discord identity' };

  return {
    ok: true,
    me: { userId: user.id, discordId, player: await options.lookupPlayerByDiscordId(discordId) },
  };
}

/**
 * `players` by `discord_id` with the **service role**: anon and authenticated have no select
 * privilege on that table at all, which is why `discord_id` lives there and not in
 * `players_public` (`0001_init.sql`).
 */
export function supabaseMeLookup(client: ServiceClient): PlayerByDiscordId {
  return async (discordId) => {
    const { data, error } = await client
      .from('players')
      .select('id, puuid')
      .eq('discord_id', discordId)
      .maybeSingle();

    if (error) throw new Error(`me: player lookup failed: ${error.message}`);
    if (!data) return null;

    return { playerId: data.id, puuid: data.puuid };
  };
}

/** Everything the gate needs, wired to Supabase. */
export function resolveMe(jar: CookieJar, client: ServiceClient): Promise<MeAuthResult> {
  return authorizeMe({
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
    lookupPlayerByDiscordId: supabaseMeLookup(client),
  });
}
