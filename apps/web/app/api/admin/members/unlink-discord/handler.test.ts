import { type GroupRole, isAtLeast } from '@customs/db/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SUCH_MEMBER, ONLY_OWNER } from '@/lib/admin/members';
import {
  ONLY_OWNER_UNLINKS_OWNER,
  OWNER_UNLINKS_SELF,
  type UnlinkDiscordStore,
  unlinkVerdict,
} from '@/lib/admin/unlinkDiscord';
import { type AdminAuthResult, NOT_A_GROUP_ADMIN } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { memberUnlinkDiscordRoute } from './handler';

/**
 * `POST /api/admin/members/unlink-discord` (M14.60) with the session step and the tables injected:
 * an in-memory store of memberships and player rows, so a test can see that only `discord_id` moved.
 * The real tables are `unlinkDiscord.integration.test.ts`'s.
 */

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';
const P = {
  owner: '10000000-0000-4000-8000-000000000001',
  ali: '10000000-0000-4000-8000-000000000002',
  ada: '10000000-0000-4000-8000-000000000003',
  mo: '10000000-0000-4000-8000-000000000004',
  bea: '10000000-0000-4000-8000-000000000005',
} as const;
type Person = keyof typeof P;

interface PlayerRow {
  id: string;
  puuid: string;
  discord_id: string | null;
  display_name: string;
}

let memberships: Map<string, Map<string, GroupRole>>;
let players: Map<string, PlayerRow>;

beforeEach(() => {
  memberships = new Map([
    [
      GROUP_A,
      new Map<string, GroupRole>([
        [P.owner, 'owner'],
        [P.ali, 'admin'],
        [P.ada, 'admin'],
        [P.mo, 'member'],
      ]),
    ],
    [GROUP_B, new Map<string, GroupRole>([[P.bea, 'owner']])],
  ]);
  players = new Map(
    (Object.keys(P) as Person[]).map((name, index) => [
      P[name],
      { id: P[name], puuid: `puuid-${name}`, discord_id: `90${index}`, display_name: name },
    ]),
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const store: UnlinkDiscordStore = {
  async memberships(groupId, playerIds) {
    const group = memberships.get(groupId) ?? new Map<string, GroupRole>();
    const roles = new Map([...group].filter(([id]) => playerIds.includes(id)));
    return { roles, hasOwner: [...group.values()].includes('owner') };
  },
  async clearDiscordId(playerId) {
    const row = players.get(playerId);
    if (row === undefined || row.discord_id === null) return false;
    players.set(playerId, { ...row, discord_id: null });
    return true;
  },
};

function signedInAs(person: Person, groupId: string | null): AdminAuthResult {
  if (groupId === null) return { ok: false, status: 400, error: 'groupId is required' };
  const role = memberships.get(groupId)?.get(P[person]);
  if (!isAtLeast(role ?? null, 'admin')) return { ok: false, status: 403, error: NOT_A_GROUP_ADMIN };
  return {
    ok: true,
    admin: {
      userId: `user-${person}`,
      discordId: players.get(P[person])?.discord_id ?? '',
      playerId: P[person],
      groupId,
      puuid: `puuid-${person}`,
      displayName: person,
      email: null,
      discordName: null,
    },
  };
}

function route(auth: (groupId: string | null) => AdminAuthResult) {
  return memberUnlinkDiscordRoute({
    getClient: () => ({}) as unknown as ServiceClient,
    authorize: async (_request, _client, groupId) => auth(groupId),
    store: () => store,
  });
}

async function unlink(actor: Person | 'nobody', target: Person, groupId = GROUP_A) {
  const auth =
    actor === 'nobody'
      ? (): AdminAuthResult => ({ ok: false, status: 401, error: 'sign in required' })
      : (group: string | null) => signedInAs(actor, group);
  const response = await route(auth)(
    new Request('http://localhost/api/admin/members/unlink-discord', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, playerId: P[target] }),
    }),
  );
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const discordOf = (person: Person) => players.get(P[person])?.discord_id ?? null;

describe('POST /api/admin/members/unlink-discord', () => {
  it('401 signed out, and nothing changes', async () => {
    expect(await unlink('nobody', 'mo')).toEqual({
      status: 401,
      json: { ok: false, error: 'sign in required' },
    });
    expect(discordOf('mo')).not.toBeNull();
  });

  it('403 for a member of the group', async () => {
    const answer = await unlink('mo', 'mo');
    expect(answer).toEqual({ status: 403, json: { ok: false, error: NOT_A_GROUP_ADMIN } });
    expect(discordOf('mo')).not.toBeNull();
  });

  it("404 for a player in another group: an admin of A never touches B's people", async () => {
    const answer = await unlink('owner', 'bea');
    expect(answer).toEqual({ status: 404, json: { ok: false, error: NO_SUCH_MEMBER } });
    expect(discordOf('bea')).not.toBeNull();
  });

  it('400 for a body that is not a player id', async () => {
    const response = await route((group) => signedInAs('owner', group))(
      new Request('http://localhost/api/admin/members/unlink-discord', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: GROUP_A, playerId: 'mo' }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("success clears only the player's discord_id", async () => {
    const before = new Map([...players].map(([id, row]) => [id, { ...row }]));
    const rolesBefore = [...(memberships.get(GROUP_A) ?? [])];
    expect(await unlink('ali', 'mo')).toEqual({
      status: 200,
      json: { ok: true, groupId: GROUP_A, playerId: P.mo, changed: true },
    });
    expect(players.get(P.mo)).toEqual({ ...before.get(P.mo), discord_id: null });
    for (const [id, row] of players) if (id !== P.mo) expect(row).toEqual(before.get(id));
    expect([...(memberships.get(GROUP_A) ?? [])]).toEqual(rolesBefore);
  });

  it('a repeat press is a 200 that writes nothing', async () => {
    await unlink('ali', 'mo');
    expect(await unlink('ali', 'mo')).toEqual({
      status: 200,
      json: { ok: true, groupId: GROUP_A, playerId: P.mo, changed: false },
    });
  });

  describe('owner rules, mirroring remove and demote', () => {
    it("an admin cannot unlink the owner's Discord, with a sentence that says why", async () => {
      const answer = await unlink('ali', 'owner');
      expect(answer).toEqual({ status: 403, json: { ok: false, error: ONLY_OWNER_UNLINKS_OWNER } });
      expect(ONLY_OWNER_UNLINKS_OWNER).toBe("Only the owner can unlink the owner's Discord.");
      expect(discordOf('owner')).not.toBeNull();
    });

    it('an admin cannot unlink another admin', async () => {
      const answer = await unlink('ali', 'ada');
      expect(answer).toEqual({ status: 403, json: { ok: false, error: ONLY_OWNER } });
      expect(discordOf('ada')).not.toBeNull();
    });

    it('an admin may unlink themselves', async () => {
      expect((await unlink('ali', 'ali')).status).toBe(200);
      expect(discordOf('ali')).toBeNull();
    });

    it('the owner unlinks an admin and a member', async () => {
      for (const target of ['ada', 'mo'] as const) {
        expect([target, (await unlink('owner', target)).status]).toEqual([target, 200]);
        expect(discordOf(target)).toBeNull();
      }
    });

    it('the owner cannot unlink themselves: they hand ownership on first', async () => {
      expect(await unlink('owner', 'owner')).toEqual({
        status: 403,
        json: { ok: false, error: OWNER_UNLINKS_SELF },
      });
      expect(OWNER_UNLINKS_SELF).toBe('Hand ownership to an admin before you unlink your own Discord.');
      expect(discordOf('owner')).not.toBeNull();
    });
  });

  it('a form post goes back to the members page with the notice', async () => {
    const response = await route((group) => signedInAs('owner', group))(
      new Request('http://localhost/api/admin/members/unlink-discord', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          groupId: GROUP_A,
          playerId: P.mo,
          redirectTo: '/g/friday/admin/members',
        }).toString(),
      }),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/g/friday/admin/members');
    expect(location.searchParams.get('notice')).toBe('Discord unlinked.');
    expect(discordOf('mo')).toBeNull();
  });
});

describe('unlinkVerdict', () => {
  it('in a group with no owner yet, admins unlink admins (M13.4)', () => {
    expect(
      unlinkVerdict({ actorRole: 'admin', targetRole: 'admin', self: false, groupHasOwner: false }),
    ).toBe('ok');
    expect(unlinkVerdict({ actorRole: 'admin', targetRole: 'admin', self: false, groupHasOwner: true })).toBe(
      'owner_only',
    );
  });

  it('not a member beats every other answer', () => {
    expect(unlinkVerdict({ actorRole: 'member', targetRole: null, self: false, groupHasOwner: true })).toBe(
      'not_member',
    );
  });
});
