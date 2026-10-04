import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '@customs/db';
import { GROUP_NAME_RULE, GROUP_SLUG_RULE } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminAuthResult,
  authorizeAdmin,
  authorizeSetupWrite,
  type SessionUserLike,
  type SetupWriteResult,
  supabaseAdminLookup,
  supabaseGroupCreator,
} from '@/lib/adminAuth';
import type { AdminRouteOptions, SetupRouteOptions } from '@/lib/adminRoute';
import {
  INVITE_DEAD,
  JOIN_NOT_LINKED,
  PAIRING_CODE_EXPIRED,
  PAIRING_CODE_UNKNOWN,
  PAIRING_NO_SUCH_CODE,
  PAIRING_NOT_CREATOR,
  PAIRING_PUUID_LINKED,
  PAIRING_RATE_LIMITED,
  pairingDiscordLinked,
  SLUG_TAKEN,
} from '@/lib/groups/copy';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { hashPairingCode } from '@/lib/groups/pairing';
import type { SessionRouteOptions } from '@/lib/groups/sessionRoute';
import { authorizeMe, supabaseMeLookup } from '@/lib/me/identity';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Creating a group, the invite link and pairing a PUUID (M13.5, acceptance 1 to 5), against the
 * local stack with only the Supabase session faked: `players.discord_id`, `groups.created_by`,
 * the memberships, the codes and the rate limit are all read and written for real.
 *
 * The sessions belong to **real** `auth.users` rows (`lib/testing/authUsers.ts`, deleted after),
 * because `groups.created_by`, `pairing_codes.auth_user_id` and `group_invites.rotated_by` are
 * foreign keys into `auth.users`.
 *
 * Every pair call carries its own `x-forwarded-for`, so no test's attempts count against another's
 * rate limit; the rate-limit test reuses one address on purpose.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

if (stack === null || authUsers === null) {
  describe.skip('groups, invites and pairing against the local Supabase stack', () => {
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

  const { createGroupRoute } = await import('./handler');
  const { myGroupsRoute } = await import('./mine/handler');
  const { joinGroupRoute } = await import('./join/handler');
  const { issuePairingRoute, pairingStatusRoute } = await import('../me/pairing/handler');
  const { companionPairRoute } = await import('../companion/pair/handler');
  const { inviteRotateRoute } = await import('../admin/invite/rotate/handler');
  const { setGroupModeRoute } = await import('../admin/mode/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';

  /**
   * The people. `linked*` have a `players` row carrying their Discord id before the run starts;
   * the others are signed in with no player yet.
   */
  const PEOPLE = ['ana', 'ben', 'cleo', 'dev', 'eli', 'fay', 'gus'] as const;
  type Person = (typeof PEOPLE)[number];
  const discord = Object.fromEntries(PEOPLE.map((p, i) => [p, `8${digits}0000${i}`])) as Record<
    Person,
    string
  >;
  const userId = {} as Record<Person, string>;
  const LINKED: readonly Person[] = ['ana', 'cleo'];
  const playerOf = {} as Partial<Record<Person, string>>;

  /** PUUIDs Kustom will "read from League". */
  const puuid = {
    ana: `it-${runId}-gp-ana`,
    cleo: `it-${runId}-gp-cleo`,
    ben: `it-${runId}-gp-ben`,
    benAlt: `it-${runId}-gp-ben-alt`,
    dev: `it-${runId}-gp-dev`,
    member: `it-${runId}-gp-member`,
    fresh: `it-${runId}-gp-fresh`,
  };

  const slug = { a: `it-${runId}-ga`, b: `it-${runId}-gb` };
  const groupIds: string[] = [];
  let ipSeq = 0;

  function sessionUser(person: Person): SessionUserLike {
    return {
      id: userId[person],
      email: `${person}-${runId}@example.invalid`,
      identities: [{ id: discord[person], provider: 'discord', identity_data: { full_name: person } }],
    };
  }

  /** The real session gate with only the Supabase user faked: the player is looked up for real. */
  function as(person: Person): SessionRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client) =>
        authorizeMe({
          resolveSessionUser: async () => sessionUser(person),
          lookupPlayerByDiscordId: supabaseMeLookup(client),
        }),
    };
  }

  function asAdmin(person: Person): AdminRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<AdminAuthResult> =>
        authorizeAdmin({
          resolveSessionUser: async () => sessionUser(person),
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId,
        }),
    };
  }

  /** The setup gate (M14.40) with only the Supabase user faked: player, role and `created_by` are real. */
  function asSetup(person: Person): SetupRouteOptions {
    return {
      getClient: () => db,
      authorize: async (_request, client, groupId): Promise<SetupWriteResult> =>
        authorizeSetupWrite({
          resolveSessionUser: async () => sessionUser(person),
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          lookupGroupCreator: supabaseGroupCreator(client),
          groupId,
        }),
    };
  }

  interface Answer {
    status: number;
    json: Record<string, unknown>;
  }

  async function send(route: (request: Request) => Promise<Response>, request: Request): Promise<Answer> {
    const response = await route(request);
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  function postJson(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  const create = (person: Person, body: unknown) => send(createGroupRoute(as(person)), postJson(body));
  const mine = (person: Person) =>
    send(myGroupsRoute(as(person)), new Request('http://localhost/api/groups/mine'));
  const join = (person: Person, code: string) => send(joinGroupRoute(as(person)), postJson({ code }));
  const issue = (person: Person, body: unknown) => send(issuePairingRoute(as(person)), postJson(body));
  const status = (person: Person, code: string) =>
    send(
      pairingStatusRoute(as(person)),
      new Request(`http://localhost/api/me/pairing/status?code=${encodeURIComponent(code)}`),
    );
  const nextAddress = (): string => {
    ipSeq += 1;
    return `it-${runId}-ip-${ipSeq}`;
  };
  const pair = (body: unknown, ip = nextAddress()) =>
    send(companionPairRoute({ getClient: () => db }), postJson(body, { 'x-forwarded-for': ip }));
  const rotate = (person: Person, groupId: string) =>
    send(inviteRotateRoute(asSetup(person)), postJson({ groupId }));
  const setMode = (person: Person, groupId: string) =>
    send(setGroupModeRoute(asAdmin(person)), postJson({ groupId, mode: 'fearless' }));

  async function groupBySlug(value: string) {
    const { data, error } = await db.from('groups').select('id, slug, name, created_by').eq('slug', value);
    if (error) throw error;
    return data ?? [];
  }

  async function inviteCode(groupId: string): Promise<string> {
    const { data, error } = await db.from('group_invites').select('code').eq('group_id', groupId).single();
    if (error) throw error;
    return data.code;
  }

  async function roleIn(groupId: string, playerId: string): Promise<string | null> {
    const { data, error } = await db
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) throw error;
    return data?.role ?? null;
  }

  async function playerByPuuid(value: string) {
    const { data, error } = await db
      .from('players')
      .select('id, discord_id')
      .eq('puuid', value)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Rows of a table that belong to one group. */
  async function countRows(table: 'fearless_state' | 'group_invites', groupId: string) {
    const { count, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('group_id', groupId);
    if (error) throw error;
    return count ?? 0;
  }

  let groupA = '';
  let groupB = '';

  beforeAll(async () => {
    const ids = authUsers.create(PEOPLE.map((person) => `${person}-${runId}@example.invalid`));
    PEOPLE.forEach((person, i) => {
      userId[person] = ids[i] as string;
    });
    for (const person of LINKED) {
      const { data, error } = await db
        .from('players')
        .insert({
          puuid: puuid[person as 'ana' | 'cleo'],
          discord_id: discord[person],
          display_name: `Cap ${person}`,
        })
        .select('id')
        .single();
      if (error) throw error;
      playerOf[person] = data.id;
    }
  });

  afterAll(async () => {
    await deleteTestGroups(db, groupIds);
    await db.from('players').delete().in('puuid', Object.values(puuid));
    authUsers.remove(PEOPLE.map((person) => userId[person]).filter((id) => id !== undefined));
  });

  describe('POST /api/groups (acceptance 1)', () => {
    it('a linked creator gets the group, its fearless cursor, its invite and an owner membership (M14.11)', async () => {
      const answer = await create('ana', { name: '  Thursday Flex  ', slug: slug.a });
      expect(answer.status).toBe(201);
      expect(answer.json).toMatchObject({
        ok: true,
        role: 'owner',
        group: { slug: slug.a, name: 'Thursday Flex' },
      });

      const [row] = await groupBySlug(slug.a);
      expect(row).toBeDefined();
      groupA = row?.id ?? '';
      groupIds.push(groupA);
      expect(row?.created_by).toBe(userId.ana);
      expect(row?.name).toBe('Thursday Flex');
      expect(await countRows('fearless_state', groupA)).toBe(1);
      expect(await countRows('group_invites', groupA)).toBe(1);
      expect(await roleIn(groupA, playerOf.ana ?? '')).toBe('owner');
    });

    it('a duplicate slug is 409 with the sentence, and nothing moves (idempotent)', async () => {
      const again = await create('ana', { name: 'Thursday Flex', slug: slug.a });
      expect(again.status).toBe(409);
      expect(again.json.error).toBe(SLUG_TAKEN);
      const other = await create('cleo', { name: 'Someone else', slug: slug.a });
      expect(other.status).toBe(409);

      expect(await groupBySlug(slug.a)).toHaveLength(1);
      expect(await countRows('fearless_state', groupA)).toBe(1);
      expect(await countRows('group_invites', groupA)).toBe(1);
    });

    it.each([
      ['uppercase', `It-${runId}-x`],
      ['too short', 'ab'],
      ['reserved', 'new'],
      ['a space', `it ${runId}`],
      ['not a string', 42],
    ])('a slug that is %s is 400 with the slug sentence, never rewritten', async (_why, bad) => {
      const answer = await create('ana', { name: 'Fine', slug: bad });
      expect(answer.status).toBe(400);
      expect(answer.json.error).toBe(GROUP_SLUG_RULE);
      expect(answer.json.issues).toEqual([{ path: 'slug', message: GROUP_SLUG_RULE }]);
      if (typeof bad === 'string') expect(await groupBySlug(bad.toLowerCase())).toHaveLength(0);
    });

    it.each([
      ['blank', '   '],
      ['41 characters', 'x'.repeat(41)],
    ])('a name that is %s is 400 with the name sentence under name', async (_why, bad) => {
      const answer = await create('ana', { name: bad, slug: `it-${runId}-unused` });
      expect(answer.status).toBe(400);
      expect(answer.json.error).toBe(GROUP_NAME_RULE);
      expect(answer.json.issues).toEqual([{ path: 'name', message: GROUP_NAME_RULE }]);
    });

    it('both wrong: both issues, one per field', async () => {
      const answer = await create('ana', { name: '', slug: 'Nope' });
      expect(answer.status).toBe(400);
      expect(answer.json.issues).toEqual([
        { path: 'name', message: GROUP_NAME_RULE },
        { path: 'slug', message: GROUP_SLUG_RULE },
      ]);
    });

    it('no session is 401', async () => {
      const answer = await send(
        createGroupRoute({
          getClient: () => db,
          authorize: async () => ({ ok: false, status: 401, error: 'sign in required' }),
        }),
        postJson({ name: 'x', slug: `it-${runId}-anon` }),
      );
      expect(answer.status).toBe(401);
    });
  });

  describe('an unlinked creator pairs and becomes admin (acceptance 2)', () => {
    let code = '';

    it('creates the group with no membership', async () => {
      const answer = await create('ben', { name: 'Ben Night', slug: slug.b });
      expect(answer.status).toBe(201);
      expect(answer.json.role).toBeNull();
      const [row] = await groupBySlug(slug.b);
      groupB = row?.id ?? '';
      groupIds.push(groupB);
      expect(row?.created_by).toBe(userId.ben);
      const { count } = await db
        .from('group_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupB);
      expect(count).toBe(0);
      expect((await mine('ben')).json.groups).toEqual([]);
    });

    it('before pairing, the creator may rotate the invite and nobody else unlinked may (M14.40)', async () => {
      const before = await inviteCode(groupB);
      const stranger = await rotate('eli', groupB);
      expect(stranger.status).toBe(403);
      expect(await inviteCode(groupB)).toBe(before);

      const rotated = await rotate('ben', groupB);
      expect(rotated.status).toBe(200);
      expect(await inviteCode(groupB)).toBe(String(rotated.json.code));
      const { data } = await db.from('group_invites').select('rotated_by').eq('group_id', groupB).single();
      expect(data?.rotated_by).toBe(userId.ben);
    });

    it('before pairing, the creator is refused on an admin-only write (mode)', async () => {
      const refused = await setMode('ben', groupB);
      expect(refused.status).toBe(403);
      expect(refused.json.error).toBe('no player is linked to this Discord account');
    });

    it('only the creator gets a code by groupId', async () => {
      const refused = await issue('cleo', { groupId: groupB });
      expect(refused.status).toBe(403);
      expect(refused.json.error).toBe(PAIRING_NOT_CREATOR);

      const answer = await issue('ben', { groupId: groupB });
      expect(answer.status).toBe(200);
      code = String(answer.json.code);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(answer.json.group).toMatchObject({ id: groupB, slug: slug.b });

      // Stored hashed, never as typed.
      const { data } = await db.from('pairing_codes').select('code_hash').eq('group_id', groupB);
      expect(data?.map((r) => r.code_hash)).toEqual([hashPairingCode(code)]);
      expect(JSON.stringify(data)).not.toContain(code);
    });

    it('a new code for the same session and group replaces the old one', async () => {
      const second = await issue('ben', { groupId: groupB });
      expect(second.status).toBe(200);
      const replaced = code;
      code = String(second.json.code);
      const { count } = await db
        .from('pairing_codes')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupB)
        .eq('auth_user_id', userId.ben);
      expect(count).toBe(1);
      if (replaced !== code) expect((await status('ben', replaced)).status).toBe(404);
    });

    it("status is waiting, and is nobody else's to read", async () => {
      const waiting = await status('ben', code);
      expect(waiting.status).toBe(200);
      expect(waiting.json.status).toBe('waiting');
      const stranger = await status('cleo', code);
      expect(stranger.status).toBe(404);
      expect(stranger.json.error).toBe(PAIRING_NO_SUCH_CODE);
    });

    it("Kustom pairs: the PUUID becomes the creator's player and owner of the group (M14.11)", async () => {
      const answer = await pair({ code, puuid: puuid.ben });
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({ ok: true, group: { id: groupB, slug: slug.b, name: 'Ben Night' } });

      const player = await playerByPuuid(puuid.ben);
      expect(player?.discord_id).toBe(discord.ben);
      expect(await roleIn(groupB, player?.id ?? '')).toBe('owner');

      const used = await status('ben', code);
      expect(used.json).toEqual({
        ok: true,
        status: 'used',
        group: { id: groupB, slug: slug.b, name: 'Ben Night' },
      });
      expect((await mine('ben')).json.groups).toEqual([
        { id: groupB, slug: slug.b, name: 'Ben Night', role: 'owner' },
      ]);

      // Linked now: the normal role rules, as the owner (M14.40).
      expect((await rotate('ben', groupB)).status).toBe(200);
      expect((await setMode('ben', groupB)).status).toBe(200);
    });

    it('the same code again is 410 and changes nothing (idempotent)', async () => {
      const again = await pair({ code, puuid: puuid.ben });
      expect(again.status).toBe(410);
      expect(again.json.error).toBe(PAIRING_CODE_EXPIRED);
      const { count } = await db
        .from('group_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupB);
      expect(count).toBe(1);
    });
  });

  describe('the invite link (acceptance 3)', () => {
    let liveCode = '';

    it('a linked visitor with the live invite joins as member; a second tap is a no-op', async () => {
      liveCode = await inviteCode(groupA);
      const answer = await join('cleo', liveCode);
      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        ok: true,
        role: 'member',
        outcome: 'joined',
        group: { id: groupA },
      });
      expect(await roleIn(groupA, playerOf.cleo ?? '')).toBe('member');

      const again = await join('cleo', liveCode);
      expect(again.json).toMatchObject({ role: 'member', outcome: 'already_member' });
      const { count } = await db
        .from('group_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupA);
      expect(count).toBe(2);
    });

    it('the owner opening their own link stays owner', async () => {
      const answer = await join('ana', liveCode);
      expect(answer.json).toMatchObject({ role: 'owner', outcome: 'already_member' });
      expect(await roleIn(groupA, playerOf.ana ?? '')).toBe('owner');
    });

    it('an unlinked visitor cannot one-tap join', async () => {
      const answer = await join('dev', liveCode);
      expect(answer.status).toBe(403);
      expect(answer.json.error).toBe(JOIN_NOT_LINKED);
    });

    it('rotating is admin-only; the rotated link is 404 for joining and for a pairing code', async () => {
      const notAdmin = await rotate('cleo', groupA);
      expect(notAdmin.status).toBe(403);
      expect(await inviteCode(groupA)).toBe(liveCode);

      // A code dev got through the old link, before the rotation.
      const viaOld = await issue('dev', { inviteCode: liveCode });
      expect(viaOld.status).toBe(200);

      const rotated = await rotate('ana', groupA);
      expect(rotated.status).toBe(200);
      const newCode = String(rotated.json.code);
      expect(newCode).not.toBe(liveCode);
      expect(newCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(await inviteCode(groupA)).toBe(newCode);

      const dead = await join('cleo', liveCode);
      expect(dead.status).toBe(404);
      expect(dead.json.error).toBe(INVITE_DEAD);
      const deadPairing = await issue('dev', { inviteCode: liveCode });
      expect(deadPairing.status).toBe(404);
      expect(deadPairing.json.error).toBe(INVITE_DEAD);

      // The code handed out by the old link stopped with it.
      const stale = await pair({ code: String(viaOld.json.code), puuid: puuid.dev });
      expect(stale.status).toBe(410);
      expect(stale.json.error).toBe(PAIRING_CODE_EXPIRED);
      expect(await playerByPuuid(puuid.dev)).toBeNull();

      liveCode = newCode;
    });

    it('an unlinked visitor pairs through the live invite and is a member', async () => {
      const issued = await issue('dev', { inviteCode: liveCode });
      expect(issued.status).toBe(200);
      const answer = await pair({ code: String(issued.json.code), puuid: puuid.dev });
      expect(answer.status).toBe(200);
      const player = await playerByPuuid(puuid.dev);
      expect(player?.discord_id).toBe(discord.dev);
      expect(await roleIn(groupA, player?.id ?? '')).toBe('member');
    });
  });

  describe('pairing refusals (acceptance 4)', () => {
    async function codeFor(person: Person): Promise<string> {
      const issued = await issue(person, { inviteCode: await inviteCode(groupA) });
      expect(issued.status).toBe(200);
      return String(issued.json.code);
    }

    it('a Discord account already linked to a different PUUID is refused with its name', async () => {
      const code = await codeFor('cleo');
      const answer = await pair({ code, puuid: puuid.fresh });
      expect(answer.status).toBe(409);
      expect(answer.json.error).toBe(pairingDiscordLinked('Cap cleo'));
      // Nothing written: no row for the second League account, the code still works.
      expect(await playerByPuuid(puuid.fresh)).toBeNull();
      expect((await status('cleo', code)).json.status).toBe('waiting');
    });

    it('a PUUID already linked to a different Discord is refused', async () => {
      const code = await codeFor('eli');
      const answer = await pair({ code, puuid: puuid.cleo });
      expect(answer.status).toBe(409);
      expect(answer.json.error).toBe(PAIRING_PUUID_LINKED);
      expect((await playerByPuuid(puuid.cleo))?.discord_id).toBe(discord.cleo);
    });

    it('a PUUID already a member gets the link; its membership is unchanged', async () => {
      // An unlinked row that is already admin of A (it played there, then was promoted).
      const { data, error } = await db.from('players').insert({ puuid: puuid.member }).select('id').single();
      if (error) throw error;
      await setTestMembership(db, groupA, data.id, 'admin');

      const code = await codeFor('eli');
      const answer = await pair({ code, puuid: puuid.member });
      expect(answer.status).toBe(200);
      expect((await playerByPuuid(puuid.member))?.discord_id).toBe(discord.eli);
      expect(await roleIn(groupA, data.id)).toBe('admin');
    });

    it('an expired code is 410 with the sentence', async () => {
      const code = await codeFor('fay');
      await db
        .from('pairing_codes')
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('code_hash', hashPairingCode(code));
      const answer = await pair({ code, puuid: puuid.fresh });
      expect(answer.status).toBe(410);
      expect(answer.json.error).toBe(PAIRING_CODE_EXPIRED);
      expect((await status('fay', code)).json.status).toBe('expired');
      expect(await playerByPuuid(puuid.fresh)).toBeNull();
    });

    it('a used code is 410 with the sentence', async () => {
      const code = await codeFor('gus');
      expect((await pair({ code, puuid: puuid.fresh })).status).toBe(200);
      const answer = await pair({ code, puuid: puuid.fresh });
      expect(answer.status).toBe(410);
      expect(answer.json.error).toBe(PAIRING_CODE_EXPIRED);
    });

    it('one code from two Kustoms at once: one success, one 410', async () => {
      // Fay is still unlinked (her earlier code expired); both requests carry the same new PUUID.
      const code = await codeFor('fay');
      const both = await Promise.all([
        pair({ code, puuid: puuid.benAlt }),
        pair({ code, puuid: puuid.benAlt }),
      ]);
      expect(both.map((a) => a.status).sort()).toEqual([200, 410]);
      expect((await playerByPuuid(puuid.benAlt))?.discord_id).toBe(discord.fay);
    });

    it('a code nobody was given is 404 with the sentence', async () => {
      const answer = await pair({ code: 'ZZZZZZ', puuid: puuid.fresh });
      // One in a billion this is somebody's live code on the shared stack.
      expect(answer.status).toBe(404);
      expect(answer.json.error).toBe(PAIRING_CODE_UNKNOWN);
    });

    it('the 11th attempt in a minute from one address is 429', async () => {
      const ip = `it-${runId}-hammer`;
      for (let i = 0; i < 10; i += 1) {
        const answer = await pair({ code: 'ZZZZZZ', puuid: puuid.fresh }, ip);
        expect(answer.status).toBe(404);
      }
      const eleventh = await pair({ code: 'ZZZZZZ', puuid: puuid.fresh }, ip);
      expect(eleventh.status).toBe(429);
      expect(eleventh.json.error).toBe(PAIRING_RATE_LIMITED);
      // A malformed body counts too, and is still refused by the limit first.
      expect((await pair({ nonsense: true }, ip)).status).toBe(429);
      // Another address is untouched.
      expect((await pair({ code: 'ZZZZZZ', puuid: puuid.fresh })).status).toBe(404);
    });
  });

  describe('no companion token (acceptance 5)', () => {
    it('none of the people or groups above holds a companion token', async () => {
      const players = (await db.from('players').select('id').in('puuid', Object.values(puuid))).data ?? [];
      const byPlayer = await db
        .from('companion_tokens')
        .select('*', { count: 'exact', head: true })
        .in(
          'player_id',
          players.map((p) => p.id),
        );
      const byGroup = await db
        .from('companion_tokens')
        .select('*', { count: 'exact', head: true })
        .in('group_id', groupIds);
      expect(players.length).toBeGreaterThan(4);
      expect(byPlayer.count).toBe(0);
      expect(byGroup.count).toBe(0);
    });

    // M14.12: host-mode pairing does mint, but only through the Hosts page's `mintTokenForPlayer`
    // (lib/admin/tokens.ts), so these modules still never write the table or hash a token themselves.
    it('no M13.5 route or rule module names the tokens table or the minting function', () => {
      const web = fileURLToPath(new URL('../../..', import.meta.url));
      const files = [
        'lib/groups/create.ts',
        'lib/groups/invites.ts',
        'lib/groups/pairing.ts',
        'lib/groups/sessionRoute.ts',
        ...['app/api/groups', 'app/api/me/pairing', 'app/api/companion/pair', 'app/api/admin/invite'].flatMap(
          (dir) => walk(joinPath(web, dir)).map((path) => path.slice(web.length)),
        ),
      ].filter((path) => !/\.test\.ts$/.test(path));
      expect(files.length).toBeGreaterThan(8);
      for (const file of files) {
        const source = readFileSync(joinPath(web, file), 'utf8');
        expect(source, file).not.toMatch(/companion_tokens|mintCompanionToken/);
      }
    });
  });

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(joinPath(dir, entry.name)) : [joinPath(dir, entry.name)],
    );
  }
}
