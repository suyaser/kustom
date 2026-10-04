import type { SessionPlayerRow } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { resolveLiveSession } from '../session/liveSession';
import type { ServiceClient } from '../supabase';
import { viewerStateFor } from '../viewer';
import { supabasePlayerInGroup } from './membership';
import { playerInGroupOf } from './pageSession';

/**
 * M19.12's no-trust-change fold: the session's player and their membership in the page's group in
 * one query. The three answers stay distinct -- no player (unlinked), a player with no role here
 * (linked non-member), a member with a role -- and a role string the union does not know is no role.
 */

const GROUP = '11111111-1111-4111-8111-111111111111';
const DISCORD = '123456789012345678';

interface Call {
  table: string;
  select: string;
  eq: [string, unknown][];
}

/** A client that answers the one `players` read with `answer`, and records how it was asked. */
function fakeClient(answer: unknown, error: { message: string } | null = null) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const call: Call = { table, select: '', eq: [] };
      calls.push(call);
      const self = {
        select: (columns: string) => {
          call.select = columns;
          return self;
        },
        eq: (column: string, value: unknown) => {
          call.eq.push([column, value]);
          return self;
        },
        maybeSingle: async () => ({ data: error === null ? answer : null, error }),
      };
      return self;
    },
  } as unknown as ServiceClient;
  return { client, calls };
}

const player = (memberships: Array<{ role: string }>) => ({
  id: 'pid-1',
  puuid: 'puuid-1',
  group_memberships: memberships,
});

describe('supabasePlayerInGroup', () => {
  it('asks once: the player by Discord id, the membership embedded (not !inner) and filtered to the group', async () => {
    const { client, calls } = fakeClient(player([{ role: 'member' }]));
    await supabasePlayerInGroup(client)(DISCORD, GROUP);
    expect(calls).toEqual([
      {
        table: 'players',
        select: 'id, puuid, group_memberships(role)',
        eq: [
          ['discord_id', DISCORD],
          ['group_memberships.group_id', GROUP],
        ],
      },
    ]);
    expect(calls[0]?.select).not.toContain('!inner');
  });

  it('unlinked: no player row is null', async () => {
    const { client } = fakeClient(null);
    expect(await supabasePlayerInGroup(client)(DISCORD, GROUP)).toBeNull();
  });

  it('linked non-member: the player, with no role', async () => {
    const { client } = fakeClient(player([]));
    expect(await supabasePlayerInGroup(client)(DISCORD, GROUP)).toEqual({
      player: { playerId: 'pid-1', puuid: 'puuid-1' },
      role: null,
    });
  });

  it.each(['owner', 'admin', 'member'] as const)('a %s: the player and the role', async (role) => {
    const { client } = fakeClient(player([{ role }]));
    expect(await supabasePlayerInGroup(client)(DISCORD, GROUP)).toEqual({
      player: { playerId: 'pid-1', puuid: 'puuid-1' },
      role,
    });
  });

  it('a role string the union does not know grants nothing', async () => {
    const { client } = fakeClient(player([{ role: 'superuser' }]));
    expect(await supabasePlayerInGroup(client)(DISCORD, GROUP)).toEqual({
      player: { playerId: 'pid-1', puuid: 'puuid-1' },
      role: null,
    });
  });

  it('a group id that is not a uuid: the player alone, no role, and no embed filter to 22P02 on', async () => {
    const { client, calls } = fakeClient({ id: 'pid-1', puuid: 'puuid-1' });
    expect(await supabasePlayerInGroup(client)(DISCORD, 'not-a-uuid')).toEqual({
      player: { playerId: 'pid-1', puuid: 'puuid-1' },
      role: null,
    });
    expect(calls).toEqual([{ table: 'players', select: 'id, puuid', eq: [['discord_id', DISCORD]] }]);
  });

  it('a failed read throws (the callers decide: the viewer is anonymous, the admin page errors)', async () => {
    const { client } = fakeClient(null, { message: 'boom' });
    await expect(supabasePlayerInGroup(client)(DISCORD, GROUP)).rejects.toThrow(/boom/);
  });
});

describe('viewerStateFor', () => {
  const none = async () => ['puuid-a'];
  const linked = (role: 'owner' | 'admin' | 'member' | null) => ({
    player: { playerId: 'pid-1', puuid: 'puuid-1' },
    role,
  });

  it('unlinked: the That’s me list, not anonymous', async () => {
    expect(await viewerStateFor(null, none)).toEqual({ kind: 'unlinked', claimable: ['puuid-a'] });
  });

  it('linked non-member (or an unknown role, which the lookup already made null): the you rule only', async () => {
    expect(await viewerStateFor(linked(null), none)).toEqual({
      kind: 'linked',
      puuid: 'puuid-1',
      isAdmin: false,
      isOwner: false,
      isMember: false,
    });
  });

  it('each role', async () => {
    expect(await viewerStateFor(linked('member'), none)).toMatchObject({
      isAdmin: false,
      isOwner: false,
      isMember: true,
    });
    expect(await viewerStateFor(linked('admin'), none)).toMatchObject({
      isAdmin: true,
      isOwner: false,
      isMember: true,
    });
    expect(await viewerStateFor(linked('owner'), none)).toMatchObject({
      isAdmin: true,
      isOwner: true,
      isMember: true,
    });
  });

  it('the claimable list is read only for the unlinked state', async () => {
    let reads = 0;
    const counted = async () => {
      reads += 1;
      return [];
    };
    await viewerStateFor(linked('owner'), counted);
    await viewerStateFor(linked(null), counted);
    expect(reads).toBe(0);
    await viewerStateFor(null, counted);
    expect(reads).toBe(1);
  });
});

/**
 * Since 0038 the page path no longer runs the embed above: the player and the role come from the
 * verified session lookup (`session_player`, a left join on the membership for the asked group).
 * The same three answers must survive that path: a non-member keeps their player row (what the
 * plain, non-`!inner` embed guaranteed), no player row is the unlinked case, and an unknown role is
 * no role.
 */
describe('the session_player path: resolveLiveSession -> playerInGroupOf -> viewerStateFor', () => {
  const USER = '6b1c1f9e-6a43-4e1b-9d1c-5b7f0d3a2e11';
  const SESSION = '2f0e9a3c-1d4b-4c8e-a7f6-3b2d1c0e9f88';
  const PID = '9c8b7a6f-5e4d-4c3b-a2b1-0f9e8d7c6b5a';
  const none = async () => ['puuid-a'];

  async function viewerFor(row: SessionPlayerRow) {
    const live = await resolveLiveSession({
      verifyClaims: async () => ({ sub: USER, session_id: SESSION }),
      lookupSessionPlayer: async () => row,
      groupId: GROUP,
    });
    if (live.kind !== 'signed-in') throw new Error(`expected signed-in, got ${live.kind}`);
    const member = playerInGroupOf(live);
    return { member, viewer: await viewerStateFor(member, none) };
  }
  const row = (overrides: Partial<SessionPlayerRow>): SessionPlayerRow => ({
    discord_id: DISCORD,
    player_id: PID,
    puuid: 'puuid-1',
    display_name: null,
    role: null,
    ...overrides,
  });

  it('a linked non-member keeps the player: linked, the you rule only', async () => {
    const { member, viewer } = await viewerFor(row({ role: null }));
    expect(member).toEqual({ player: { playerId: PID, puuid: 'puuid-1' }, role: null });
    expect(viewer).toEqual({
      kind: 'linked',
      puuid: 'puuid-1',
      isAdmin: false,
      isOwner: false,
      isMember: false,
    });
  });

  it('no player row: the unlinked case, not anonymous', async () => {
    const { member, viewer } = await viewerFor(row({ player_id: null, puuid: null }));
    expect(member).toBeNull();
    expect(viewer).toEqual({ kind: 'unlinked', claimable: ['puuid-a'] });
  });

  it('a role the union does not know is no role', async () => {
    expect((await viewerFor(row({ role: 'superuser' }))).member?.role).toBeNull();
  });

  it('an owner is admin and owner', async () => {
    expect((await viewerFor(row({ role: 'owner' }))).viewer).toMatchObject({
      isAdmin: true,
      isOwner: true,
      isMember: true,
    });
  });
});
