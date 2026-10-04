import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGroupMembers } from '@/lib/admin/groupMembers';
import { NO_SUCH_MEMBER, ONLY_OWNER } from '@/lib/admin/members';
import { ONLY_OWNER_UNLINKS_OWNER, OWNER_UNLINKS_SELF } from '@/lib/admin/unlinkDiscord';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `Unlink Discord` (M14.60) against the local stack: the real admin gate (session injected, the
 * player looked up by `discord_id` and the role read for real), the real memberships read and the
 * real `players` write.
 *
 * Group U has an owner (Olga), two admins (Ali, Ada) and a member (Mo); Mo is also a member of
 * group V, whose owner is Vic, to prove the unlink reaches every group and that V's owner cannot
 * reach into U. Each run makes its own groups and players and deletes them after.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('Unlink Discord against the local Supabase stack', () => {
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

  const { memberUnlinkDiscordRoute } = await import('./members/unlink-discord/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const PEOPLE = ['olga', 'ali', 'ada', 'mo', 'vic', 'out'] as const;
  type Person = (typeof PEOPLE)[number];
  const puuid = Object.fromEntries(PEOPLE.map((name) => [name, `it-${runId}-ud-${name}`])) as Record<
    Person,
    string
  >;
  const discord = Object.fromEntries(
    PEOPLE.map((name, index) => [name, `7${digits}${String(index).padStart(3, '0')}`]),
  ) as Record<Person, string>;
  const player = {} as Record<Person, string>;
  const groups = { u: '', v: '' };

  function as(person: Person): AdminRouteOptions {
    const user: SessionUserLike = {
      id: randomUUID(),
      email: `${discord[person]}@example.invalid`,
      identities: [{ id: discord[person], provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
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

  async function unlink(actor: Person, target: Person, groupId = groups.u) {
    const response = await memberUnlinkDiscordRoute(as(actor))(
      new Request('http://localhost/api/admin/members/unlink-discord', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId, playerId: player[target] }),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function playerRow(person: Person) {
    const { data, error } = await db.from('players').select('*').eq('id', player[person]).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function roles(groupId: string) {
    const { data, error } = await db
      .from('group_memberships')
      .select('player_id, role, ai_opt_out')
      .eq('group_id', groupId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data;
  }

  /** Every test starts from everybody linked. */
  async function relinkAll(): Promise<void> {
    for (const name of PEOPLE) {
      const { error } = await db.from('players').update({ discord_id: discord[name] }).eq('id', player[name]);
      if (error) throw new Error(error.message);
    }
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      PEOPLE.map((name) => ({ puuid: puuid[name], displayName: `ud ${name}` })),
    );
    for (const name of PEOPLE) player[name] = ids.get(puuid[name]) ?? '';
    await relinkAll();
    Object.assign(groups, await createTestGroups(db, runId, ['u', 'v'] as const));
    await setTestMembership(db, groups.u, player.olga, 'owner');
    await setTestMembership(db, groups.u, player.ali, 'admin');
    await setTestMembership(db, groups.u, player.ada, 'admin');
    await setTestMembership(db, groups.u, player.mo, 'member');
    await setTestMembership(db, groups.v, player.vic, 'owner');
    await setTestMembership(db, groups.v, player.mo, 'member');
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', Object.values(puuid));
  });

  describe('POST /api/admin/members/unlink-discord on the local stack', () => {
    it('an admin unlinks a member: only discord_id moves, in every group they are in', async () => {
      await relinkAll();
      const before = await playerRow('mo');
      const rolesU = await roles(groups.u);
      const rolesV = await roles(groups.v);

      expect(await unlink('ali', 'mo')).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.u, playerId: player.mo, changed: true },
      });
      expect(await playerRow('mo')).toEqual({ ...before, discord_id: null });
      expect(await roles(groups.u)).toEqual(rolesU);
      expect(await roles(groups.v)).toEqual(rolesV);
      // Group V's members list reads him as unlinked too: the link was the player's.
      const inV = (await loadGroupMembers(db, groups.v)).find((row) => row.playerId === player.mo);
      expect(inV?.discordLinked).toBe(false);
      const olgaInU = (await loadGroupMembers(db, groups.u)).find((row) => row.playerId === player.olga);
      expect(olgaInU?.discordLinked).toBe(true);
    });

    it('a repeat press writes nothing and says so', async () => {
      expect(await unlink('ali', 'mo')).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.u, playerId: player.mo, changed: false },
      });
    });

    it('a member of the group is refused at the gate', async () => {
      await relinkAll();
      expect(await unlink('mo', 'ali')).toEqual({
        status: 403,
        json: { ok: false, error: NOT_A_GROUP_ADMIN },
      });
      expect((await playerRow('ali')).discord_id).toBe(discord.ali);
    });

    it("another group's owner gets a 404 for U's member, and a player in no group is a 404", async () => {
      await relinkAll();
      expect(await unlink('vic', 'olga', groups.v)).toEqual({
        status: 404,
        json: { ok: false, error: NO_SUCH_MEMBER },
      });
      expect(await unlink('olga', 'out')).toEqual({
        status: 404,
        json: { ok: false, error: NO_SUCH_MEMBER },
      });
      expect((await playerRow('olga')).discord_id).toBe(discord.olga);
      expect((await playerRow('out')).discord_id).toBe(discord.out);
    });

    it('an admin cannot unlink the owner or another admin; the owner can do both', async () => {
      await relinkAll();
      expect(await unlink('ali', 'olga')).toEqual({
        status: 403,
        json: { ok: false, error: ONLY_OWNER_UNLINKS_OWNER },
      });
      expect(await unlink('ali', 'ada')).toEqual({ status: 403, json: { ok: false, error: ONLY_OWNER } });
      expect((await playerRow('olga')).discord_id).toBe(discord.olga);
      expect((await playerRow('ada')).discord_id).toBe(discord.ada);

      expect((await unlink('olga', 'ada')).status).toBe(200);
      expect((await playerRow('ada')).discord_id).toBeNull();
    });

    it('an admin may unlink themselves, and then the gate no longer knows them', async () => {
      await relinkAll();
      expect((await unlink('ali', 'ali')).status).toBe(200);
      expect((await playerRow('ali')).discord_id).toBeNull();
      expect((await unlink('ali', 'mo')).status).toBe(403);
      expect((await roles(groups.u)).find((row) => row.player_id === player.ali)?.role).toBe('admin');
    });

    it('the owner may not unlink themselves', async () => {
      await relinkAll();
      expect(await unlink('olga', 'olga')).toEqual({
        status: 403,
        json: { ok: false, error: OWNER_UNLINKS_SELF },
      });
      expect((await playerRow('olga')).discord_id).toBe(discord.olga);
    });
  });
}
