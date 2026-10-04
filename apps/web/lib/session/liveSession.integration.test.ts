import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authorizeAdmin, NOT_A_GROUP_ADMIN, sessionLookups } from '@/lib/adminAuth';
import { createServiceClient } from '@/lib/supabase';
import { type CookieRecord, createAuthClient, readOnlyCookieJar } from '@/lib/supabaseAuth';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { type LiveSession, liveSessionResolver, supabaseVerifiedClaims } from './liveSession';

/**
 * The verified session lookup against the real thing: a password user signed in at the local
 * GoTrue (whose access tokens are ES256 with a `kid`, so `getClaims()` verifies them locally), the
 * real `public.session_player` (0038), real `auth.sessions` / `auth.identities` / `auth.users` rows.
 *
 * Proves, on one genuine token:
 *   - no GoTrue round trip once the JWKS is cached (the point of the change);
 *   - the admin gate passes for an admin of the group and refuses another group and a member;
 *   - an unlinked Discord identity, a banned user, a soft-deleted user, an expired session time-box
 *     and a signed-out session (rows deleted) are all refused at once, while the token itself still
 *     verifies: the lookup, not the token's expiry, is what closes them;
 *   - anon and authenticated cannot execute the function.
 *
 * The Discord identity is a fabricated `auth.identities` row; no real Discord account is involved.
 * Everything is deleted after.
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

if (stack === null || authUsers === null) {
  describe.skip('verified session lookup against the local Supabase stack', () => {
    it('needs the local stack (`pnpm db:start`)', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3114';

  const db = createServiceClient();
  const runId = randomUUID().slice(0, 8);
  const email = `verified-session-${runId}@example.invalid`;
  const password = `pw-${randomUUID()}`;
  const snowflake = `9${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let userId = '';
  let playerId = '';
  let groups: Record<'mine' | 'other', string> = { mine: '', other: '' };
  let cookies: CookieRecord[] = [];
  let accessToken = '';

  const live = (groupId: string | null): Promise<LiveSession> =>
    liveSessionResolver(createAuthClient(readOnlyCookieJar(cookies)), db)(groupId);

  const asAdmin = (groupId: string) =>
    authorizeAdmin({ ...sessionLookups(readOnlyCookieJar(cookies), db, groupId), groupId });

  const linkDiscord = () =>
    authUsers.sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
       values ('${snowflake}', '${userId}', '{"sub":"${snowflake}","full_name":"it ${runId}"}', 'discord', now(), now(), now());`,
    );

  beforeAll(async () => {
    userId = authUsers.createWithPassword(email, password);
    linkDiscord();

    const written = new Map<string, string>();
    const client = createServerClient(stack.url, stack.anonKey, {
      cookies: {
        getAll: () => [...written].map(([name, value]) => ({ name, value })),
        setAll: (set) => {
          for (const { name, value } of set) {
            if (value === '') written.delete(name);
            else written.set(name, value);
          }
        },
      },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    accessToken = data.session.access_token;
    cookies = [...written].map(([name, value]) => ({ name, value }));

    groups = await createTestGroups(db, runId, ['mine', 'other'] as const);
    const player = await db
      .from('players')
      .insert({ puuid: `it-${runId}-session`, display_name: `it ${runId}`, discord_id: snowflake })
      .select('id')
      .single();
    if (player.error) throw new Error(player.error.message);
    playerId = player.data.id;
    await setTestMembership(db, groups.mine, playerId, 'admin');
  }, 30_000);

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    if (playerId) await db.from('players').delete().eq('id', playerId);
    if (userId) authUsers.remove([userId]);
  });

  describe('verified session lookup against the local Supabase stack', () => {
    it('is handed an ES256 token with a kid, so getClaims verifies it locally', () => {
      const header = JSON.parse(Buffer.from(accessToken.split('.')[0] ?? '', 'base64url').toString()) as {
        alg: string;
        kid?: string;
      };
      expect(header.alg).toBe('ES256');
      expect(header.kid).toBeTruthy();
    });

    it('resolves the session, the player and the role in one database call and no GoTrue call', async () => {
      await live(groups.mine); // warms the module-wide JWKS cache
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const session = await live(groups.mine);
        expect(session).toMatchObject({
          kind: 'signed-in',
          userId,
          discordId: snowflake,
          discordName: null,
          player: { playerId, puuid: `it-${runId}-session` },
          groupId: groups.mine,
          role: 'admin',
        });
        const urls = fetchSpy.mock.calls.map(([input]) =>
          String(input instanceof Request ? input.url : input),
        );
        expect(urls.filter((url) => url.includes('/auth/v1/'))).toEqual([]);
        expect(urls.filter((url) => url.includes('/rest/v1/rpc/session_player'))).toHaveLength(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('passes the admin gate for its own group and refuses another group and a demotion', async () => {
      expect(await asAdmin(groups.mine)).toMatchObject({
        ok: true,
        admin: { userId, playerId, groupId: groups.mine },
      });
      expect(await asAdmin(groups.other)).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });
      expect(await live(groups.other)).toMatchObject({ kind: 'signed-in', role: null });

      await setTestMembership(db, groups.mine, playerId, 'member');
      try {
        expect(await asAdmin(groups.mine)).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });
      } finally {
        await setTestMembership(db, groups.mine, playerId, 'admin');
      }
    });

    it('reads a Discord account linked to no player as signed in with player null', async () => {
      await db.from('players').update({ discord_id: null }).eq('id', playerId);
      try {
        expect(await live(groups.mine)).toMatchObject({
          kind: 'signed-in',
          discordId: snowflake,
          player: null,
          role: null,
        });
      } finally {
        await db.from('players').update({ discord_id: snowflake }).eq('id', playerId);
      }
    });

    it('refuses an unlinked Discord identity at once, whatever user_metadata says', async () => {
      authUsers.sql(
        `update auth.users set raw_user_meta_data = '{"provider_id":"${snowflake}"}' where id = '${userId}';
         delete from auth.identities where user_id = '${userId}' and provider = 'discord';`,
      );
      try {
        expect(await live(groups.mine)).toEqual({ kind: 'no-discord', userId, email });
        expect(await asAdmin(groups.mine)).toMatchObject({ ok: false, status: 403 });
      } finally {
        linkDiscord();
      }
    });

    it('refuses a banned user, and lets them back when the ban is past', async () => {
      authUsers.sql(`update auth.users set banned_until = now() + interval '1 hour' where id = '${userId}';`);
      try {
        expect(await supabaseVerifiedClaims(createAuthClient(readOnlyCookieJar(cookies)))()).toMatchObject({
          sub: userId,
        });
        expect(await live(groups.mine)).toEqual({ kind: 'anonymous' });
        expect(await asAdmin(groups.mine)).toMatchObject({ ok: false, status: 401 });
      } finally {
        authUsers.sql(
          `update auth.users set banned_until = now() - interval '1 minute' where id = '${userId}';`,
        );
      }
      expect(await live(groups.mine)).toMatchObject({ kind: 'signed-in', role: 'admin' });
      authUsers.sql(`update auth.users set banned_until = null where id = '${userId}';`);
    });

    it('refuses a soft-deleted user', async () => {
      authUsers.sql(`update auth.users set deleted_at = now() where id = '${userId}';`);
      try {
        expect(await live(groups.mine)).toEqual({ kind: 'anonymous' });
      } finally {
        authUsers.sql(`update auth.users set deleted_at = null where id = '${userId}';`);
      }
    });

    it('refuses a session past its time-box (not_after)', async () => {
      authUsers.sql(
        `update auth.sessions set not_after = now() - interval '1 second' where user_id = '${userId}';`,
      );
      try {
        expect(await live(groups.mine)).toEqual({ kind: 'anonymous' });
      } finally {
        authUsers.sql(`update auth.sessions set not_after = null where user_id = '${userId}';`);
      }
    });

    it("answers nothing for a session id that is not this user's", async () => {
      const { data, error } = await db.rpc(
        'session_player',
        { p_user_id: userId, p_session_id: randomUUID(), p_group_id: groups.mine },
        { get: true },
      );
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('cannot be executed by anon or authenticated', async () => {
      const anon = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
      const asAnon = await anon.rpc('session_player', { p_user_id: userId, p_session_id: randomUUID() });
      expect(asAnon.error?.code).toBe('42501');

      const asUser = createClient(stack.url, stack.anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const signedIn = await asUser.rpc('session_player', { p_user_id: userId, p_session_id: randomUUID() });
      expect(signedIn.error?.code).toBe('42501');
    });

    // Last: it ends the session for good.
    it('refuses a signed-out session at once, though its token still verifies until it expires', async () => {
      authUsers.sql(`delete from auth.sessions where user_id = '${userId}';`);
      expect(await supabaseVerifiedClaims(createAuthClient(readOnlyCookieJar(cookies)))()).toMatchObject({
        sub: userId,
      });
      expect(await live(groups.mine)).toEqual({ kind: 'anonymous' });
      expect(await asAdmin(groups.mine)).toEqual({ ok: false, status: 401, error: 'sign in required' });
    });
  });
}
