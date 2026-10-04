import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { adminGroupResponseSchema, opsGroupsResponseSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITE_HIDDEN } from '@/lib/admin/readView';
import {
  type AdminAuthResult,
  type AdminReadResult,
  authorizeAdmin,
  authorizeAdminRead,
  type SessionUserLike,
  supabaseAdminLookup,
  supabaseGroupExists,
} from '@/lib/adminAuth';
import type { AdminReadRouteOptions, AdminRouteOptions } from '@/lib/adminRoute';
import { mintCompanionToken } from '@/lib/companionAuth';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { authorizeOperator } from '@/lib/ops/operator';
import { isSuperAdmin, SUPER_ADMIN_ENV, superAdminIds } from '@/lib/superAdmin';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The operator against the local stack (M13.6 acceptance 1 and 2, M14.19's masked invite), with
 * only the session injected: players, memberships, groups and invites are read for real.
 *
 * Two throwaway groups. Zoe is B's admin and B has a live invite, a token and a lobby. The operator
 * is on `SUPER_ADMIN_USER_IDS` and in no group, once with no Discord identity at all and once with
 * a linked player that is in no group.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the operator against the local Supabase stack', () => {
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
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

  const { withAdminAuth } = await import('@/lib/adminRoute');
  const { handleAdminTokens } = await import('../admin/tokens/handler');
  const { adminTokensRequestSchema } = await import('../admin/tokens/schema');
  const { handleDiscordConfig } = await import('../admin/discord-config/handler');
  const { discordConfigRequestSchema } = await import('../admin/discord-config/schema');
  const { fearlessResetRoute } = await import('../admin/fearless/reset/handler');
  const { inviteRotateRoute } = await import('../admin/invite/rotate/handler');
  const { memberRoleRoute } = await import('../admin/members/role/handler');
  const { memberRemoveRoute } = await import('../admin/members/remove/handler');
  const { ownerTransferRoute } = await import('../admin/owner/transfer/handler');
  const { setGroupModeRoute } = await import('../admin/mode/handler');
  const { rollRoute } = await import('../admin/lobbies/[lobbyId]/roll/handler');
  const { rerollRoute } = await import('../admin/lobbies/[lobbyId]/reroll/handler');
  const { adminGroupRoute } = await import('../admin/group/handler');
  const { opsGroupsRoute } = await import('./groups/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const puuid = { zoe: `it-${runId}-op-zoe`, op: `it-${runId}-op-op` };
  const discord = { zoe: `8${digits}00001`, op: `8${digits}00002` };
  const groups = { a: '', b: '' };
  const player = { zoe: '', op: '' };
  const inviteCode = `op${runId}`.padEnd(22, 'x');
  let lobbyB = '';

  const operatorId = randomUUID();
  const zoeUserId = randomUUID();

  const operatorBare: SessionUserLike = { id: operatorId, email: 'op@example.invalid', identities: [] };
  const operatorLinked: SessionUserLike = {
    id: operatorId,
    email: 'op@example.invalid',
    identities: [{ id: discord.op, provider: 'discord' }],
  };
  const zoe: SessionUserLike = {
    id: zoeUserId,
    email: 'zoe@example.invalid',
    identities: [{ id: discord.zoe, provider: 'discord' }],
  };

  function withList<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
    const before = process.env[SUPER_ADMIN_ENV];
    if (value === undefined) delete process.env[SUPER_ADMIN_ENV];
    else process.env[SUPER_ADMIN_ENV] = value;
    return run().finally(() => {
      if (before === undefined) delete process.env[SUPER_ADMIN_ENV];
      else process.env[SUPER_ADMIN_ENV] = before;
    });
  }

  /** The real read gate, session injected, the env list read at call time. */
  function readAs(user: SessionUserLike): AdminReadRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<AdminReadResult> =>
        authorizeAdminRead({
          resolveSessionUser: async () => user,
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
          isSuperAdmin: (id) => isSuperAdmin(id),
          groupExists: supabaseGroupExists(client),
        }),
    };
  }

  /** The real write gate, session injected. */
  function writeAs(user: SessionUserLike): AdminRouteOptions {
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

  async function getJson(route: (request: Request) => Promise<Response>, url: string) {
    const response = await route(new Request(url));
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function post(route: (request: Request) => Promise<Response>, body: Record<string, unknown>) {
    const response = await route(
      new Request('http://localhost/api/admin/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  function opsAs(user: SessionUserLike | null) {
    return opsGroupsRoute({
      getClient: () => db,
      authorize: () =>
        authorizeOperator({ superAdminIds: superAdminIds(), resolveSessionUser: async () => user }),
    });
  }

  /** Everything any refused write below could have touched in B. */
  async function bSnapshot(): Promise<string> {
    const [zoeRow, tokens, config, fearless, lobby, memberships, invite, mode] = await Promise.all([
      db.from('players').select('display_name').eq('id', player.zoe).single(),
      db.from('companion_tokens').select('id, revoked_at').eq('group_id', groups.b).order('id'),
      db.from('discord_config').select('*').eq('group_id', groups.b),
      db.from('fearless_state').select('reset_at').eq('group_id', groups.b),
      db.from('lobbies').select('status, updated_at').eq('id', lobbyB).single(),
      db.from('group_memberships').select('player_id, role').eq('group_id', groups.b).order('player_id'),
      db.from('group_invites').select('code, rotated_at').eq('group_id', groups.b),
      db.from('group_modes').select('*').eq('group_id', groups.b),
    ]);
    return JSON.stringify([
      zoeRow.data,
      tokens.data,
      config.data,
      fearless.data,
      lobby.data,
      memberships.data,
      invite.data,
      mode.data,
    ]);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(db, [{ puuid: puuid.zoe }, { puuid: puuid.op }]);
    player.zoe = ids.get(puuid.zoe) ?? '';
    player.op = ids.get(puuid.op) ?? '';
    const made = await createTestGroups(db, runId, ['opa', 'opb'] as const);
    groups.a = made.opa;
    groups.b = made.opb;

    await db.from('players').update({ discord_id: discord.zoe }).eq('id', player.zoe);
    await db.from('players').update({ discord_id: discord.op }).eq('id', player.op);
    await setTestMembership(db, groups.b, player.zoe, 'owner');

    const invite = await db.from('group_invites').insert({ group_id: groups.b, code: inviteCode });
    if (invite.error) throw new Error(invite.error.message);

    const { tokenHash } = mintCompanionToken();
    const token = await db
      .from('companion_tokens')
      .insert({ group_id: groups.b, player_id: player.zoe, token_hash: tokenHash, label: `op-${runId}` });
    if (token.error) throw new Error(token.error.message);

    const lobby = await db
      .from('lobbies')
      .insert({ group_id: groups.b, lcu_party_id: `op-${runId}-b`, status: 'open' })
      .select('id')
      .single();
    if (lobby.error) throw new Error(lobby.error.message);
    lobbyB = lobby.data.id;

    await db.from('discord_config').insert({
      group_id: groups.b,
      guild_id: `op-${runId}`,
      webhook_url: 'https://discord.com/api/webhooks/1/secret',
    });
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', Object.values(puuid));
  });

  describe("a super-admin in no group reads B's admin GETs (acceptance 1)", () => {
    it('reads the admin group read-only, with the invite masked', async () => {
      await withList(operatorId, async () => {
        for (const user of [operatorBare, operatorLinked]) {
          const answer = await getJson(
            adminGroupRoute(readAs(user)),
            `http://localhost/api/admin/group?groupId=${groups.b}`,
          );
          expect(answer.status).toBe(200);
          const body = adminGroupResponseSchema.parse(answer.json);
          expect(body.access).toEqual({ kind: 'operator', readOnly: true });
          expect(body.invite).toEqual({ state: 'hidden', message: INVITE_HIDDEN });
          expect(JSON.stringify(answer.json)).not.toContain(inviteCode);
        }
      });
    });

    it("shows B's own admin the link", async () => {
      await withList(operatorId, async () => {
        const answer = await getJson(
          adminGroupRoute(readAs(zoe)),
          `http://localhost/api/admin/group?groupId=${groups.b}`,
        );
        const body = adminGroupResponseSchema.parse(answer.json);
        expect(body.access).toEqual({ kind: 'group_admin', role: 'owner', readOnly: false });
        expect(body.invite).toMatchObject({
          state: 'shown',
          code: inviteCode,
          url: `http://localhost:3000/join/${inviteCode}`,
        });
      });
    });

    it('is 403 for the same session once the list is unset', async () => {
      await withList(undefined, async () => {
        const answer = await getJson(
          adminGroupRoute(readAs(operatorLinked)),
          `http://localhost/api/admin/group?groupId=${groups.b}`,
        );
        expect(answer.status).toBe(403);
      });
    });

    it('reads /api/ops/groups: every group with its counts, never the webhook', async () => {
      await withList(operatorId, async () => {
        const answer = await getJson(opsAs(operatorBare), 'http://localhost/api/ops/groups');
        expect(answer.status).toBe(200);
        const body = opsGroupsResponseSchema.parse(answer.json);
        const b = body.groups.find((group) => group.id === groups.b);
        const a = body.groups.find((group) => group.id === groups.a);
        expect(b).toMatchObject({ memberCount: 1, adminCount: 1, lastGameAt: null, webhookSet: true });
        expect(a).toMatchObject({ memberCount: 0, adminCount: 0, lastGameAt: null, webhookSet: false });
        expect(JSON.stringify(answer.json)).not.toContain('webhooks/1/secret');
      });
    });
  });

  describe('every admin POST is 403 for the super-admin (acceptance 1)', () => {
    it('refuses all ten writes in B and writes nothing', async () => {
      await withList(operatorId, async () => {
        const before = await bSnapshot();
        for (const user of [operatorBare, operatorLinked]) {
          const as = writeAs(user);
          const groupId = groups.b;
          const writes: Record<string, () => Promise<{ status: number }>> = {
            tokens: () =>
              post(withAdminAuth(adminTokensRequestSchema, handleAdminTokens, as), {
                groupId,
                action: 'mint',
                playerId: player.zoe,
                label: null,
              }),
            discord: () =>
              post(withAdminAuth(discordConfigRequestSchema, handleDiscordConfig, as), {
                groupId,
                guildId: 'x',
                webhookUrl: '',
                resultsChannelId: '',
                lobbyVoiceChannelId: '',
                blueVoiceChannelId: '',
                redVoiceChannelId: '',
              }),
            fearless: () => post(fearlessResetRoute(as), { groupId }),
            invite: () => post(inviteRotateRoute(as), { groupId }),
            memberRole: () => post(memberRoleRoute(as), { groupId, playerId: player.zoe, role: 'member' }),
            memberRemove: () => post(memberRemoveRoute(as), { groupId, playerId: player.zoe }),
            ownerTransfer: () => post(ownerTransferRoute(as), { groupId, playerId: player.zoe }),
            mode: () => post(setGroupModeRoute(as), { groupId, mode: 'fearless' }),
            roll: () => post(rollRoute(lobbyB, as), { groupId, rosterKey: 'anything' }),
            reroll: () => post(rerollRoute(lobbyB, as), { groupId, splitId: randomUUID() }),
          };
          for (const [name, run] of Object.entries(writes)) {
            expect([name, (await run()).status]).toEqual([name, 403]);
          }
        }
        expect(await bSnapshot()).toBe(before);
      });
    });
  });

  describe('the list empty or unset (acceptance 2)', () => {
    it('makes /api/ops/groups 403 for everyone, the would-be operator included', async () => {
      for (const value of [undefined, '', ' , ']) {
        await withList(value, async () => {
          for (const user of [operatorBare, zoe, null]) {
            const answer = await getJson(opsAs(user), 'http://localhost/api/ops/groups');
            expect(answer.status).toBe(403);
          }
        });
      }
    });

    it('is 403 for a signed-in non-operator and 401 for no session when the list is set', async () => {
      await withList(operatorId, async () => {
        expect((await getJson(opsAs(zoe), 'http://localhost/api/ops/groups')).status).toBe(403);
        expect((await getJson(opsAs(null), 'http://localhost/api/ops/groups')).status).toBe(401);
      });
    });
  });
}
