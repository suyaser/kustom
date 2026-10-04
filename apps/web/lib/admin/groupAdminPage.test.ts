import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { decideAdminAccess } from './groupAdminPage';

/** Who may open `/g/<slug>/admin` (M14.21). Decided on the server from the session and the data. */

const GROUP = { id: '11111111-1111-4111-8111-111111111111' };
const CREATOR = 'auth-user-creator';

interface Answers {
  /** The session's player row id, or `null` for no player row (the unlinked case). */
  player: string | null;
  /** Its membership role in this group, `null` for none. Any string: an unknown one is tested. */
  role: string | null;
  createdBy: string | null;
}

/**
 * A client that answers the two reads the gate makes: the session's player with its membership in
 * this group embedded (one query since M19.12) and the group's creator. Records the tables it was
 * asked for.
 */
function fakeClient({ player, role, createdBy }: Answers): ServiceClient & { tables: string[] } {
  const tables: string[] = [];
  const answer = (table: string) => {
    if (table === 'players') {
      if (player === null) return { data: null, error: null };
      return {
        data: { id: player, puuid: 'p', group_memberships: role === null ? [] : [{ role }] },
        error: null,
      };
    }
    return { data: { created_by: createdBy }, error: null };
  };
  const chain = (table: string) => {
    tables.push(table);
    const self = {
      select: () => self,
      eq: () => self,
      maybeSingle: async () => answer(table),
    };
    return self;
  };
  return { from: chain, tables } as unknown as ServiceClient & { tables: string[] };
}

/** A linked player `playerId` with `role` in this group. */
const member = (role: string | null, playerId = 'p1') =>
  fakeClient({ player: playerId, role, createdBy: null });
/** A Discord session with no player row; the group was created by `createdBy`. */
const unlinkedIn = (createdBy: string | null) => fakeClient({ player: null, role: null, createdBy });

const session = (userId = 'u1') => ({ kind: 'discord', userId, discordId: 'd1' }) as const;

describe('admin page access', () => {
  it('nobody signed in: the sign-in state', async () => {
    expect(await decideAdminAccess(member(null), { kind: 'anonymous' }, GROUP)).toEqual({
      kind: 'signed-out',
    });
  });

  it('the owner and an admin of this group get the page, with their role, from one read', async () => {
    const owner = member('owner', 'p1');
    expect(await decideAdminAccess(owner, session(), GROUP)).toEqual({
      kind: 'runs-group',
      role: 'owner',
      playerId: 'p1',
    });
    // The player and the membership are one `players` query; nothing reads `group_memberships` alone.
    expect(owner.tables).toEqual(['players']);
    expect(await decideAdminAccess(member('admin', 'p2'), session(), GROUP)).toEqual({
      kind: 'runs-group',
      role: 'admin',
      playerId: 'p2',
    });
  });

  it('a member, a linked non-member, or an unknown role string is not an admin', async () => {
    expect(await decideAdminAccess(member('member'), session(), GROUP)).toEqual({ kind: 'not-admin' });
    const stranger = member(null);
    expect(await decideAdminAccess(stranger, session(), GROUP)).toEqual({ kind: 'not-admin' });
    // A linked non-member is not the unlinked case: the creator read is never made for them.
    expect(stranger.tables).toEqual(['players']);
    expect(await decideAdminAccess(member('superuser'), session(), GROUP)).toEqual({ kind: 'not-admin' });
  });

  it('a linked non-member who created the group is still not-admin, never creator-unlinked', async () => {
    const client = fakeClient({ player: 'p5', role: null, createdBy: CREATOR });
    expect(await decideAdminAccess(client, session(CREATOR), GROUP)).toEqual({ kind: 'not-admin' });
  });

  it("the group's creator before they pair lands as the unlinked creator; any other unlinked session does not", async () => {
    expect(await decideAdminAccess(unlinkedIn(CREATOR), session(CREATOR), GROUP)).toEqual({
      kind: 'creator-unlinked',
    });
    expect(await decideAdminAccess(unlinkedIn(CREATOR), session('someone-else'), GROUP)).toEqual({
      kind: 'not-admin',
    });
    expect(await decideAdminAccess(unlinkedIn(null), session(CREATOR), GROUP)).toEqual({
      kind: 'not-admin',
    });
  });

  it('the injected lookup is used instead of the client (the request-cached one)', async () => {
    const client = member('member');
    const asked: [string, string][] = [];
    const access = await decideAdminAccess(client, session(), GROUP, {
      lookupMember: async (discordId, groupId) => {
        asked.push([discordId, groupId]);
        return { player: { playerId: 'p7', puuid: 'p' }, role: 'owner' };
      },
    });
    expect(access).toEqual({ kind: 'runs-group', role: 'owner', playerId: 'p7' });
    expect(asked).toEqual([['d1', GROUP.id]]);
    expect(client.tables).toEqual([]);
  });

  it('the operator (a super-admin who does not run the group) reads it; the membership is asked first', async () => {
    const operator = { isSuperAdmin: (id: string) => id === 'u-op' };
    const op = session('u-op');
    expect(await decideAdminAccess(member(null, 'p9'), op, GROUP, operator)).toEqual({
      kind: 'operator',
    });
    expect(await decideAdminAccess(member('member', 'p9'), op, GROUP, operator)).toEqual({
      kind: 'operator',
    });
    // An operator who is this group's admin gets that group's powers, no more and no fewer.
    expect(await decideAdminAccess(member('admin', 'p9'), op, GROUP, operator)).toMatchObject({
      kind: 'runs-group',
      role: 'admin',
    });
    // An operator may sign in with no Discord identity at all.
    expect(
      await decideAdminAccess(member(null), { kind: 'no-discord', userId: 'u-op' }, GROUP, operator),
    ).toEqual({
      kind: 'operator',
    });
    expect(
      await decideAdminAccess(member(null), { kind: 'no-discord', userId: 'u-x' }, GROUP, operator),
    ).toEqual({
      kind: 'not-admin',
    });
  });
});
