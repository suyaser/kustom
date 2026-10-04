import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import {
  companionMeResponseSchema,
  companionPairResponseSchema,
  companionTokenSchema,
  type GroupSummary,
} from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HOST_NOT_ADMIN,
  HOST_PAIRING_TOKEN_LABEL,
  hostCodeOtherAccount,
  PAIRING_CODE_EXPIRED,
  PAIRING_NOT_CREATOR,
  pairingDiscordLinked,
} from '@/lib/groups/copy';
import { generatePairingCode, hashPairingCode, issuePairingCode } from '@/lib/groups/pairing';
import { localAuthUsers } from '@/lib/testing/authUsers';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.12: an admin's Host-mode pairing mints their host token (acceptance 1 to 4), against the local
 * stack. The codes are inserted as `issuePairingCode` would write them (hash, group, auth user,
 * Discord id) so each case controls exactly whose code it is; the `POST /api/me/pairing { groupId }`
 * rule for owner and admins is tested on `issuePairingCode` itself at the end.
 *
 * Every pair call carries its own `x-forwarded-for`, so the rate limit never interferes.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();
const authUsers = stack === null ? null : localAuthUsers();

if (stack === null || authUsers === null) {
  describe.skip('host pairing against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { companionPairRoute } = await import('./handler');
  const { GET: getMe } = await import('../me/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';

  /** `owner`, `admin`, `member` are linked before the run; `newbie` and `creator` are not. */
  const PEOPLE = ['owner', 'admin', 'member', 'newbie', 'creator'] as const;
  type Person = (typeof PEOPLE)[number];
  const LINKED = ['owner', 'admin', 'member'] as const;
  const discord = Object.fromEntries(PEOPLE.map((p, i) => [p, `7${digits}0000${i}`])) as Record<
    Person,
    string
  >;
  const userId = {} as Record<Person, string>;
  const playerOf = {} as Record<Person, string>;
  const puuid = {
    owner: `it-${runId}-hp-owner`,
    admin: `it-${runId}-hp-admin`,
    member: `it-${runId}-hp-member`,
    newbie: `it-${runId}-hp-newbie`,
    creator: `it-${runId}-hp-creator`,
    /** A League account signed in on a PC that is nobody's here. */
    other: `it-${runId}-hp-other`,
  };

  let groups: Record<'g' | 'h' | 'own', string> = { g: '', h: '', own: '' };
  let ipSeq = 0;

  /** Writes a live code for `person` in `groupId`, the row `issuePairingCode` writes. */
  async function codeFor(person: Person, groupId: string): Promise<string> {
    const code = generatePairingCode();
    const now = Date.now();
    const { error } = await db.from('pairing_codes').insert({
      code_hash: hashPairingCode(code),
      group_id: groupId,
      auth_user_id: userId[person],
      discord_id: discord[person],
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 15 * 60_000).toISOString(),
    });
    if (error) throw error;
    return code;
  }

  interface Answer {
    status: number;
    json: Record<string, unknown>;
  }

  async function pair(body: Record<string, unknown>): Promise<Answer> {
    ipSeq += 1;
    const response = await companionPairRoute({ getClient: () => db })(
      new Request('http://localhost/api/companion/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `it-${runId}-hp-ip-${ipSeq}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function tokenRows(playerId: string | undefined) {
    if (playerId === undefined) return [];
    const { data, error } = await db
      .from('companion_tokens')
      .select('id, token_hash, label, group_id, revoked_at')
      .eq('player_id', playerId);
    if (error) throw error;
    return data ?? [];
  }

  async function allTokenCount(): Promise<number> {
    const { count, error } = await db
      .from('companion_tokens')
      .select('*', { count: 'exact', head: true })
      .in('group_id', Object.values(groups));
    if (error) throw error;
    return count ?? 0;
  }

  async function playerIdByPuuid(value: string): Promise<string | undefined> {
    const { data, error } = await db
      .from('players')
      .select('id, discord_id')
      .eq('puuid', value)
      .maybeSingle();
    if (error) throw error;
    return data?.id;
  }

  async function roleIn(groupId: string, playerId: string | undefined): Promise<string | null> {
    if (playerId === undefined) return null;
    const { data, error } = await db
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) throw error;
    return data?.role ?? null;
  }

  async function summary(groupId: string): Promise<GroupSummary> {
    const { data, error } = await db.from('groups').select('id, slug, name').eq('id', groupId).single();
    if (error) throw error;
    return data;
  }

  const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

  beforeAll(async () => {
    const ids = authUsers.create(PEOPLE.map((person) => `${person}-${runId}-hp@example.invalid`));
    PEOPLE.forEach((person, i) => {
      userId[person] = ids[i] as string;
    });
    groups = await createTestGroups(db, `${runId}-hp`, ['g', 'h', 'own'] as const);
    // `own` is the unlinked creator's: created by them, no owner yet.
    const created = await db.from('groups').update({ created_by: userId.creator }).eq('id', groups.own);
    if (created.error) throw created.error;

    for (const person of LINKED) {
      const { data, error } = await db
        .from('players')
        .insert({ puuid: puuid[person], discord_id: discord[person], display_name: `Cap ${person}` })
        .select('id')
        .single();
      if (error) throw error;
      playerOf[person] = data.id;
    }
    await setTestMembership(db, groups.g, playerOf.owner, 'owner');
    await setTestMembership(db, groups.g, playerOf.admin, 'admin');
    await setTestMembership(db, groups.g, playerOf.member, 'member');
    // The admin of g is a plain member of h: the role that counts is the code's group's.
    await setTestMembership(db, groups.h, playerOf.admin, 'member');
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('pairing_codes').delete().in('auth_user_id', Object.values(userId));
    await db.from('players').delete().in('puuid', Object.values(puuid));
    authUsers.remove(PEOPLE.map((person) => userId[person]).filter((id) => id !== undefined));
  });

  describe('acceptance 1: owner or admin, own PUUID, host mode', () => {
    it('mints one token in that group, returned once and stored only as its hash', async () => {
      const code = await codeFor('admin', groups.g);
      const before = await tokenRows(playerOf.admin);

      const answer = await pair({ code, puuid: puuid.admin, mode: 'host' });
      expect(answer.status).toBe(200);
      const parsed = companionPairResponseSchema.parse(answer.json);
      expect(parsed.group).toEqual(await summary(groups.g));
      expect(parsed.hostRefusal).toBeUndefined();
      const token = companionTokenSchema.parse(parsed.companionToken);

      const after = await tokenRows(playerOf.admin);
      expect(after).toHaveLength(before.length + 1);
      const minted = after.find((row) => !before.some((old) => old.id === row.id));
      expect(minted).toMatchObject({
        group_id: groups.g,
        label: HOST_PAIRING_TOKEN_LABEL,
        revoked_at: null,
        token_hash: sha256(token),
      });
      expect(after.some((row) => row.token_hash === token)).toBe(false);

      // The token works, and `GET /api/companion/me` names the group Kustom files it under.
      const me = await getMe(
        new Request('http://localhost/api/companion/me', { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(me.status).toBe(200);
      const identity = companionMeResponseSchema.parse(await me.json());
      expect(identity).toMatchObject({ puuid: puuid.admin, playerId: playerOf.admin });
      expect(identity.group).toEqual(await summary(groups.g));

      // The same code again is a used code: 410, and no second token.
      const again = await pair({ code, puuid: puuid.admin, mode: 'host' });
      expect(again.status).toBe(410);
      expect(again.json).toEqual({ ok: false, error: PAIRING_CODE_EXPIRED });
      expect(await tokenRows(playerOf.admin)).toHaveLength(after.length);
    });

    it('mints for the owner too', async () => {
      const answer = await pair({ code: await codeFor('owner', groups.g), puuid: puuid.owner, mode: 'host' });
      expect(answer.status).toBe(200);
      companionTokenSchema.parse(answer.json.companionToken);
      expect((await tokenRows(playerOf.owner)).filter((row) => row.group_id === groups.g)).toHaveLength(1);
    });

    it("mints for an unlinked creator, whose first pairing makes them the group's owner", async () => {
      const answer = await pair({
        code: await codeFor('creator', groups.own),
        puuid: puuid.creator,
        mode: 'host',
      });
      expect(answer.status).toBe(200);
      companionTokenSchema.parse(answer.json.companionToken);
      const id = await playerIdByPuuid(puuid.creator);
      expect(await roleIn(groups.own, id)).toBe('owner');
      expect(await tokenRows(id)).toMatchObject([{ group_id: groups.own }]);
    });
  });

  describe('acceptance 2: a member in host mode', () => {
    it('is linked and joined, with no token and the sentence', async () => {
      const tokensBefore = await allTokenCount();
      const answer = await pair({
        code: await codeFor('member', groups.g),
        puuid: puuid.member,
        mode: 'host',
      });
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({ ok: true, group: await summary(groups.g), hostRefusal: HOST_NOT_ADMIN });
      expect(await tokenRows(playerOf.member)).toEqual([]);
      expect(await allTokenCount()).toBe(tokensBefore);
    });

    it('a newcomer pairing in host mode is linked and becomes a member, no token', async () => {
      const answer = await pair({
        code: await codeFor('newbie', groups.g),
        puuid: puuid.newbie,
        mode: 'host',
      });
      expect(answer.status).toBe(200);
      expect(answer.json.hostRefusal).toBe(HOST_NOT_ADMIN);
      expect(answer.json.companionToken).toBeUndefined();
      const id = await playerIdByPuuid(puuid.newbie);
      expect(await roleIn(groups.g, id)).toBe('member');
      expect(await tokenRows(id)).toEqual([]);
    });

    it("an admin of one group is a member in another: that group's code mints nothing", async () => {
      const before = await tokenRows(playerOf.admin);
      const answer = await pair({ code: await codeFor('admin', groups.h), puuid: puuid.admin, mode: 'host' });
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({ ok: true, group: await summary(groups.h), hostRefusal: HOST_NOT_ADMIN });
      expect(await tokenRows(playerOf.admin)).toHaveLength(before.length);
    });
  });

  describe("acceptance 3: an admin's code with another League account signed in", () => {
    it('is refused with the sentence, links nothing, and the code still works', async () => {
      const code = await codeFor('admin', groups.g);
      const tokensBefore = await allTokenCount();

      const refused = await pair({ code, puuid: puuid.other, mode: 'host' });
      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ ok: false, error: hostCodeOtherAccount('Cap admin') });
      expect(await allTokenCount()).toBe(tokensBefore);
      expect(await playerIdByPuuid(puuid.other)).toBeUndefined();

      // Signed in to the right account, the same code mints.
      const answer = await pair({ code, puuid: puuid.admin, mode: 'host' });
      expect(answer.status).toBe(200);
      companionTokenSchema.parse(answer.json.companionToken);
      expect(await allTokenCount()).toBe(tokensBefore + 1);
    });

    it("a member's code on another account keeps M13.5's sentence", async () => {
      const refused = await pair({
        code: await codeFor('member', groups.g),
        puuid: puuid.other,
        mode: 'host',
      });
      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ ok: false, error: pairingDiscordLinked('Cap member') });
    });

    it('an admin pairing another account in overlay mode gets M13.5 sentence, not the host one', async () => {
      const refused = await pair({
        code: await codeFor('admin', groups.g),
        puuid: puuid.other,
        mode: 'overlay',
      });
      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ ok: false, error: pairingDiscordLinked('Cap admin') });
    });
  });

  describe('acceptance 4: overlay or no mode is M13.5 exactly', () => {
    it.each([['overlay'], [undefined]])(
      'an admin pairing with mode %s gets { ok, group } and no token',
      async (mode) => {
        const before = await tokenRows(playerOf.owner);
        const body: Record<string, unknown> = { code: await codeFor('owner', groups.g), puuid: puuid.owner };
        if (mode !== undefined) body.mode = mode;
        const answer = await pair(body);
        expect(answer.status).toBe(200);
        expect(answer.json).toEqual({ ok: true, group: await summary(groups.g) });
        expect(await tokenRows(playerOf.owner)).toHaveLength(before.length);
      },
    );

    it('a mode it does not know is a 400, before anything is written', async () => {
      const code = await codeFor('owner', groups.g);
      const answer = await pair({ code, puuid: puuid.owner, mode: 'admin' });
      expect(answer.status).toBe(400);
      const { data } = await db
        .from('pairing_codes')
        .select('used_at')
        .eq('code_hash', hashPairingCode(code))
        .single();
      expect(data?.used_at).toBeNull();
    });
  });

  describe("POST /api/me/pairing { groupId }: the admin home's card (M14.12)", () => {
    const session = (person: Person) => ({ userId: userId[person], discordId: discord[person] });

    it('gives the owner and an admin a code for their group, and refuses a member', async () => {
      for (const person of ['owner', 'admin'] as const) {
        const issued = await issuePairingCode(db, session(person), { groupId: groups.g });
        expect(issued.ok).toBe(true);
        if (issued.ok) expect(issued.value.group.id).toBe(groups.g);
      }
      const refused = await issuePairingCode(db, session('member'), { groupId: groups.g });
      expect(refused).toEqual({ ok: false, status: 403, error: PAIRING_NOT_CREATOR });
      // An admin of g is a member of h.
      const elsewhere = await issuePairingCode(db, session('admin'), { groupId: groups.h });
      expect(elsewhere).toEqual({ ok: false, status: 403, error: PAIRING_NOT_CREATOR });
    });

    it("an admin's issued code, typed into Kustom in host mode, mints", async () => {
      const issued = await issuePairingCode(db, session('admin'), { groupId: groups.g });
      if (!issued.ok) throw new Error(issued.error);
      const answer = await pair({ code: issued.value.code, puuid: puuid.admin, mode: 'host' });
      expect(answer.status).toBe(200);
      companionTokenSchema.parse(answer.json.companionToken);
    });
  });
}
