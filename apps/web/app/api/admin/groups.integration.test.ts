import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAST_ADMIN, NO_SUCH_MEMBER } from '@/lib/admin/members';
import { NO_SUCH_LOBBY } from '@/lib/admin/reroll';
import { NO_SUCH_TOKEN } from '@/lib/admin/tokens';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { mintCompanionToken } from '@/lib/companionAuth';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Group admin, across every `/api/admin/*` route (M13.4, acceptance 1 and 2), against the local
 * stack with only the session injected: the `players` lookup and the `group_memberships` role are
 * read for real.
 *
 * Two throwaway groups. Hana is an admin of A and only a member of B. Omar is a member of A and
 * carries the retired `players.is_admin = true`, which must grant nothing. Zoe is in B only, with
 * a token of B's; B has a lobby of its own.
 *
 * - Admin of A naming B: 403 on every route.
 * - A member of A who is not an admin: 403 on every route.
 * - Admin of A naming A, about one of B's ids (a lobby, a player, a token): 404, nothing written —
 *   an admin of A does not learn which of B's ids exist.
 * - Demoting the last admin: 409 with the sentence; with two admins it succeeds; two admins
 *   demoting each other at the same moment leave exactly one.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('group admin against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { withAdminAuth } = await import('@/lib/adminRoute');
  const { handleAdminTokens, MINT_GONE } = await import('./tokens/handler');
  const { adminTokensRequestSchema } = await import('./tokens/schema');
  const { handleDiscordConfig } = await import('./discord-config/handler');
  const { discordConfigRequestSchema } = await import('./discord-config/schema');
  const { fearlessResetRoute } = await import('./fearless/reset/handler');
  const { memberRoleRoute } = await import('./members/role/handler');
  const { rollRoute } = await import('./lobbies/[lobbyId]/roll/handler');
  const { rerollRoute } = await import('./lobbies/[lobbyId]/reroll/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const puuid = { hana: `it-${runId}-ga-hana`, omar: `it-${runId}-ga-omar`, zoe: `it-${runId}-ga-zoe` };
  const discord = { hana: `7${digits}00001`, omar: `7${digits}00002` };
  const groups = { a: '', b: '' };
  const player = { hana: '', omar: '', zoe: '' };
  let lobbyB = '';
  let tokenB = '';

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /** The real gate, session injected: the membership in the body's group is read for real. */
  function as(discordId: string): AdminRouteOptions {
    const user = sessionUser(discordId);
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<AdminAuthResult> =>
        authorizeAdmin({
          resolveSessionUser: async () => user,
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
        }),
    };
  }

  function post(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/admin/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  interface Answer {
    status: number;
    json: Record<string, unknown>;
  }

  async function call(
    route: (request: Request) => Promise<Response>,
    body: Record<string, unknown>,
  ): Promise<Answer> {
    const response = await route(post(body));
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  /**
   * Every admin route, as `discordId`, with a body that is valid for `groupId` — so the only
   * thing that can refuse it is the group gate.
   */
  function everyRoute(discordId: string, groupId: string) {
    const options = as(discordId);
    return {
      tokens: () =>
        call(withAdminAuth(adminTokensRequestSchema, handleAdminTokens, options), {
          groupId,
          action: 'mint',
          playerId: player.zoe,
          label: null,
        }),
      discord: () =>
        call(withAdminAuth(discordConfigRequestSchema, handleDiscordConfig, options), {
          groupId,
          guildId: `it-${runId}-guild`,
          webhookUrl: '',
          resultsChannelId: '',
          lobbyVoiceChannelId: '',
          blueVoiceChannelId: '',
          redVoiceChannelId: '',
        }),
      fearless: () => call(fearlessResetRoute(options), { groupId }),
      memberRole: () => call(memberRoleRoute(options), { groupId, playerId: player.zoe, role: 'admin' }),
      roll: () => call(rollRoute(lobbyB, options), { groupId, rosterKey: 'anything' }),
      reroll: () => call(rerollRoute(lobbyB, options), { groupId, splitId: randomUUID() }),
    };
  }

  async function roleIn(groupId: string, playerId: string): Promise<string | null> {
    const { data } = await db
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', playerId)
      .maybeSingle();
    return data?.role ?? null;
  }

  async function adminsOf(groupId: string): Promise<number> {
    const { count } = await db
      .from('group_memberships')
      .select('player_id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('role', 'admin');
    return count ?? 0;
  }

  /** Nothing any refused request below may have written, in B. */
  async function bSnapshot(): Promise<string> {
    const [zoe, tokens, config, fearless, lobby, memberships] = await Promise.all([
      db.from('players').select('display_name').eq('id', player.zoe).single(),
      db.from('companion_tokens').select('id, revoked_at').eq('group_id', groups.b).order('id'),
      db.from('discord_config').select('*').eq('group_id', groups.b),
      db.from('fearless_state').select('reset_at').eq('group_id', groups.b),
      db.from('lobbies').select('status, updated_at').eq('id', lobbyB).single(),
      db.from('group_memberships').select('player_id, role').eq('group_id', groups.b).order('player_id'),
    ]);
    return JSON.stringify([zoe.data, tokens.data, config.data, fearless.data, lobby.data, memberships.data]);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(db, [{ puuid: puuid.hana }, { puuid: puuid.omar }, { puuid: puuid.zoe }]);
    player.hana = ids.get(puuid.hana) ?? '';
    player.omar = ids.get(puuid.omar) ?? '';
    player.zoe = ids.get(puuid.zoe) ?? '';
    Object.assign(
      groups,
      await createTestGroups(db, runId, ['ga', 'gb'] as const).then((made) => ({
        a: made.ga,
        b: made.gb,
      })),
    );

    await db.from('players').update({ discord_id: discord.hana }).eq('id', player.hana);
    // The retired global flag, on a plain member: it must open nothing (acceptance 3).
    await db.from('players').update({ discord_id: discord.omar, is_admin: true }).eq('id', player.omar);

    await setTestMembership(db, groups.a, player.hana, 'admin');
    await setTestMembership(db, groups.b, player.hana, 'member');
    await setTestMembership(db, groups.a, player.omar, 'member');
    await setTestMembership(db, groups.b, player.zoe, 'admin');

    const { tokenHash } = mintCompanionToken();
    const token = await db
      .from('companion_tokens')
      .insert({ group_id: groups.b, player_id: player.zoe, token_hash: tokenHash, label: `ga-${runId}` })
      .select('id')
      .single();
    if (token.error) throw new Error(token.error.message);
    tokenB = token.data.id;

    const lobby = await db
      .from('lobbies')
      .insert({ group_id: groups.b, lcu_party_id: `ga-${runId}-b`, status: 'open' })
      .select('id')
      .single();
    if (lobby.error) throw new Error(lobby.error.message);
    lobbyB = lobby.data.id;
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', Object.values(puuid));
  });

  describe('the gate is the role in the request group (acceptance 1)', () => {
    it('is 403 on every admin route for an admin of A naming B, and writes nothing in B', async () => {
      const before = await bSnapshot();
      for (const [name, run] of Object.entries(everyRoute(discord.hana, groups.b))) {
        const answer = await run();
        expect([name, answer.status, answer.json.error]).toEqual([name, 403, NOT_A_GROUP_ADMIN]);
      }
      expect(await bSnapshot()).toBe(before);
    });

    it('is 403 on every admin route for a member of A who is not an admin, whatever players.is_admin says', async () => {
      for (const [name, run] of Object.entries(everyRoute(discord.omar, groups.a))) {
        const answer = await run();
        expect([name, answer.status, answer.json.error]).toEqual([name, 403, NOT_A_GROUP_ADMIN]);
      }
    });

    it("is 404, not 403, for one of B's lobbies, players or tokens under A, and writes nothing", async () => {
      const before = await bSnapshot();
      const underA = everyRoute(discord.hana, groups.a);

      // B's lobby under A: both lobby routes answer exactly like a lobby that does not exist.
      for (const run of [underA.roll, underA.reroll]) {
        const answer = await run();
        expect([answer.status, answer.json.error]).toEqual([404, NO_SUCH_LOBBY]);
      }
      // B's player under A.
      const member = await underA.memberRole();
      expect([member.status, member.json.error]).toEqual([404, NO_SUCH_MEMBER]);
      // M17.12: a mint is a 410 for any player now, and still writes nothing in B.
      const mint = await underA.tokens();
      expect([mint.status, mint.json.error]).toEqual([410, MINT_GONE]);
      // B's token under A.
      const revoke = await call(
        withAdminAuth(adminTokensRequestSchema, handleAdminTokens, as(discord.hana)),
        {
          groupId: groups.a,
          action: 'revoke',
          tokenId: tokenB,
        },
      );
      expect([revoke.status, revoke.json.error]).toEqual([404, NO_SUCH_TOKEN]);

      expect(await bSnapshot()).toBe(before);
    });

    it("moves only the request group's fearless cursor", async () => {
      const before = await bSnapshot();
      const answer = await everyRoute(discord.hana, groups.a).fearless();
      expect(answer.status).toBe(200);
      const { data } = await db.from('fearless_state').select('reset_at').eq('group_id', groups.a).single();
      expect(Date.parse(data?.reset_at ?? '')).toBe(Date.parse(String(answer.json.resetAt)));
      expect(await bSnapshot()).toBe(before);
    });
  });

  describe('POST /api/admin/members/role (acceptance 2)', () => {
    const roleRoute = (discordId: string) => memberRoleRoute(as(discordId));

    it('refuses to demote the last admin, with the sentence, and writes nothing', async () => {
      expect(await adminsOf(groups.a)).toBe(1);
      const answer = await call(roleRoute(discord.hana), {
        groupId: groups.a,
        playerId: player.hana,
        role: 'member',
      });
      expect(answer).toEqual({ status: 409, json: { ok: false, error: LAST_ADMIN } });
      expect(LAST_ADMIN).toBe('This group needs at least one admin.');
      expect(await roleIn(groups.a, player.hana)).toBe('admin');
    });

    it('promotes a member, answers a repeat press as unchanged, and lets an admin step down once there are two', async () => {
      const promoted = await call(roleRoute(discord.hana), {
        groupId: groups.a,
        playerId: player.omar,
        role: 'admin',
      });
      expect(promoted).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.a, playerId: player.omar, role: 'admin', changed: true },
      });
      const again = await call(roleRoute(discord.hana), {
        groupId: groups.a,
        playerId: player.omar,
        role: 'admin',
      });
      expect(again.json).toMatchObject({ ok: true, changed: false });

      // Two admins: Hana hands the group on by stepping down herself.
      const stepDown = await call(roleRoute(discord.hana), {
        groupId: groups.a,
        playerId: player.hana,
        role: 'member',
      });
      expect(stepDown.status).toBe(200);
      expect(await roleIn(groups.a, player.hana)).toBe('member');
      // B is untouched by anything done in A: Hana is still B's member, Zoe still B's admin.
      expect(await roleIn(groups.b, player.hana)).toBe('member');
      expect(await roleIn(groups.b, player.zoe)).toBe('admin');

      // And Hana, no longer an admin of A, is now refused by the gate there.
      const refused = await call(roleRoute(discord.hana), {
        groupId: groups.a,
        playerId: player.hana,
        role: 'admin',
      });
      expect([refused.status, refused.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);

      // Omar is the last admin now.
      const last = await call(roleRoute(discord.omar), {
        groupId: groups.a,
        playerId: player.omar,
        role: 'member',
      });
      expect(last).toEqual({ status: 409, json: { ok: false, error: LAST_ADMIN } });
    });

    it('leaves exactly one admin when two admins demote each other at the same moment', async () => {
      // Back to two admins.
      await call(roleRoute(discord.omar), { groupId: groups.a, playerId: player.hana, role: 'admin' });
      expect(await adminsOf(groups.a)).toBe(2);

      const [hanaDemotesOmar, omarDemotesHana] = await Promise.all([
        call(roleRoute(discord.hana), { groupId: groups.a, playerId: player.omar, role: 'member' }),
        call(roleRoute(discord.omar), { groupId: groups.a, playerId: player.hana, role: 'member' }),
      ]);
      // Both passed the gate (both were admins when they pressed); the database decided. A is
      // ownerless, so M13.4's rules hold. Since 0023 (M14.11) set_group_member_role_v2 re-checks
      // the actor's own role under the group's row lock, so the press that waits finds its actor
      // already demoted and is refused as no longer an admin (403), before the last-admin check.
      const answers = [hanaDemotesOmar, omarDemotesHana].sort((x, y) => x.status - y.status);
      expect(answers.map((a) => a.status)).toEqual([200, 403]);
      expect(answers[1]?.json).toEqual({ ok: false, error: NOT_A_GROUP_ADMIN });
      expect(await adminsOf(groups.a)).toBe(1);
    });
  });
}
