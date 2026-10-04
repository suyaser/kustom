import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LAST_ADMIN,
  NO_SUCH_MEMBER,
  ONLY_OWNER,
  OWNER_CANNOT_BE_DEMOTED,
  OWNER_CANNOT_BE_REMOVED,
  OWNER_NEEDS_ADMIN,
} from '@/lib/admin/members';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import type { AdminRouteOptions } from '@/lib/adminRoute';
import { mintCompanionToken } from '@/lib/companionAuth';
import { joinGroup } from '@/lib/groups/invites';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { eogBody, lobbyBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The owner role and member removal (M14.11) against the local stack, session injected and every
 * membership read and written for real through the three `0023` definer functions.
 *
 * One row of `redesign/STRATEGY.md` §3.5 per `describe`, allowed and refused (acceptance 2); the
 * one-owner index (acceptance 3); removal keeping games and rating, revoking the group's tokens and
 * being undone by playing (acceptance 4); and the races the row lock exists for.
 *
 * Group O has an owner: Olga. Ali and Ada are admins; Mo, Mia, Max and four fillers are members.
 * Group N has no owner (M13.4's rules): Nadia and Nour are its admins. Group P is a second group
 * Mo is in, with a token of his, to prove removal only touches the group it names.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

if (stack === null || authUsers === null) {
  describe.skip('owner and member removal against the local Supabase stack', () => {
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

  const { memberRoleRoute } = await import('./members/role/handler');
  const { memberRemoveRoute } = await import('./members/remove/handler');
  const { ownerTransferRoute } = await import('./owner/transfer/handler');
  const { fearlessResetRoute } = await import('./fearless/reset/handler');
  const { POST: postLobby } = await import('../companion/lobby/route');
  const { POST: postGame } = await import('../companion/game/route');
  const { GET: getMe } = await import('../companion/me/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const PEOPLE = [
    'olga',
    'ali',
    'ada',
    'mo',
    'mia',
    'max',
    'f0',
    'f1',
    'f2',
    'f3',
    'x1',
    'x2',
    'nadia',
    'nour',
    'cara',
    'cid',
  ] as const;
  type Person = (typeof PEOPLE)[number];
  const puuid = Object.fromEntries(PEOPLE.map((name) => [name, `it-${runId}-ow-${name}`])) as Record<
    Person,
    string
  >;
  const discord = Object.fromEntries(
    PEOPLE.map((name, index) => [name, `8${digits}${String(index).padStart(3, '0')}`]),
  ) as Record<Person, string>;
  const player = {} as Record<Person, string>;
  const groups = { o: '', n: '', p: '', j: '' };
  const gameIds: number[] = [];
  let nextGame = testGameId();
  let creatorUserId = '';
  const tokens = { olga: '', moInO: '', moInP: '' };

  /** The ten who play group O's game: the owner, both admins, three members and four fillers. */
  const ROSTER: Person[] = ['olga', 'ali', 'ada', 'mo', 'mia', 'max', 'f0', 'f1', 'f2', 'f3'];

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  function as(person: Person): AdminRouteOptions {
    const user = sessionUser(discord[person]);
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

  interface Answer {
    status: number;
    json: Record<string, unknown>;
  }

  async function call(route: (request: Request) => Promise<Response>, body: unknown): Promise<Answer> {
    const response = await route(
      new Request('http://localhost/api/admin/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  const setRole = (actor: Person, target: Person, role: string, groupId = groups.o) =>
    call(memberRoleRoute(as(actor)), { groupId, playerId: player[target], role });
  const remove = (actor: Person, target: Person, groupId = groups.o) =>
    call(memberRemoveRoute(as(actor)), { groupId, playerId: player[target] });
  const transfer = (actor: Person, target: Person, groupId = groups.o) =>
    call(ownerTransferRoute(as(actor)), { groupId, playerId: player[target] });

  async function roleIn(groupId: string, person: Person): Promise<string | null> {
    const { data, error } = await db
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', player[person])
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.role ?? null;
  }

  async function owners(groupId: string): Promise<string[]> {
    const { data, error } = await db
      .from('group_memberships')
      .select('player_id')
      .eq('group_id', groupId)
      .eq('role', 'owner');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.player_id);
  }

  async function mintToken(person: Person, groupId: string): Promise<string> {
    const { token, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ player_id: player[person], token_hash: tokenHash, label: `ow-${runId}`, group_id: groupId });
    if (error) throw new Error(`mintToken: ${error.message}`);
    return token;
  }

  function companion(path: string, token: string, body?: unknown, method = 'POST'): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** Back to the starting cast of group O, whatever a test left behind. */
  async function resetO(): Promise<void> {
    await db
      .from('group_memberships')
      .update({ role: 'member' })
      .eq('group_id', groups.o)
      .eq('role', 'owner');
    await setTestMembership(db, groups.o, player.olga, 'owner');
    for (const person of ['ali', 'ada'] as const)
      await setTestMembership(db, groups.o, player[person], 'admin');
    for (const person of ['mo', 'mia', 'max', 'f0', 'f1', 'f2', 'f3', 'x1', 'x2'] as const) {
      await setTestMembership(db, groups.o, player[person], 'member');
    }
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      PEOPLE.map((name) => ({ puuid: puuid[name] })),
    );
    for (const name of PEOPLE) {
      player[name] = ids.get(puuid[name]) ?? '';
      const { error } = await db.from('players').update({ discord_id: discord[name] }).eq('id', player[name]);
      if (error) throw new Error(error.message);
    }
    Object.assign(groups, await createTestGroups(db, runId, ['o', 'n', 'p', 'j'] as const));
    await resetO();
    await setTestMembership(db, groups.n, player.nadia, 'admin');
    await setTestMembership(db, groups.n, player.nour, 'admin');
    await setTestMembership(db, groups.n, player.mia, 'member');

    tokens.olga = await mintToken('olga', groups.o);
    tokens.moInO = await mintToken('mo', groups.o);
    // The token's trigger makes Mo a member of P.
    tokens.moInP = await mintToken('mo', groups.p);

    // Group J for the creator rule: Cara created it (a real auth user), Cid is an admin.
    creatorUserId = authUsers.create([`cara-${runId}@example.invalid`])[0] ?? '';
    await db.from('groups').update({ created_by: creatorUserId }).eq('id', groups.j);
    const invite = await db
      .from('group_invites')
      .insert({ group_id: groups.j, code: `ow${runId}`.padEnd(22, 'x') });
    if (invite.error) throw new Error(invite.error.message);
    await setTestMembership(db, groups.j, player.cid, 'admin');
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await db.from('group_invites').delete().eq('group_id', groups.j);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', Object.values(puuid));
    if (creatorUserId !== '') authUsers.remove([creatorUserId]);
  });

  // -------------------------------------------------------------------------
  // STRATEGY §3.5, row by row
  // -------------------------------------------------------------------------

  describe('Roll teams, Reroll, Reset fearless, Invite, Discord, host tokens: admin and owner', () => {
    it('lets the owner and an admin through the admin gate, and refuses a member', async () => {
      for (const person of ['olga', 'ali'] as const) {
        const answer = await call(fearlessResetRoute(as(person)), { groupId: groups.o });
        expect([person, answer.status]).toEqual([person, 200]);
      }
      const member = await call(fearlessResetRoute(as('mo')), { groupId: groups.o });
      expect([member.status, member.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);
    });
  });

  describe('Make a member an admin: admin and owner', () => {
    it('an admin promotes a member, the owner promotes a member, a member promotes nobody', async () => {
      expect((await setRole('ali', 'mia', 'admin')).status).toBe(200);
      expect(await roleIn(groups.o, 'mia')).toBe('admin');
      expect((await setRole('olga', 'max', 'admin')).status).toBe(200);
      expect(await roleIn(groups.o, 'max')).toBe('admin');
      const refused = await setRole('mo', 'f0', 'admin');
      expect([refused.status, refused.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);
      expect(await roleIn(groups.o, 'f0')).toBe('member');
      await resetO();
    });

    it('cannot make anybody the owner: ownership moves only by transfer', async () => {
      const answer = await setRole('olga', 'ali', 'owner');
      expect(answer.status).toBe(400);
      expect(await roleIn(groups.o, 'ali')).toBe('admin');
    });
  });

  describe('Remove a member: admin (members only) and owner', () => {
    it('an admin removes a member, the owner removes a member, a member removes nobody', async () => {
      expect(await remove('ali', 'x1')).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.o, playerId: player.x1 },
      });
      expect(await roleIn(groups.o, 'x1')).toBeNull();
      expect((await remove('olga', 'x2')).status).toBe(200);
      expect(await roleIn(groups.o, 'x2')).toBeNull();
      const refused = await remove('mo', 'f0');
      expect([refused.status, refused.json.error]).toEqual([403, NOT_A_GROUP_ADMIN]);
      expect(await roleIn(groups.o, 'f0')).toBe('member');
    });

    it('a repeat press is the 404 of a non-member, and writes nothing', async () => {
      const again = await remove('ali', 'x1');
      expect([again.status, again.json.error]).toEqual([404, NO_SUCH_MEMBER]);
      await resetO();
    });

    it('an admin cannot remove an admin', async () => {
      const refused = await remove('ali', 'ada');
      expect(refused).toEqual({ status: 403, json: { ok: false, error: ONLY_OWNER } });
      expect(ONLY_OWNER).toBe('Only the owner can do that.');
      expect(await roleIn(groups.o, 'ada')).toBe('admin');
    });
  });

  describe('Remove an admin, make an admin a member: owner only', () => {
    it('an admin can neither demote nor remove another admin; the owner can do both', async () => {
      const demote = await setRole('ali', 'ada', 'member');
      expect([demote.status, demote.json.error]).toEqual([403, ONLY_OWNER]);
      expect(await roleIn(groups.o, 'ada')).toBe('admin');

      expect((await setRole('olga', 'ada', 'member')).status).toBe(200);
      expect(await roleIn(groups.o, 'ada')).toBe('member');
      expect((await setRole('olga', 'ada', 'admin')).status).toBe(200);
      expect((await remove('olga', 'ada')).status).toBe(200);
      expect(await roleIn(groups.o, 'ada')).toBeNull();
      await resetO();
    });

    it('an admin may step down themselves: it uses no power over anybody else', async () => {
      expect((await setRole('ali', 'ali', 'member')).status).toBe(200);
      expect(await roleIn(groups.o, 'ali')).toBe('member');
      await resetO();
    });

    it('removing the last admin who is not the owner is allowed: the owner remains', async () => {
      expect((await remove('olga', 'ali')).status).toBe(200);
      expect((await remove('olga', 'ada')).status).toBe(200);
      expect(await owners(groups.o)).toEqual([player.olga]);
      await resetO();
    });
  });

  describe('Nobody demotes or removes the owner', () => {
    it('refuses an admin and the owner alike, with the sentences, and writes nothing', async () => {
      for (const actor of ['ali', 'olga'] as const) {
        expect(await setRole(actor, 'olga', 'member')).toEqual({
          status: 409,
          json: { ok: false, error: OWNER_CANNOT_BE_DEMOTED },
        });
        expect(await setRole(actor, 'olga', 'admin')).toEqual({
          status: 409,
          json: { ok: false, error: OWNER_CANNOT_BE_DEMOTED },
        });
        expect(await remove(actor, 'olga')).toEqual({
          status: 409,
          json: { ok: false, error: OWNER_CANNOT_BE_REMOVED },
        });
      }
      expect(OWNER_CANNOT_BE_REMOVED).toBe("The owner can't be removed. Hand ownership to an admin first.");
      expect(await owners(groups.o)).toEqual([player.olga]);
    });
  });

  describe('Hand ownership to an admin: owner only', () => {
    it('refuses an admin, refuses a member as the new owner, and answers the owner naming themselves', async () => {
      const byAdmin = await transfer('ali', 'ada');
      expect([byAdmin.status, byAdmin.json.error]).toEqual([403, ONLY_OWNER]);
      const toMember = await transfer('olga', 'mo');
      expect([toMember.status, toMember.json.error]).toEqual([409, OWNER_NEEDS_ADMIN]);
      const toSelf = await transfer('olga', 'olga');
      expect(toSelf).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.o, ownerId: player.olga, role: 'owner', changed: false },
      });
      const toStranger = await transfer('olga', 'nadia');
      expect([toStranger.status, toStranger.json.error]).toEqual([404, NO_SUCH_MEMBER]);
      expect(await owners(groups.o)).toEqual([player.olga]);
    });

    it('hands the group to an admin; the old owner stays an admin and is an admin from then on', async () => {
      expect(await transfer('olga', 'ali')).toEqual({
        status: 200,
        json: { ok: true, groupId: groups.o, ownerId: player.ali, role: 'admin', changed: true },
      });
      expect(await roleIn(groups.o, 'olga')).toBe('admin');
      expect(await owners(groups.o)).toEqual([player.ali]);

      // Olga is an admin now: owner-only writes refuse her, and the new owner can demote her.
      expect((await transfer('olga', 'ada')).json.error).toBe(ONLY_OWNER);
      expect((await remove('olga', 'ada')).json.error).toBe(ONLY_OWNER);
      expect((await setRole('ali', 'olga', 'member')).status).toBe(200);
      await resetO();
    });

    it('two handovers pressed at once leave exactly one owner', async () => {
      const [toAli, toAda] = await Promise.all([transfer('olga', 'ali'), transfer('olga', 'ada')]);
      expect([toAli.status, toAda.status].sort()).toEqual([200, 403]);
      const now = await owners(groups.o);
      expect(now).toHaveLength(1);
      expect([player.ali, player.ada]).toContain(now[0]);
      expect(await roleIn(groups.o, 'olga')).toBe('admin');
      await resetO();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 3: one owner per group, by the index
  // -------------------------------------------------------------------------

  describe('one owner per group (acceptance 3)', () => {
    it('refuses a second owner written straight to the table', async () => {
      const { error } = await db
        .from('group_memberships')
        .update({ role: 'owner' })
        .eq('group_id', groups.o)
        .eq('player_id', player.ada);
      expect(error?.code).toBe('23505');
      expect(error?.message).toContain('group_memberships_one_owner_idx');
      expect(await owners(groups.o)).toEqual([player.olga]);
    });

    it('lets two groups each have their own owner', async () => {
      await setTestMembership(db, groups.n, player.mia, 'owner');
      expect(await owners(groups.n)).toEqual([player.mia]);
      await setTestMembership(db, groups.n, player.mia, 'member');
    });
  });

  // -------------------------------------------------------------------------
  // The races the row lock exists for
  // -------------------------------------------------------------------------

  describe('two admins removing each other at once', () => {
    it('in a group with an owner, neither may', async () => {
      const [aliRemovesAda, adaRemovesAli] = await Promise.all([remove('ali', 'ada'), remove('ada', 'ali')]);
      expect([aliRemovesAda.status, adaRemovesAli.status]).toEqual([403, 403]);
      expect(await roleIn(groups.o, 'ali')).toBe('admin');
      expect(await roleIn(groups.o, 'ada')).toBe('admin');
    });

    it('in a group with no owner (M13.4 rules), one wins and the other is no longer an admin to ask', async () => {
      const [nadiaRemovesNour, nourRemovesNadia] = await Promise.all([
        remove('nadia', 'nour', groups.n),
        remove('nour', 'nadia', groups.n),
      ]);
      expect([nadiaRemovesNour.status, nourRemovesNadia.status].sort()).toEqual([200, 403]);
      const left = (await Promise.all([roleIn(groups.n, 'nadia'), roleIn(groups.n, 'nour')])).filter(
        (role) => role !== null,
      );
      expect(left).toEqual(['admin']);

      // And the one left is the last admin of an ownerless group: they cannot remove themselves.
      const survivor: Person = (await roleIn(groups.n, 'nadia')) === null ? 'nour' : 'nadia';
      expect(await remove(survivor, survivor, groups.n)).toEqual({
        status: 409,
        json: { ok: false, error: LAST_ADMIN },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 4: removal is not a ban
  // -------------------------------------------------------------------------

  describe('a removed member (acceptance 4)', () => {
    let ratingBefore = '';
    let seatsBefore = 0;

    async function ratingOf(person: Person): Promise<string> {
      const { data, error } = await db
        .from('ratings')
        .select('*')
        .eq('group_id', groups.o)
        .eq('player_id', player[person]);
      if (error) throw new Error(error.message);
      return JSON.stringify(data);
    }

    async function seatsOf(person: Person): Promise<number> {
      const { count, error } = await db
        .from('game_players')
        .select('game_id', { count: 'exact', head: true })
        .eq('group_id', groups.o)
        .eq('player_id', player[person]);
      if (error) throw new Error(error.message);
      return count ?? 0;
    }

    beforeAll(async () => {
      nextGame += 1;
      gameIds.push(nextGame);
      const response = await postGame(
        companion(
          'game',
          tokens.olga,
          eogBody({ gameId: nextGame, puuids: ROSTER.map((name) => puuid[name]) }),
        ),
      );
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      ratingBefore = await ratingOf('mo');
      seatsBefore = await seatsOf('mo');
      expect(JSON.parse(ratingBefore)).toHaveLength(1);
      expect(seatsBefore).toBe(1);
    });

    it("loses the membership and this group's tokens, keeps their games and rating, and keeps other groups", async () => {
      expect((await getMe(companion('me', tokens.moInO, undefined, 'GET'))).status).toBe(200);

      expect((await remove('ali', 'mo')).status).toBe(200);

      expect(await roleIn(groups.o, 'mo')).toBeNull();
      // Revoked, so the next post is refused as a revoked token (401), before membership is asked.
      const refused = await getMe(companion('me', tokens.moInO, undefined, 'GET'));
      expect(refused.status).toBe(401);
      const { data: revoked } = await db
        .from('companion_tokens')
        .select('revoked_at')
        .eq('group_id', groups.o)
        .eq('player_id', player.mo);
      expect((revoked ?? []).every((row) => row.revoked_at !== null)).toBe(true);

      // Group P is untouched: Mo is still in it and his token there still works.
      expect(await roleIn(groups.p, 'mo')).toBe('member');
      expect((await getMe(companion('me', tokens.moInP, undefined, 'GET'))).status).toBe(200);

      expect(await ratingOf('mo')).toBe(ratingBefore);
      expect(await seatsOf('mo')).toBe(seatsBefore);
    });

    it('is a member again, with the same rating, the next time they are in one of the group lobbies', async () => {
      const response = await postLobby(
        companion(
          'lobby',
          tokens.olga,
          lobbyBody({
            partyId: `it-party-${runId}-ow`,
            members: ROSTER.map((name) => ({ puuid: puuid[name] })),
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await roleIn(groups.o, 'mo')).toBe('member');
      expect(await ratingOf('mo')).toBe(ratingBefore);
      // The revoked token stays revoked: coming back by playing is not getting a host token back.
      expect((await getMe(companion('me', tokens.moInO, undefined, 'GET'))).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // The creator rule: owner while the group has none, never again after handing it on
  // -------------------------------------------------------------------------

  describe("the creator's join (lib/groups/invites.ts)", () => {
    const code = () => `ow${runId}`.padEnd(22, 'x');

    it('makes the creator the owner of a group that has none', async () => {
      const joined = await joinGroup(db, { code: code(), userId: creatorUserId, playerId: player.cara });
      expect(joined).toMatchObject({ ok: true, value: { role: 'owner', outcome: 'joined' } });
      expect(await owners(groups.j)).toEqual([player.cara]);
    });

    it('does not raise a creator who handed ownership on', async () => {
      await db
        .from('group_memberships')
        .update({ role: 'admin' })
        .eq('group_id', groups.j)
        .eq('player_id', player.cara);
      await setTestMembership(db, groups.j, player.cid, 'owner');
      const again = await joinGroup(db, { code: code(), userId: creatorUserId, playerId: player.cara });
      expect(again).toMatchObject({ ok: true, value: { role: 'admin', outcome: 'already_member' } });
      expect(await owners(groups.j)).toEqual([player.cid]);
    });

    it('joins anybody else as a member, whoever owns the group', async () => {
      const other = await joinGroup(db, { code: code(), userId: randomUUID(), playerId: player.f0 });
      expect(other).toMatchObject({ ok: true, value: { role: 'member', outcome: 'joined' } });
    });
  });
}
