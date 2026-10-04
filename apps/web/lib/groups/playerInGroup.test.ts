import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { viewerStateFor } from '../viewer';
import { supabasePlayerInGroup } from './membership';

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
