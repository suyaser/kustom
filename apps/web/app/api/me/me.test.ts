import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import {
  LINK_ALREADY_LINKED,
  LINK_NOT_IN_LOBBY,
  LINK_TAKEN,
  ROLE_TAP_NO_LOBBY,
  ROLE_TAP_NOT_IN_LOBBY,
  ROLE_TAP_NOT_LINKED,
  ROLE_TAP_NOT_YOURS,
  START_LOBBY_NOT_LINKED,
} from '@/lib/me/copy';
import type { MeAuthResult, MeIdentity } from '@/lib/me/identity';
import type { RoleTonightStore } from '@/lib/me/roleTonight';
import type { LinkWrite, SelfLinkStore } from '@/lib/me/selfLink';
import type { ServiceClient } from '@/lib/supabase';
import { selfLinkRoute } from './link/handler';
import { startLobbyRoute } from './lobbies/start/handler';
import { roleTonightRoute } from './role-tonight/handler';

/** Assembled rather than spelled, so this file is not its own counter-example. */
const OLD_START_PATH = ['/api', 'admin', 'lobbies', 'start'].join('/');

/**
 * The two `/api/me/*` routes: the third route class (a session with a linked player and no
 * `is_admin`), end to end through the real zod schemas and the real rules, with the session
 * and the database faked (M3.6).
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
    player: { playerId: 'player-me', puuid: ME, isAdmin: false },
    ...overrides,
  };
}

/** The session step, faked: every route takes it as an option for exactly this reason. */
function session(result: MeAuthResult): (request: Request, client: ServiceClient) => Promise<MeAuthResult> {
  return async () => result;
}

const noClient = (): ServiceClient => ({}) as ServiceClient;

function post(body: unknown, path = 'role-tonight'): Request {
  return new Request(`http://localhost/api/me/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function form(body: Record<string, string>, path = 'role-tonight'): Request {
  return new Request(`http://localhost/api/me/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
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
    findLobbyStatus: async () => (options.status === undefined ? 'open' : options.status),
    isMember: async (_lobbyId, playerId) => members.has(playerId),
    writePreference: async (playerId, role, until) => {
      preferences.push({ playerId, role, until: until?.toISOString() ?? null });
    },
    writeOverride: async (lobbyId, playerId, role) => {
      writes.push({ lobbyId, playerId, role });
    },
  };
}

function roleRoute(me: MeAuthResult, store: RoleTonightStore) {
  return roleTonightRoute({ authorize: session(me), getClient: noClient, store: () => store });
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
    const admin = identity({ player: { playerId: 'player-me', puuid: ME, isAdmin: true } });
    const response = await roleRoute(
      { ok: true, me: admin },
      store,
    )(post({ lobbyId: LOBBY, role: 'support', puuid: SOMEBODY_ELSE }));

    expect(response.status).toBe(200);
    expect(store.writes).toEqual([{ lobbyId: LOBBY, playerId: 'player-else', role: 'support' }]);
    // The admin sets the other player's night, not their own.
    expect(store.preferences[0]).toMatchObject({ playerId: 'player-else', role: 'support' });
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
  options: { members?: string[]; discordId?: string | null; write?: LinkWrite } = {},
): FakeLinkStore {
  const links: FakeLinkStore['links'] = [];
  return {
    links,
    tonightMemberPuuids: async () => new Set(options.members ?? [ME, SOMEBODY_ELSE]),
    findPlayerByPuuid: async (puuid) => ({
      playerId: `player-${puuid}`,
      discordId: options.discordId ?? null,
    }),
    linkIfUnlinked: async (playerId, discordId) => {
      if (options.write !== undefined && options.write !== 'linked') return options.write;
      links.push({ playerId, discordId });
      return 'linked';
    },
  };
}

function linkRoute(me: MeAuthResult, store: SelfLinkStore) {
  return selfLinkRoute({ authorize: session(me), getClient: noClient, store: () => store });
}

describe('POST /api/me/link', () => {
  const visitor = identity({ player: null });

  it("links the session to a player in tonight's lobby", async () => {
    const store = linkStore();
    const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, puuid: ME });
    expect(store.links).toEqual([{ playerId: `player-${ME}`, discordId: 'discord-1' }]);
  });

  it("refuses somebody who is not in tonight's lobby", async () => {
    const store = linkStore({ members: [SOMEBODY_ELSE] });
    const response = await linkRoute({ ok: true, me: visitor }, store)(post({ puuid: ME }, 'link'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: LINK_NOT_IN_LOBBY });
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

/**
 * `Start a lobby`, the third route on this class (M4.13). The rules it enforces are M4.2's and
 * are exercised against the local stack in `lobbies/start.integration.test.ts`; what is here is
 * the part of the move that has to hold with **no stack at all** — the gate, its sentence, and
 * the admin path being deleted rather than aliased.
 */
describe('POST /api/me/lobbies/start', () => {
  /** No client: neither answer below gets as far as a read. */
  const startRoute = (auth: MeAuthResult) =>
    startLobbyRoute({ getClient: noClient, authorize: session(auth) });

  it('answers a session with no player row in a sentence, and never a 500', async () => {
    const response = await startRoute({ ok: true, me: identity({ player: null }) })(
      post({}, 'lobbies/start'),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: START_LOBBY_NOT_LINKED });
  });

  it('is 401 without a session', async () => {
    const response = await startRoute({ ok: false, status: 401, error: 'sign in required' })(
      post({}, 'lobbies/start'),
    );

    expect(response.status).toBe(401);
    // The **page** turns this one into `Sign in with Discord to start a lobby.`: `sign in
    // required` is gate vocabulary and not a sentence for a friend on a phone (M4.13).
    expect(await response.json()).toEqual({ ok: false, error: 'sign in required' });
  });

  /**
   * **Deleted, not aliased** (M4.13, acceptance 5). Two paths for one command is the second copy
   * that drifts, so this walks the app's own sources rather than trusting a grep somebody ran
   * once: a route file, a form action or a `fetch` still naming the old path fails here.
   */
  it('has no admin path left anywhere in the app', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    // Assembled, like {@link OLD_START_PATH}: spelled out, this line would be the one hit the
    // walk below finds.
    expect(existsSync(join(root, 'app', 'api', 'admin', 'lobbies', 'start'))).toBe(false);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // `.next` and friends are build output, which the acceptance check excludes by name.
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && readFileSync(path, 'utf8').includes(OLD_START_PATH)) {
          offenders.push(path.slice(root.length));
        }
      }
    };
    for (const dir of ['app', 'lib', 'scripts']) walk(join(root, dir));

    expect(offenders).toEqual([]);
  });
});
