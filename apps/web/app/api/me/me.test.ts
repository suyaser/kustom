import type { LobbyStatusValue, RoleValue } from '@customs/db';
import type { GroupRole } from '@customs/db/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { GroupRoleLookup } from '@/lib/groups/membership';
import { holdsAdminRole } from '@/lib/me/claimable';
import {
  LINK_ALREADY_LINKED,
  LINK_NOT_CLAIMABLE,
  LINK_TAKEN,
  NOT_IN_THIS_GROUP,
  ROLE_TAP_NO_LOBBY,
  ROLE_TAP_NOT_IN_LOBBY,
  ROLE_TAP_NOT_LINKED,
  ROLE_TAP_NOT_YOURS,
} from '@/lib/me/copy';
import type { MeAuthResult, MeIdentity } from '@/lib/me/identity';
import type { RoleTonightStore } from '@/lib/me/roleTonight';
import type { LinkWrite, SelfLinkStore } from '@/lib/me/selfLink';
import type { ServiceClient } from '@/lib/supabase';
import { selfLinkRoute } from './link/handler';
import { roleTonightRoute } from './role-tonight/handler';

// The roster behind Tonight's same-name labels is cached per group (performance plan, phase 2).
const { invalidateGroup } = vi.hoisted(() => ({ invalidateGroup: vi.fn() }));
vi.mock('@/lib/cache/tags', () => ({ invalidateGroup, invalidateGroups: vi.fn() }));


/**
 * The `/api/me/*` routes: the third route class (a session with a linked player, scoped to the
 * body's group since M13.4), end to end through the real zod schemas and the real rules, with the
 * session, the membership lookup and the database faked (M3.6).
 *
 * What this file is for is the sentence in the brief nobody can check by playing a night: **a
 * non-admin body that names another player is a 403, never a silent write to their own row.**
 * Everything else here is the rest of that gate.
 */

const LOBBY = '11111111-1111-4111-8111-111111111111';
const ME = 'puuid-me';
const SOMEBODY_ELSE = 'puuid-else';

function identity(overrides: Partial<MeIdentity> = {}): MeIdentity {
  return {
    userId: 'user-1',
    discordId: 'discord-1',
    player: { playerId: 'player-me', puuid: ME },
    ...overrides,
  };
}

/** The session step, faked: every route takes it as an option for exactly this reason. */
function session(result: MeAuthResult): (request: Request, client: ServiceClient) => Promise<MeAuthResult> {
  return async () => result;
}

const noClient = (): ServiceClient => ({}) as ServiceClient;

/** The group every body below names unless a test says otherwise (M13.4). */
const GROUP = '00000000-0000-4000-8000-00000000000a';

/** The membership lookup, faked: the caller's role in whatever group the body named. */
function roleIs(role: GroupRole | null): (client: ServiceClient) => GroupRoleLookup {
  return () => async () => role;
}

/** Every `/api/me/*` body names its group; a test that wants none passes `groupId: undefined`. */
function withGroup<T extends object>(body: T): T {
  return 'groupId' in body ? body : { groupId: GROUP, ...body };
}

function post(body: object, path = 'role-tonight'): Request {
  return new Request(`http://localhost/api/me/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(withGroup(body)),
  });
}

function form(body: Record<string, string>, path = 'role-tonight'): Request {
  return new Request(`http://localhost/api/me/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(withGroup(body)).toString(),
  });
}

interface FakeRoleStore extends RoleTonightStore {
  writes: { lobbyId: string; playerId: string; role: RoleValue | null }[];
  /** The night's preference on `players`, which is what makes a tap outlive its lobby row. */
  preferences: { playerId: string; role: RoleValue | null; until: string | null }[];
}

function roleStore(
  options: { status?: LobbyStatusValue | null; members?: string[]; players?: Record<string, string> } = {},
): FakeRoleStore {
  const players = options.players ?? { [ME]: 'player-me', [SOMEBODY_ELSE]: 'player-else' };
  const members = new Set(options.members ?? Object.values(players));
  const writes: FakeRoleStore['writes'] = [];
  const preferences: FakeRoleStore['preferences'] = [];

  return {
    writes,
    preferences,
    findPlayerIdByPuuid: async (puuid) => players[puuid] ?? null,
    // The lobby is GROUP's: asked about under any other group, it is not there (M13.4).
    findLobbyStatus: async (_lobbyId, groupId) =>
      groupId !== GROUP ? null : options.status === undefined ? 'open' : options.status,
    isMember: async (_lobbyId, playerId) => members.has(playerId),
    writePreference: async (playerId, role, until) => {
      preferences.push({ playerId, role, until: until?.toISOString() ?? null });
    },
    writeOverride: async (lobbyId, playerId, role) => {
      writes.push({ lobbyId, playerId, role });
    },
  };
}

function roleRoute(me: MeAuthResult, store: RoleTonightStore, role: GroupRole | null = 'member') {
  return roleTonightRoute({
    authorize: session(me),
    getClient: noClient,
    store: () => store,
    groupRole: roleIs(role),
  });
}

describe('POST /api/me/role-tonight', () => {
  it("stores the tap on the caller's own row while the lobby is open", async () => {
    const store = roleStore();
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ lobbyId: LOBBY, role: 'jungle' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      puuid: ME,
      lobbyId: LOBBY,
      role: 'jungle',
      status: 'open',
      savedForNextGame: false,
    });
    expect(store.writes).toEqual([{ lobbyId: LOBBY, playerId: 'player-me', role: 'jungle' }]);
    // And the night's preference, which is what survives a `lobby_members` row being deleted
    // and re-created (decision 2026-09-10). The expiry is the night's own 06:00.
    expect(store.preferences).toHaveLength(1);
    expect(store.preferences[0]).toMatchObject({ playerId: 'player-me', role: 'jungle' });
    const until = store.preferences[0]?.until;
    expect(until).not.toBeNull();
    expect(Date.parse(String(until))).toBeGreaterThan(Date.now());
  });

  it('clears the override when the role is null, and reads "" from a form as null', async () => {
    const store = roleStore();
    const json = await roleRoute({ ok: true, me: identity() }, store)(post({ lobbyId: LOBBY, role: null }));
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({ role: null });

    const posted = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(form({ lobbyId: LOBBY, role: '', redirectTo: '/' }));
    // The no-JavaScript path: a 303 back to the page it was pressed on, never to /admin.
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toContain('/?notice=role+cleared');
    expect(store.writes).toEqual([
      { lobbyId: LOBBY, playerId: 'player-me', role: null },
      { lobbyId: LOBBY, playerId: 'player-me', role: null },
    ]);
    // Clearing writes null to **both** columns, so nothing can come back on the next post.
    expect(store.preferences).toEqual([
      { playerId: 'player-me', role: null, until: null },
      { playerId: 'player-me', role: null, until: null },
    ]);
  });

  it('answers savedForNextGame once the teams are posted, and moves nothing', async () => {
    const store = roleStore({ status: 'balanced' });
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ lobbyId: LOBBY, role: 'top' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'balanced', savedForNextGame: true });
    expect(store.writes).toHaveLength(1);
  });

  it('refuses a non-admin body that names another player, and writes nothing', async () => {
    const store = roleStore();
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ lobbyId: LOBBY, role: 'mid', puuid: SOMEBODY_ELSE }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: ROLE_TAP_NOT_YOURS });
    // Not a silent write to the caller's own row: nothing moved at all.
    expect(store.writes).toEqual([]);
    expect(store.preferences).toEqual([]);
  });

  it("lets an admin set somebody else's row", async () => {
    const store = roleStore();
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
      'admin',
    )(post({ lobbyId: LOBBY, role: 'support', puuid: SOMEBODY_ELSE }));

    expect(response.status).toBe(200);
    expect(store.writes).toEqual([{ lobbyId: LOBBY, playerId: 'player-else', role: 'support' }]);
    // The admin sets the other player's night, not their own.
    expect(store.preferences[0]).toMatchObject({ playerId: 'player-else', role: 'support' });
  });

  it("refuses a linked player who is not a member of the body's group, and writes nothing (M13.4)", async () => {
    const store = roleStore();
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
      null,
    )(post({ lobbyId: LOBBY, role: 'mid' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: NOT_IN_THIS_GROUP });
    expect(store.writes).toEqual([]);
    expect(store.preferences).toEqual([]);
  });

  it('treats a lobby of another group as no lobby at all (M13.4)', async () => {
    const store = roleStore();
    const other = '00000000-0000-4000-8000-00000000000b';
    const response = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ groupId: other, lobbyId: LOBBY, role: 'mid' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: ROLE_TAP_NO_LOBBY });
    expect(store.writes).toEqual([]);
  });

  it('is 400 for a body that names no group (M13.4)', async () => {
    const response = await roleRoute(
      { ok: true, me: identity() },
      roleStore(),
    )(post({ groupId: undefined, lobbyId: LOBBY, role: 'mid' }));
    expect(response.status).toBe(400);
  });

  it('refuses a lobby that is over, and one the player is not in', async () => {
    const finished = roleStore({ status: 'finished' });
    const done = await roleRoute(
      { ok: true, me: identity() },
      finished,
    )(post({ lobbyId: LOBBY, role: 'adc' }));
    expect(done.status).toBe(409);
    expect(await done.json()).toEqual({ ok: false, error: ROLE_TAP_NO_LOBBY });

    const elsewhere = roleStore({ members: [] });
    const outside = await roleRoute(
      { ok: true, me: identity() },
      elsewhere,
    )(post({ lobbyId: LOBBY, role: 'adc' }));
    expect(outside.status).toBe(409);
    expect(await outside.json()).toEqual({ ok: false, error: ROLE_TAP_NOT_IN_LOBBY });
    expect(finished.writes.concat(elsewhere.writes)).toEqual([]);
    expect(finished.preferences.concat(elsewhere.preferences)).toEqual([]);
  });

  it('is 401 without a session and 403 for a session with no player', async () => {
    const store = roleStore();
    const out = await roleRoute(
      { ok: false, status: 401, error: 'sign in required' },
      store,
    )(post({ lobbyId: LOBBY, role: 'top' }));
    expect(out.status).toBe(401);

    const unlinked = await roleRoute(
      { ok: true, me: identity({ player: null }) },
      store,
    )(post({ lobbyId: LOBBY, role: 'top' }));
    expect(unlinked.status).toBe(403);
    expect(await unlinked.json()).toEqual({ ok: false, error: ROLE_TAP_NOT_LINKED });
  });

  it('refuses a body that is not a lobby id or not a role', async () => {
    const store = roleStore();
    const badLobby = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ lobbyId: 'not-a-uuid', role: 'top' }));
    expect(badLobby.status).toBe(400);

    const badRole = await roleRoute(
      { ok: true, me: identity() },
      store,
    )(post({ lobbyId: LOBBY, role: 'carry' }));
    expect(badRole.status).toBe(400);
    expect(store.writes).toEqual([]);
  });
});

interface FakeLinkStore extends SelfLinkStore {
  links: { playerId: string; discordId: string }[];
}

function linkStore(
  options: {
    members?: string[];
    discordId?: string | null;
    write?: LinkWrite;
    /** The claimed player's memberships across every group (M14.26). */
    roles?: string[];
  } = {},
): FakeLinkStore {
  const links: FakeLinkStore['links'] = [];
  return {
    links,
    claimSetPuuids: async () => new Set(options.members ?? [ME, SOMEBODY_ELSE]),
    findPlayerByPuuid: async (puuid) => ({
      playerId: `player-${puuid}`,
      discordId: options.discordId ?? null,
      holdsAdminRole: holdsAdminRole((options.roles ?? []).map((role) => ({ role }))),
    }),
    linkIfUnlinked: async (playerId, discordId) => {
      if (options.write !== undefined && options.write !== 'linked') return options.write;
      links.push({ playerId, discordId });
      return 'linked';
    },
  };
}

function linkRoute(me: MeAuthResult, store: SelfLinkStore) {
  // No membership is asked of a visitor picking themselves: they have no player row to be a
  // member with. The lookup answers null and the route must not care.
  return selfLinkRoute({
    authorize: session(me),
    getClient: noClient,
    store: () => store,
    groupRole: roleIs(null),
  });
}

describe('POST /api/me/link', () => {
  const visitor = identity({ player: null });

  it("links the session to a player in tonight's lobby", async () => {
    const store = linkStore();
    const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, puuid: ME });
    expect(store.links).toEqual([{ playerId: `player-${ME}`, discordId: 'discord-1' }]);
    // A linked player is a roster change: the group's cached label inputs are dropped.
    expect(invalidateGroup).toHaveBeenCalledWith(GROUP, ['roster']);
  });

  it('refuses somebody outside the claim set (tonight plus the last 12 hours)', async () => {
    invalidateGroup.mockClear();
    const store = linkStore({ members: [SOMEBODY_ELSE] });
    const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: LINK_NOT_CLAIMABLE });
    expect(store.links).toEqual([]);
    expect(invalidateGroup).not.toHaveBeenCalled();
  });

  it('re-checks the claim set on the server and ignores anything the page sends with it (M14.34)', async () => {
    // A page that drew ME (stale, or forged) cannot widen the set: the body has no field for it,
    // the extra keys are stripped, and the store's answer is the only one read.
    let asked = 0;
    const store = linkStore({ members: [SOMEBODY_ELSE] });
    const counted: SelfLinkStore = {
      ...store,
      claimSetPuuids: async () => {
        asked += 1;
        return store.claimSetPuuids();
      },
    };
    const response = await linkRoute(
      { ok: true, me: visitor },
      counted,
    )(post({ puuid: ME, claimable: [ME], gameId: 'g-1' }, 'link'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: LINK_NOT_CLAIMABLE });
    expect(asked).toBe(1);
    expect(store.links).toEqual([]);
  });

  it('refuses a player somebody is already linked to, and the race that gets past the read', async () => {
    const taken = linkStore({ discordId: 'discord-other' });
    const first = await linkRoute({ ok: true, me: visitor }, taken)(post({ puuid: ME }, 'link'));
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ ok: false, error: LINK_TAKEN });

    const raced = linkStore({ write: 'player taken' });
    const second = await linkRoute({ ok: true, me: visitor }, raced)(post({ puuid: ME }, 'link'));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ ok: false, error: LINK_TAKEN });
    expect(taken.links.concat(raced.links)).toEqual([]);
  });

  it('answers the session-taken sentence when the unique index catches the second tab', async () => {
    // `players_discord_id_key`: this Discord account is already on another player row. A 409
    // with a sentence, never the 500 a raw Postgres error would have produced.
    const store = linkStore({ write: 'session taken' });
    const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: LINK_ALREADY_LINKED });
    expect(store.links).toEqual([]);
  });

  it('never lets a linked session claim a second player', async () => {
    const store = linkStore();
    const response = await linkRoute(
      { ok: true, me: identity() },
      store,
    )(post({ puuid: SOMEBODY_ELSE }, 'link'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: LINK_ALREADY_LINKED });
    expect(store.links).toEqual([]);
  });

  describe('never an unlinked owner or admin (M14.26)', () => {
    it.each([
      ['an owner', ['owner']],
      ['an admin', ['admin']],
      ['an owner here who is a member elsewhere', ['member', 'owner']],
      ['an admin of another group only', ['admin', 'member']],
      ['a role the schema does not know (fail closed)', ['superuser']],
    ])('refuses %s with the not-claimable 403 and writes nothing', async (_label, roles) => {
      const store = linkStore({ roles });
      const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

      expect(response.status).toBe(403);
      // The same sentence as a name outside the claim set: nothing says *why*.
      expect(await response.json()).toEqual({ ok: false, error: LINK_NOT_CLAIMABLE });
      expect(store.links).toEqual([]);
    });

    it('still links a member, and a player with no membership at all', async () => {
      for (const roles of [['member'], []]) {
        const store = linkStore({ roles });
        const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));
        expect(response.status).toBe(200);
        expect(store.links).toEqual([{ playerId: `player-${ME}`, discordId: 'discord-1' }]);
      }
    });

    it('answers an already-linked owner with the taken 409, as for anybody linked', async () => {
      const store = linkStore({ roles: ['owner'], discordId: 'discord-owner' });
      const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, error: LINK_TAKEN });
      expect(store.links).toEqual([]);
    });
  });

  it('is 401 without a session', async () => {
    const store = linkStore();
    const response = await linkRoute(
      { ok: false, status: 401, error: 'sign in required' },
      store,
    )(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(401);
    expect(store.links).toEqual([]);
  });

  it('sends a form post back to the page it was pressed on', async () => {
    const store = linkStore();
    const response = await linkRoute(
      { ok: true, me: visitor },
      store,
    )(form({ puuid: ME, redirectTo: '/' }, 'link'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/?notice=');
  });

  it('refuses an off-site redirectTo by falling back to the page', async () => {
    const store = linkStore();
    const response = await linkRoute(
      { ok: true, me: visitor },
      store,
    )(form({ puuid: ME, redirectTo: 'https://evil.example' }, 'link'));

    expect(response.headers.get('location')).toMatch(/^http:\/\/localhost\/\?notice=/);
  });
});
