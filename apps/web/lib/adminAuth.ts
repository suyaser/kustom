import { groupIdSchema } from '@customs/db/schemas';
import { ensureBootstrapAdmin } from './bootstrapAdmin';
import { type GroupRoleLookup, supabaseGroupRole } from './groups/membership';
import type { ServiceClient } from './supabase';
import { type AuthClient, type CookieJar, createAuthClient } from './supabaseAuth';

/**
 * The admin gate: a Supabase session, and `group_memberships.role = 'admin'` **in the request's
 * group** (M13.4; `04-decisions.md` 2026-10-03, "Group admin is a membership role"). The old
 * global flag on `players` is not read anywhere any more.
 *
 * Three steps, all server-side, never a client claim:
 *
 *   1. The session cookies are exchanged for a **verified** user (`auth.getUser()` asks the
 *      auth server; `getSession()` would only decode a cookie).
 *   2. The Discord snowflake on that user's *identity* is matched against
 *      `players.discord_id` with the service-role client.
 *   3. That player's membership row in the request's `groupId` decides. Admin of group A asking
 *      about group B is 403, the same as a member who is not an admin at all.
 *
 * No session is 401. A request with no `groupId` is 400 (every admin request names one). A
 * session that is not an admin of that group — for any reason: no Discord identity, no player
 * linked to it, not a member, a member but not an admin — is 403. The reason string says which,
 * because the only people who see it are the people in the group.
 *
 * The decision itself is a pure function over two injected lookups so it can be tested without
 * a database or an OAuth round trip; the Supabase-backed lookups are at the bottom.
 */

/** The Discord snowflake lives on the identity, not in user metadata. See {@link discordIdFromUser}. */
export interface SessionIdentityLike {
  /** The provider's own user id. For Discord this is the snowflake. */
  id: string;
  provider: string;
  identity_data?: Record<string, unknown> | undefined;
}

export interface SessionUserLike {
  id: string;
  email?: string | null | undefined;
  identities?: SessionIdentityLike[] | null | undefined;
  /** Display only, and never trusted: a signed-in user can write this with `auth.updateUser()`. */
  user_metadata?: Record<string, unknown> | undefined;
}

/** The player row behind an admin session, and the group they were checked against. */
export interface AdminIdentity {
  userId: string;
  discordId: string;
  playerId: string;
  /**
   * The group this request acts on, already checked: the session's player is an admin of it.
   * Every admin handler scopes its reads and writes to this and nothing else.
   */
  groupId: string;
  puuid: string;
  displayName: string | null;
  /** From the session, for the "signed in as" line only. */
  email: string | null;
  discordName: string | null;
}

export interface AdminPlayerRecord {
  playerId: string;
  puuid: string;
  displayName: string | null;
}

export type AdminAuthResult =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; status: 400 | 401 | 403; error: string };

export type SessionUserResolver = () => Promise<SessionUserLike | null>;
export type AdminPlayerLookup = (discordId: string) => Promise<AdminPlayerRecord | null>;

/** The reason strings, exported so the route tests assert these and not literals. */
export const ADMIN_GROUP_REQUIRED = 'groupId is required';
export const NOT_A_GROUP_ADMIN = 'not an admin of this group';

export interface AuthorizeAdminOptions {
  resolveSessionUser: SessionUserResolver;
  lookupPlayerByDiscordId: AdminPlayerLookup;
  /** The session player's role in a group (`group_memberships`). */
  lookupGroupRole: GroupRoleLookup;
  /**
   * The group the request names, or `null` when it named none (or not a uuid). Checked **after**
   * the session, so an anonymous caller is a 401 whatever the body said.
   */
  groupId: string | null;
}

/**
 * Session and group in, admin identity or 400/401/403 out. Pure apart from the injected lookups.
 */
export async function authorizeAdmin(options: AuthorizeAdminOptions): Promise<AdminAuthResult> {
  const user = await options.resolveSessionUser();
  if (user === null) {
    return { ok: false, status: 401, error: 'sign in required' };
  }

  const discordId = discordIdFromUser(user);
  if (discordId === null) {
    return { ok: false, status: 403, error: 'this session has no Discord identity' };
  }

  const player = await options.lookupPlayerByDiscordId(discordId);
  if (player === null) {
    return { ok: false, status: 403, error: 'no player is linked to this Discord account' };
  }

  if (options.groupId === null || !groupIdSchema.safeParse(options.groupId).success) {
    return { ok: false, status: 400, error: ADMIN_GROUP_REQUIRED };
  }

  // Not a member and a member who is not an admin are one answer: neither may act here, and
  // telling them apart would tell an admin of another group who is in this one.
  if ((await options.lookupGroupRole(player.playerId, options.groupId)) !== 'admin') {
    return { ok: false, status: 403, error: NOT_A_GROUP_ADMIN };
  }

  return {
    ok: true,
    admin: {
      userId: user.id,
      discordId,
      playerId: player.playerId,
      groupId: options.groupId,
      puuid: player.puuid,
      displayName: player.displayName,
      email: user.email ?? null,
      discordName: discordNameFromUser(user),
    },
  };
}

/**
 * The Discord user id (snowflake) of a signed-in user, or null.
 *
 * Read from `user.identities[]` where `provider === 'discord'`: `UserIdentity.id` is
 * GoTrue's `auth.identities.provider_id`, i.e. the id the provider gave us, and nothing but
 * an OAuth round trip can write it. `user_metadata.provider_id` carries the same snowflake but
 * is **user-writable** through `auth.updateUser({ data })`, so trusting it would let any
 * Discord account claim an admin's snowflake. It is only ever read for display here.
 */
export function discordIdFromUser(user: SessionUserLike): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider !== 'discord') continue;
    const fromIdentity = nonEmpty(identity.id);
    if (fromIdentity !== null) return fromIdentity;
    // Older GoTrue rows carry the snowflake only inside identity_data.
    const data = identity.identity_data ?? {};
    return nonEmpty(data.provider_id) ?? nonEmpty(data.sub);
  }
  return null;
}

/** Display only. Whatever Discord called them at sign-in; never used to identify anyone. */
export function discordNameFromUser(user: SessionUserLike): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider !== 'discord') continue;
    const data = identity.identity_data ?? {};
    return nonEmpty(data.full_name) ?? nonEmpty(data.name) ?? nonEmpty(data.user_name);
  }
  const metadata = user.user_metadata ?? {};
  return nonEmpty(metadata.full_name) ?? nonEmpty(metadata.name) ?? nonEmpty(metadata.user_name);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Supabase-backed lookups
// ---------------------------------------------------------------------------

/** `auth.getUser()`, which verifies the JWT with the auth server rather than trusting a cookie. */
export function supabaseSessionUser(client: AuthClient): SessionUserResolver {
  return async () => {
    const { data, error } = await client.auth.getUser();
    if (error !== null || data.user === null) return null;
    return data.user;
  };
}

/**
 * `players` by `discord_id`, read with the **service role**: anon and authenticated have no
 * select privilege on that table at all (`0001_init.sql`), which is exactly why `discord_id`
 * lives there and not in `players_public`.
 */
export function supabaseAdminLookup(client: ServiceClient): AdminPlayerLookup {
  return async (discordId) => {
    const { data, error } = await client
      .from('players')
      .select('id, puuid, display_name')
      .eq('discord_id', discordId)
      .maybeSingle();

    if (error) throw new Error(`admin player lookup failed: ${error.message}`);
    if (!data) return null;

    return {
      playerId: data.id,
      puuid: data.puuid,
      displayName: data.display_name,
    };
  };
}

/** Everything the gate needs, wired to Supabase, for one group. */
export async function resolveAdmin(
  jar: CookieJar,
  client: ServiceClient,
  groupId: string | null,
): Promise<AdminAuthResult> {
  await ensureBootstrapAdmin(client);

  return authorizeAdmin({
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
    lookupPlayerByDiscordId: supabaseAdminLookup(client),
    lookupGroupRole: supabaseGroupRole(client),
    groupId,
  });
}
