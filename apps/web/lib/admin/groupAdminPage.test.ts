import { describe, expect, it } from 'vitest';
import type { ServiceClient } from '../supabase';
import { decideAdminAccess } from './groupAdminPage';

/** Who may open `/g/<slug>/admin` (M14.21). Decided on the server from the session and the data. */

const GROUP = { id: '11111111-1111-4111-8111-111111111111' };
const CREATOR = 'auth-user-creator';

/** A client that answers the two reads the gate makes: a membership role and the group's creator. */
function fakeClient(role: string | null, createdBy: string | null): ServiceClient {
  const answer = (table: string) => {
    if (table === 'group_memberships') return { data: role === null ? null : { role }, error: null };
    return { data: { created_by: createdBy }, error: null };
  };
  const chain = (table: string) => {
    const self = {
      select: () => self,
      eq: () => self,
      maybeSingle: async () => answer(table),
    };
    return self;
  };
  return { from: chain } as unknown as ServiceClient;
}

const linked = (playerId: string) =>
  ({ kind: 'signed-in', userId: 'u1', discordId: 'd1', player: { playerId, puuid: 'p' } }) as const;

describe('admin page access', () => {
  it('nobody signed in: the sign-in state', async () => {
    expect(await decideAdminAccess(fakeClient(null, null), { kind: 'anonymous' }, GROUP)).toEqual({
      kind: 'signed-out',
    });
  });

  it('the owner and an admin of this group get the page, with their role', async () => {
    expect(await decideAdminAccess(fakeClient('owner', null), linked('p1'), GROUP)).toEqual({
      kind: 'runs-group',
      role: 'owner',
      playerId: 'p1',
    });
    expect(await decideAdminAccess(fakeClient('admin', null), linked('p2'), GROUP)).toMatchObject({
      kind: 'runs-group',
      role: 'admin',
    });
  });

  it('a member, or a linked stranger, is not an admin', async () => {
    expect(await decideAdminAccess(fakeClient('member', null), linked('p3'), GROUP)).toEqual({
      kind: 'not-admin',
    });
    expect(await decideAdminAccess(fakeClient(null, null), linked('p4'), GROUP)).toEqual({
      kind: 'not-admin',
    });
  });

  it("the group's creator before they pair lands as the unlinked creator; any other unlinked session does not", async () => {
    const unlinked = (userId: string) =>
      ({ kind: 'signed-in', userId, discordId: 'd', player: null }) as const;
    expect(await decideAdminAccess(fakeClient(null, CREATOR), unlinked(CREATOR), GROUP)).toEqual({
      kind: 'creator-unlinked',
    });
    expect(await decideAdminAccess(fakeClient(null, CREATOR), unlinked('someone-else'), GROUP)).toEqual({
      kind: 'not-admin',
    });
    expect(await decideAdminAccess(fakeClient(null, null), unlinked(CREATOR), GROUP)).toEqual({
      kind: 'not-admin',
    });
  });

  it('the operator (a super-admin who does not run the group) reads it; the membership is asked first', async () => {
    const operator = { isSuperAdmin: (id: string) => id === 'u-op' };
    const op = {
      kind: 'signed-in',
      userId: 'u-op',
      discordId: 'd',
      player: { playerId: 'p9', puuid: 'p' },
    } as const;
    expect(await decideAdminAccess(fakeClient(null, null), op, GROUP, operator)).toEqual({
      kind: 'operator',
    });
    expect(await decideAdminAccess(fakeClient('member', null), op, GROUP, operator)).toEqual({
      kind: 'operator',
    });
    // An operator who is this group's admin gets that group's powers, no more and no fewer.
    expect(await decideAdminAccess(fakeClient('admin', null), op, GROUP, operator)).toMatchObject({
      kind: 'runs-group',
      role: 'admin',
    });
    // An operator may sign in with no Discord identity at all.
    expect(
      await decideAdminAccess(
        fakeClient(null, null),
        { kind: 'no-discord', userId: 'u-op' },
        GROUP,
        operator,
      ),
    ).toEqual({
      kind: 'operator',
    });
    expect(
      await decideAdminAccess(fakeClient(null, null), { kind: 'no-discord', userId: 'u-x' }, GROUP, operator),
    ).toEqual({
      kind: 'not-admin',
    });
  });
});
