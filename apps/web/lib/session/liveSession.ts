import {
  type GroupRole,
  groupIdSchema,
  groupRoleSchema,
  type SessionClaims,
  type SessionPlayerRow,
  sessionClaimsSchema,
  sessionPlayerRowSchema,
} from '@customs/db/schemas';
import type { AdminPlayerLookup, SessionUserLike, SessionUserResolver } from '../adminAuth';
import type { GroupRoleLookup } from '../groups/membership';
import type { ServiceClient } from '../supabase';
import type { AuthClient } from '../supabaseAuth';

/**
 * The verified session lookup: who a signed-in request is, in two steps and one round trip.
 *
 *   1. **The access token's signature is verified locally** (`auth.getClaims()`). With asymmetric
 *      project signing keys (ES256/RS256 with a `kid`) that is WebCrypto against the project's JWKS,
 *      cached module-wide for 10 minutes: no network. With the legacy HS256 secret, auth-js falls
 *      back to `getUser()` on its own, which is exactly today's trust and today's cost, so shipping
 *      this before the owner migrates the keys (docs/runbooks/jwt-signing-keys.md) changes nothing.
 *   2. **One service-role call to `public.session_player`** (`0038`) with the verified `sub` and
 *      `session_id` and, when known, the group. It answers only while the `auth.sessions` row is
 *      live and the user is neither banned nor deleted, maps `auth.identities` (Discord) to the
 *      player, and returns that player's role in the group. It replaces `getUser` -> `players` ->
 *      `group_memberships`, so revocation stays immediate: signing out elsewhere deletes the row.
 *
 * Only signature-verified claims are read, and of those only `sub` and `session_id` decide
 * anything. `getSession()` is never trusted (getClaims calls it only to fetch the token out of the
 * cookie, and to refresh an expired one). `user_metadata` is never an identity: it is user-writable
 * and only ever names someone on screen. A token with no `session_id` fails closed.
 *
 * Every gate uses this: the page helpers (`currentLiveSession`), and through
 * {@link liveSessionLookups} the admin, setup, admin-read, `/api/me/*`, `/api/groups/*` and operator
 * gates. So writes and admin checks see the same answer the page did.
 *
 * Residual windows (accepted, documented in the runbook):
 *   - a signing key revoked in the dashboard stays trusted by a warm instance until its JWKS cache
 *     expires (up to 10 minutes). It still needs a live session row to pass step 2;
 *   - `email` and the display name come from the token, so a changed email or Discord name shows
 *     the old one until the token refreshes (at most the JWT expiry). Display only;
 *   - a session's inactivity timeout (if the project sets one) is enforced by GoTrue at refresh,
 *     as it is for `getUser()`; step 2 checks `not_after` (the time-box) directly.
 */

/** The player row behind a live session. */
export interface LivePlayer {
  playerId: string;
  puuid: string;
  displayName: string | null;
}

export type LiveSession =
  | { kind: 'anonymous' }
  /** A live session with no Discord identity. Only the operator (`SUPER_ADMIN_USER_IDS`) cares. */
  | { kind: 'no-discord'; userId: string; email: string | null }
  | {
      kind: 'signed-in';
      userId: string;
      /** From the token, for the "signed in as" line only. */
      email: string | null;
      /** `auth.identities.provider_id` for Discord, read by `0038`; never from `user_metadata`. */
      discordId: string;
      /** Display only, from the token's `user_metadata`. */
      discordName: string | null;
      /** `null`: M3.6's `That's me` case. */
      player: LivePlayer | null;
      /** The group {@link role} was read for, or `null` when none was asked. */
      groupId: string | null;
      /** The player's role in {@link groupId}; `null` when not a member, unlinked, or no group. */
      role: GroupRole | null;
    };

export const ANONYMOUS_SESSION: LiveSession = { kind: 'anonymous' };

/** The signature-verified claims of the request's access token, or `null`. */
export type VerifiedClaimsResolver = () => Promise<SessionClaims | null>;

/** `public.session_player`: one row while the session is live, `null` when it is not. */
export type SessionPlayerLookup = (
  userId: string,
  sessionId: string,
  groupId: string | null,
) => Promise<SessionPlayerRow | null>;

export interface ResolveLiveSessionOptions {
  verifyClaims: VerifiedClaimsResolver;
  lookupSessionPlayer: SessionPlayerLookup;
  /** The group to read the role in. Anything that is not a group id is read as none. */
  groupId: string | null;
}

/**
 * Claims in, live session out. Pure apart from the two injected steps, so every rule is a unit test
 * (`liveSession.test.ts`); the SQL half is `liveSession.integration.test.ts`.
 */
export async function resolveLiveSession(options: ResolveLiveSessionOptions): Promise<LiveSession> {
  const claims = await options.verifyClaims();
  if (claims === null) return ANONYMOUS_SESSION;

  const groupId =
    options.groupId !== null && groupIdSchema.safeParse(options.groupId).success ? options.groupId : null;
  const row = await options.lookupSessionPlayer(claims.sub, claims.session_id, groupId);
  // No row: signed out elsewhere, expired, banned or deleted. Exactly what getUser() would refuse.
  if (row === null) return ANONYMOUS_SESSION;

  const email = claims.email ?? null;
  if (row.discord_id === null) return { kind: 'no-discord', userId: claims.sub, email };

  const player: LivePlayer | null =
    row.player_id !== null && row.puuid !== null
      ? { playerId: row.player_id, puuid: row.puuid, displayName: row.display_name }
      : null;
  // A role the union does not know (a hand-edited row) grants nothing.
  const parsedRole = groupRoleSchema.safeParse(row.role);
  return {
    kind: 'signed-in',
    userId: claims.sub,
    email,
    discordId: row.discord_id,
    discordName: displayNameFromMetadata(claims.user_metadata ?? null),
    player,
    groupId,
    role: player !== null && groupId !== null && parsedRole.success ? parsedRole.data : null,
  };
}

/** Display only: whatever Discord called them at sign-in. Never used to identify anyone. */
function displayNameFromMetadata(metadata: Record<string, unknown> | null): string | null {
  if (metadata === null) return null;
  for (const key of ['full_name', 'name', 'user_name'] as const) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two Supabase-backed steps
// ---------------------------------------------------------------------------

/**
 * `auth.getClaims()`: local signature verification against the project's JWKS (asymmetric keys), or
 * auth-js's own fallback to `getUser()` (legacy HS256 secret, an unknown `kid`, no WebCrypto). Any
 * failure, and any token whose claims miss `sub` or `session_id`, is `null`: signed out.
 */
export function supabaseVerifiedClaims(client: AuthClient): VerifiedClaimsResolver {
  return async () => {
    let result: Awaited<ReturnType<AuthClient['auth']['getClaims']>>;
    try {
      result = await client.auth.getClaims();
    } catch (error) {
      // auth-js throws (rather than returns) for a header it cannot use, e.g. an unknown `alg`.
      // A token we cannot verify is no session.
      console.error('verifying the session token failed', error instanceof Error ? error.message : error);
      return null;
    }
    if (result.error !== null || result.data === null) return null;
    const parsed = sessionClaimsSchema.safeParse(result.data.claims);
    return parsed.success ? parsed.data : null;
  };
}

/**
 * `public.session_player` with the **service role** (the only role that may execute it). A GET, so
 * Next's per-render fetch memoisation folds identical calls too (the function is `stable`).
 * A database error throws: each caller decides whether that is "signed out" or an error page.
 */
export function supabaseSessionPlayer(client: ServiceClient): SessionPlayerLookup {
  return async (userId, sessionId, groupId) => {
    const args =
      groupId === null
        ? { p_user_id: userId, p_session_id: sessionId }
        : { p_user_id: userId, p_session_id: sessionId, p_group_id: groupId };
    const { data, error } = await client.rpc('session_player', args, { get: true });
    if (error) throw new Error(`session lookup failed: ${error.message}`);
    const rows: unknown[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) return null;
    const parsed = sessionPlayerRowSchema.safeParse(rows[0]);
    if (!parsed.success) throw new Error('session lookup returned a malformed row');
    return parsed.data;
  };
}

/** Both steps for one request's cookies; resolve as often as needed, it runs once per group. */
export function liveSessionResolver(
  authClient: AuthClient,
  serviceClient: ServiceClient,
): (groupId: string | null) => Promise<LiveSession> {
  const verifyClaims = once(supabaseVerifiedClaims(authClient));
  const lookupSessionPlayer = supabaseSessionPlayer(serviceClient);
  const byGroup = new Map<string, Promise<LiveSession>>();
  return (groupId) => {
    const key = groupId ?? '';
    let pending = byGroup.get(key);
    if (pending === undefined) {
      pending = resolveLiveSession({ verifyClaims, lookupSessionPlayer, groupId });
      byGroup.set(key, pending);
    }
    return pending;
  };
}

function once<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= run();
    return pending;
  };
}

// ---------------------------------------------------------------------------
// The adapter for the existing pure gates
// ---------------------------------------------------------------------------

export interface SessionGateLookups {
  resolveSessionUser: SessionUserResolver;
  lookupPlayerByDiscordId: AdminPlayerLookup;
  lookupGroupRole: GroupRoleLookup;
}

/**
 * The three lookups `authorizeAdmin`, `authorizeSetupWrite`, `authorizeAdminRead`, `authorizeMe` and
 * `authorizeOperator` take, all answered by **one** live-session resolution for `groupId`. The
 * gates keep their rules and their tests; only where the answers come from changes.
 *
 * A role asked for any other group or player than the one resolved (none of today's gates does)
 * goes to `fallbackRole`, the plain `group_memberships` read.
 */
export function liveSessionLookups(
  resolve: (groupId: string | null) => Promise<LiveSession>,
  groupId: string | null,
  fallbackRole: GroupRoleLookup,
): SessionGateLookups {
  const session = () => resolve(groupId);
  return {
    resolveSessionUser: async () => sessionUserOf(await session()),
    lookupPlayerByDiscordId: async (discordId) => {
      const live = await session();
      if (live.kind !== 'signed-in' || live.discordId !== discordId || live.player === null) return null;
      return { ...live.player };
    },
    lookupGroupRole: async (playerId, asked) => {
      const live = await session();
      if (live.kind === 'signed-in' && live.player?.playerId === playerId && live.groupId === asked) {
        return live.role;
      }
      return fallbackRole(playerId, asked);
    },
  };
}

/**
 * A live session in the shape the gates read (`SessionUserLike`). The Discord identity in it is the
 * one `0038` read from `auth.identities`, so `discordIdFromUser` finds the verified snowflake; the
 * name rides in `identity_data` for `discordNameFromUser`, display only.
 */
export function sessionUserOf(live: LiveSession): SessionUserLike | null {
  if (live.kind === 'anonymous') return null;
  if (live.kind === 'no-discord') return { id: live.userId, email: live.email, identities: [] };
  return {
    id: live.userId,
    email: live.email,
    identities: [
      {
        id: live.discordId,
        provider: 'discord',
        identity_data: live.discordName === null ? {} : { full_name: live.discordName },
      },
    ],
  };
}
