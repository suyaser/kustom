import { type AdminRole, type GroupRole, groupIdSchema, isAtLeast } from '@customs/db/schemas';
import { ensureBootstrapAdmin } from './bootstrapAdmin';
import { type GroupRoleLookup, supabaseGroupRole } from './groups/membership';
import type { ServiceClient } from './supabase';
import { type AuthClient, type CookieJar, createAuthClient } from './supabaseAuth';
import { isSuperAdmin } from './superAdmin';

/**
 * The admin gate: a Supabase session, and an `admin` or `owner` membership (`isAtLeast(role,
 * 'admin')`, M14.11) **in the request's group** (M13.4; `04-decisions.md` 2026-10-03, "Group admin is a membership role"). The old
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
  // `owner` is an admin and more (M14.11): the owner-only writes are re-checked inside their
  // definer functions, not here.
  if (!isAtLeast(await options.lookupGroupRole(player.playerId, options.groupId), 'admin')) {
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

// ---------------------------------------------------------------------------
// The setup gate: the four writes an unlinked group creator may make (M14.40)
// ---------------------------------------------------------------------------

/**
 * Who may make one of the **setup writes**: Connect Discord (its connect and callback routes),
 * the Discord test post, `discord-config`, and rotating the invite. Nothing else uses this gate.
 *
 * - `group_admin`: exactly what {@link authorizeAdmin} grants.
 * - `unlinked_creator`: the session whose verified auth user id is the group's `groups.created_by`
 *   (an `auth.users` id, `0018`) while **no player is linked to its Discord account**. STRATEGY
 *   3.1/3.2 let the checklist rows be done in any order, so the person who made the group can
 *   connect Discord and share the invite before they pair a League account. Once a player is
 *   linked the normal rule applies again (the creator becomes the owner on pairing; if they are
 *   somehow not an admin, they are refused like anyone else).
 *
 * Every other admin write (host tokens, roles, remove, transfer, reset, mode, roll) stays on
 * {@link authorizeAdmin}, which never reads `created_by`.
 */
export type SetupWriter =
  | { kind: 'group_admin'; userId: string; groupId: string; admin: AdminIdentity }
  | { kind: 'unlinked_creator'; userId: string; groupId: string; admin: null };

export type SetupWriteResult =
  | { ok: true; writer: SetupWriter }
  | { ok: false; status: 400 | 401 | 403; error: string };

/** `groups.created_by` for a group id, or null (no such group, or nobody recorded). */
export type GroupCreatorLookup = (groupId: string) => Promise<string | null>;

export interface AuthorizeSetupWriteOptions extends AuthorizeAdminOptions {
  lookupGroupCreator: GroupCreatorLookup;
}

/**
 * The setup gate: {@link authorizeAdmin} first; only when it refused because **no player is linked**
 * does `created_by` get a look. So anonymous is still 401, and every refusal for anyone who is not
 * the creator is the admin gate's own answer, word for word. The session is resolved once.
 */
export async function authorizeSetupWrite(options: AuthorizeSetupWriteOptions): Promise<SetupWriteResult> {
  let user: SessionUserLike | null | undefined;
  const resolveOnce: SessionUserResolver = async () => {
    if (user === undefined) user = await options.resolveSessionUser();
    return user;
  };
  let unlinked = false;
  const lookupPlayer: AdminPlayerLookup = async (discordId) => {
    const player = await options.lookupPlayerByDiscordId(discordId);
    unlinked = player === null;
    return player;
  };

  const asAdmin = await authorizeAdmin({
    ...options,
    resolveSessionUser: resolveOnce,
    lookupPlayerByDiscordId: lookupPlayer,
  });
  if (asAdmin.ok) {
    const { admin } = asAdmin;
    return { ok: true, writer: { kind: 'group_admin', userId: admin.userId, groupId: admin.groupId, admin } };
  }
  // Only "this Discord account has no player": a linked player who is not an admin, a session with
  // no Discord identity, and a missing group all keep the admin gate's answer.
  if (asAdmin.status !== 403 || !unlinked) return asAdmin;

  const sessionUser = await resolveOnce();
  const groupId = options.groupId;
  if (sessionUser === null || groupId === null || !groupIdSchema.safeParse(groupId).success) return asAdmin;

  const creator = await options.lookupGroupCreator(groupId);
  if (creator === null || creator.toLowerCase() !== sessionUser.id.toLowerCase()) return asAdmin;

  return { ok: true, writer: { kind: 'unlinked_creator', userId: sessionUser.id, groupId, admin: null } };
}

/** An {@link AdminAuthResult} (what the older test seams return) read as a setup-gate answer. */
export function toSetupWrite(result: AdminAuthResult | SetupWriteResult): SetupWriteResult {
  if (!result.ok || 'writer' in result) return result;
  const { admin } = result;
  return { ok: true, writer: { kind: 'group_admin', userId: admin.userId, groupId: admin.groupId, admin } };
}

/** `groups.created_by`, with the service role (the base table is service-role only, `0018`). */
export function supabaseGroupCreator(client: ServiceClient): GroupCreatorLookup {
  return async (groupId) => {
    if (!groupIdSchema.safeParse(groupId).success) return null;
    const { data, error } = await client.from('groups').select('created_by').eq('id', groupId).maybeSingle();
    if (error) throw new Error(`group creator lookup failed: ${error.message}`);
    return data?.created_by ?? null;
  };
}

/** The setup gate wired to Supabase, for one group. */
export async function resolveSetupWrite(
  jar: CookieJar,
  client: ServiceClient,
  groupId: string | null,
): Promise<SetupWriteResult> {
  await ensureBootstrapAdmin(client);

  return authorizeSetupWrite({
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
    lookupPlayerByDiscordId: supabaseAdminLookup(client),
    lookupGroupRole: supabaseGroupRole(client),
    lookupGroupCreator: supabaseGroupCreator(client),
    groupId,
  });
}

// ---------------------------------------------------------------------------
// The read gate: group admins, and the operator read-only (M13.6 / M14.19)
// ---------------------------------------------------------------------------

/**
 * Who may read a group's admin data, and how.
 *
 * - `group_admin`: an `admin` or `owner` of the group — exactly what {@link authorizeAdmin} grants. A
 *   super-admin who is also an admin of this group lands here and has that group's powers, no
 *   more and no fewer.
 * - `operator`: a session whose verified user id is in `SUPER_ADMIN_USER_IDS` and who is **not**
 *   an admin of this group. Reads only: every write still goes through {@link authorizeAdmin},
 *   which never looks at the list, and the invite link is masked for them (STRATEGY §3.3).
 *
 * A super-admin may have no Discord identity and no player at all; the auth user id is the whole
 * credential, so the operator variant carries no player fields.
 */
export type AdminReader =
  | {
      kind: 'group_admin';
      groupId: string;
      userId: string;
      readOnly: false;
      role: AdminRole;
      admin: AdminIdentity;
    }
  | {
      kind: 'operator';
      groupId: string;
      userId: string;
      readOnly: true;
      admin: null;
      /** From the session, for the "signed in as" line only. */
      email: string | null;
    };

export type AdminReadResult =
  | { ok: true; reader: AdminReader }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/** The 404 an operator gets for a group id that names no group. */
export const NO_SUCH_GROUP = 'no such group';

export interface AuthorizeAdminReadOptions extends AuthorizeAdminOptions {
  /** True when the verified user id is in `SUPER_ADMIN_USER_IDS` (`lib/superAdmin.ts`). */
  isSuperAdmin: (userId: string) => boolean;
  /** True when the group exists. Only asked for an operator: an admin's membership proves it. */
  groupExists: (groupId: string) => Promise<boolean>;
}

/**
 * The admin-read gate: {@link authorizeAdmin} first, and only when that refuses with a 403 does
 * the super-admin list get a look. So an anonymous caller is still 401, a request with no group
 * still 400, and a refusal for anyone not on the list is the admin gate's own answer, word for
 * word — the read gate never tells a non-operator that an operator path exists.
 *
 * The session is resolved once: the resolver is wrapped so the second look reuses the user.
 */
export async function authorizeAdminRead(options: AuthorizeAdminReadOptions): Promise<AdminReadResult> {
  let user: SessionUserLike | null | undefined;
  const resolveOnce: SessionUserResolver = async () => {
    if (user === undefined) user = await options.resolveSessionUser();
    return user;
  };

  let role: GroupRole | null = null;
  const lookupRole: GroupRoleLookup = async (playerId, groupId) => {
    role = await options.lookupGroupRole(playerId, groupId);
    return role;
  };

  const asAdmin = await authorizeAdmin({
    ...options,
    resolveSessionUser: resolveOnce,
    lookupGroupRole: lookupRole,
  });
  if (asAdmin.ok) {
    const { admin } = asAdmin;
    // The admin gate passed, so the role it read is admin or owner.
    const adminRole: AdminRole = role === 'owner' ? 'owner' : 'admin';
    return {
      ok: true,
      reader: {
        kind: 'group_admin',
        groupId: admin.groupId,
        userId: admin.userId,
        readOnly: false,
        role: adminRole,
        admin,
      },
    };
  }
  if (asAdmin.status !== 403) return asAdmin;

  const sessionUser = await resolveOnce();
  if (sessionUser === null || !options.isSuperAdmin(sessionUser.id)) return asAdmin;

  // The admin gate can refuse before it looked at the group (no Discord identity, no player), so
  // the group id is checked here in its own right.
  const groupId = options.groupId;
  if (groupId === null || !groupIdSchema.safeParse(groupId).success) {
    return { ok: false, status: 400, error: ADMIN_GROUP_REQUIRED };
  }
  if (!(await options.groupExists(groupId))) {
    return { ok: false, status: 404, error: NO_SUCH_GROUP };
  }

  return {
    ok: true,
    reader: {
      kind: 'operator',
      groupId,
      userId: sessionUser.id,
      readOnly: true,
      admin: null,
      email: sessionUser.email ?? null,
    },
  };
}

/** `groups` by id, with the service role. A non-uuid is false, not a 22P02. */
export function supabaseGroupExists(client: ServiceClient): (groupId: string) => Promise<boolean> {
  return async (groupId) => {
    if (!groupIdSchema.safeParse(groupId).success) return false;
    const { data, error } = await client.from('groups').select('id').eq('id', groupId).maybeSingle();
    if (error) throw new Error(`group lookup failed: ${error.message}`);
    return data !== null;
  };
}

/** The read gate wired to Supabase and the process environment, for one group. */
export async function resolveAdminRead(
  jar: CookieJar,
  client: ServiceClient,
  groupId: string | null,
): Promise<AdminReadResult> {
  await ensureBootstrapAdmin(client);

  return authorizeAdminRead({
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
    lookupPlayerByDiscordId: supabaseAdminLookup(client),
    lookupGroupRole: supabaseGroupRole(client),
    groupId,
    isSuperAdmin: (userId) => isSuperAdmin(userId),
    groupExists: supabaseGroupExists(client),
  });
}
