import type { SessionClaims, SessionPlayerRow } from '@customs/db/schemas';
import { describe, expect, it, vi } from 'vitest';
import { authorizeAdmin, discordIdFromUser, NOT_A_GROUP_ADMIN } from '../adminAuth';
import { authorizeMe } from '../me/identity';
import type { AuthClient } from '../supabaseAuth';
import {
  type LiveSession,
  liveSessionLookups,
  resolveLiveSession,
  type SessionPlayerLookup,
  sessionUserOf,
  supabaseVerifiedClaims,
} from './liveSession';

/**
 * The verified session gate (option 4 of the M19.12 auth-claims research): signature-verified claims,
 * then one `session_player` row. These are the TypeScript rules; the SQL rules (a revoked session, a
 * banned or deleted user, an unlinked identity, another group) are proved against the real function
 * in `liveSession.integration.test.ts`, and modelled here by what the function returns for them.
 */

const USER = '6b1c1f9e-6a43-4e1b-9d1c-5b7f0d3a2e11';
const SESSION = '2f0e9a3c-1d4b-4c8e-a7f6-3b2d1c0e9f88';
const GROUP = '7a9e2d41-8c3b-4f6a-b1e0-2d3c4b5a6f70';
const OTHER_GROUP = '00000000-0000-0000-0000-000000000001';
const PLAYER = '9c8b7a6f-5e4d-4c3b-a2b1-0f9e8d7c6b5a';

const CLAIMS: SessionClaims = {
  sub: USER,
  session_id: SESSION,
  email: 'owner@example.invalid',
  user_metadata: { full_name: 'shadowreaper', provider_id: '999999999999999999' },
};

const LINKED_ADMIN: SessionPlayerRow = {
  discord_id: '123456789012345678',
  player_id: PLAYER,
  puuid: 'puuid-1',
  display_name: 'Yasser',
  role: 'admin',
};

/** A stand-in for `session_player`: the row it would return for one live session, or nothing. */
function fakeLookup(row: SessionPlayerRow | null): SessionPlayerLookup & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const lookup = async (userId: string, sessionId: string, groupId: string | null) => {
    calls.push([userId, sessionId, groupId]);
    if (userId !== USER || sessionId !== SESSION) return null;
    // The SQL joins the membership on the group asked: no group, no role.
    return row === null ? null : { ...row, role: groupId === null ? null : row.role };
  };
  return Object.assign(lookup, { calls });
}

const resolve = (row: SessionPlayerRow | null, groupId: string | null = GROUP, claims = CLAIMS) =>
  resolveLiveSession({ verifyClaims: async () => claims, lookupSessionPlayer: fakeLookup(row), groupId });

describe('resolveLiveSession', () => {
  it('resolves a valid session to its player and its role in the group, in one lookup', async () => {
    const lookup = fakeLookup(LINKED_ADMIN);
    const live = await resolveLiveSession({
      verifyClaims: async () => CLAIMS,
      lookupSessionPlayer: lookup,
      groupId: GROUP,
    });
    expect(live).toEqual({
      kind: 'signed-in',
      userId: USER,
      email: 'owner@example.invalid',
      discordId: '123456789012345678',
      discordName: 'shadowreaper',
      player: { playerId: PLAYER, puuid: 'puuid-1', displayName: 'Yasser' },
      groupId: GROUP,
      role: 'admin',
    });
    expect(lookup.calls).toEqual([[USER, SESSION, GROUP]]);
  });

  it('is anonymous when the token did not verify or carried no session_id, and never asks the database', async () => {
    const lookup = fakeLookup(LINKED_ADMIN);
    const live = await resolveLiveSession({
      verifyClaims: async () => null,
      lookupSessionPlayer: lookup,
      groupId: GROUP,
    });
    expect(live).toEqual({ kind: 'anonymous' });
    expect(lookup.calls).toEqual([]);
  });

  it('is anonymous for a revoked, expired, banned or deleted session (the function returns no row)', async () => {
    expect(await resolve(null)).toEqual({ kind: 'anonymous' });
  });

  it('never takes the Discord id from user_metadata: no identity row is no-discord, whatever the token says', async () => {
    const live = await resolve({
      discord_id: null,
      player_id: null,
      puuid: null,
      display_name: null,
      role: null,
    });
    expect(live).toEqual({ kind: 'no-discord', userId: USER, email: 'owner@example.invalid' });
    expect(sessionUserOf(live)).toEqual({ id: USER, email: 'owner@example.invalid', identities: [] });
    expect(discordIdFromUser(sessionUserOf(live) ?? { id: '' })).toBeNull();
  });

  it("keeps a Discord account linked to no player as signed in with player null (the That's me case)", async () => {
    const live = await resolve({
      discord_id: '123',
      player_id: null,
      puuid: null,
      display_name: null,
      role: null,
    });
    expect(live).toMatchObject({ kind: 'signed-in', discordId: '123', player: null, role: null });
  });

  it('reads no role for another group (the function joins the membership on the group asked)', async () => {
    const live = await resolve({ ...LINKED_ADMIN, role: null }, OTHER_GROUP);
    expect(live).toMatchObject({ kind: 'signed-in', groupId: OTHER_GROUP, role: null });
  });

  it('grants nothing for a role it does not know', async () => {
    expect(await resolve({ ...LINKED_ADMIN, role: 'superuser' })).toMatchObject({ role: null });
  });

  it('reads a group id that is not a uuid as no group, so it never reaches Postgres as 22P02', async () => {
    const lookup = fakeLookup(LINKED_ADMIN);
    const live = await resolveLiveSession({
      verifyClaims: async () => CLAIMS,
      lookupSessionPlayer: lookup,
      groupId: 'not-a-uuid',
    });
    expect(lookup.calls).toEqual([[USER, SESSION, null]]);
    expect(live).toMatchObject({ groupId: null, role: null });
  });
});

describe('supabaseVerifiedClaims', () => {
  const client = (getClaims: () => Promise<unknown>) => ({ auth: { getClaims } }) as unknown as AuthClient;
  const ok = (claims: Record<string, unknown>) => async () => ({
    data: { claims, header: {}, signature: new Uint8Array() },
    error: null,
  });

  it('returns the verified claims', async () => {
    const claims = await supabaseVerifiedClaims(
      client(ok({ ...CLAIMS, role: 'authenticated', aal: 'aal1' })),
    )();
    expect(claims).toEqual(CLAIMS);
  });

  it('fails closed on a verified token without session_id (an anon or service-role key, a hand-minted JWT)', async () => {
    expect(await supabaseVerifiedClaims(client(ok({ sub: USER, role: 'service_role' })))()).toBeNull();
  });

  it('fails closed on a sub that is not a uuid', async () => {
    expect(await supabaseVerifiedClaims(client(ok({ sub: 'admin', session_id: SESSION })))()).toBeNull();
  });

  it('is null when verification failed or there is no session', async () => {
    expect(
      await supabaseVerifiedClaims(
        client(async () => ({ data: null, error: new Error('Invalid JWT signature') })),
      )(),
    ).toBeNull();
    expect(await supabaseVerifiedClaims(client(async () => ({ data: null, error: null })))()).toBeNull();
  });

  it('is null when auth-js throws on a header it cannot use (an unknown alg)', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      await supabaseVerifiedClaims(
        client(async () => {
          throw new Error('Invalid alg claim');
        }),
      )(),
    ).toBeNull();
    quiet.mockRestore();
  });
});

describe('liveSessionLookups: the existing gates over one live session', () => {
  const asResolver = (live: LiveSession) => {
    const calls: Array<string | null> = [];
    const fn = async (groupId: string | null) => {
      calls.push(groupId);
      return live;
    };
    return Object.assign(fn, { calls });
  };
  const signedIn = (
    role: Extract<LiveSession, { kind: 'signed-in' }>['role'],
    groupId: string | null = GROUP,
  ): LiveSession => ({
    kind: 'signed-in',
    userId: USER,
    email: null,
    discordId: '123456789012345678',
    discordName: 'shadowreaper',
    player: { playerId: PLAYER, puuid: 'puuid-1', displayName: 'Yasser' },
    groupId,
    role,
  });
  const noFallback = async () => {
    throw new Error('the role must come from the session lookup');
  };

  it('lets an admin of the group through authorizeAdmin with no read beyond the session lookup', async () => {
    const resolver = asResolver(signedIn('owner'));
    const result = await authorizeAdmin({
      ...liveSessionLookups(resolver, GROUP, noFallback),
      groupId: GROUP,
    });
    expect(result).toMatchObject({
      ok: true,
      admin: {
        userId: USER,
        discordId: '123456789012345678',
        playerId: PLAYER,
        groupId: GROUP,
        discordName: 'shadowreaper',
      },
    });
    expect(new Set(resolver.calls)).toEqual(new Set([GROUP]));
  });

  it('refuses a member who is not an admin, and a non-member', async () => {
    for (const role of ['member', null] as const) {
      const result = await authorizeAdmin({
        ...liveSessionLookups(asResolver(signedIn(role)), GROUP, noFallback),
        groupId: GROUP,
      });
      expect(result).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });
    }
  });

  it('is 401 for a session that is not live, before the group is looked at', async () => {
    const result = await authorizeAdmin({
      ...liveSessionLookups(asResolver({ kind: 'anonymous' }), GROUP, noFallback),
      groupId: null,
    });
    expect(result).toEqual({ ok: false, status: 401, error: 'sign in required' });
  });

  it('asks the plain membership read for any other group than the one resolved', async () => {
    const fallback = vi.fn(async () => 'admin' as const);
    const lookups = liveSessionLookups(asResolver(signedIn('member')), GROUP, fallback);
    expect(await lookups.lookupGroupRole(PLAYER, OTHER_GROUP)).toBe('admin');
    expect(fallback).toHaveBeenCalledWith(PLAYER, OTHER_GROUP);
    expect(await lookups.lookupGroupRole(PLAYER, GROUP)).toBe('member');
  });

  it('gives /api/me/* the same identity: the player, or null for an unlinked Discord account', async () => {
    const linked = await authorizeMe(liveSessionLookups(asResolver(signedIn(null, null)), null, noFallback));
    expect(linked).toMatchObject({
      ok: true,
      me: { userId: USER, discordId: '123456789012345678', player: { playerId: PLAYER, puuid: 'puuid-1' } },
    });

    const unlinked = await authorizeMe(
      liveSessionLookups(
        asResolver({ ...signedIn(null, null), player: null } as LiveSession),
        null,
        noFallback,
      ),
    );
    expect(unlinked).toMatchObject({ ok: true, me: { player: null } });

    const noDiscord = await authorizeMe(
      liveSessionLookups(asResolver({ kind: 'no-discord', userId: USER, email: null }), null, noFallback),
    );
    expect(noDiscord).toEqual({ ok: false, status: 403, error: 'this session has no Discord identity' });
  });
});
