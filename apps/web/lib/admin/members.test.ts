import { describe, expect, it, vi } from 'vitest';
import { NOT_A_GROUP_ADMIN } from '../adminAuth';
import type { ServiceClient } from '../supabase';
import {
  LAST_ADMIN,
  NO_SUCH_MEMBER,
  ONLY_OWNER,
  OWNER_CANNOT_BE_DEMOTED,
  OWNER_CANNOT_BE_REMOVED,
  OWNER_NEEDS_ADMIN,
  removeMember,
  setMemberRole,
  transferOwnership,
} from './members';

/**
 * Every word the three definer functions (`0023`) can answer, and the status and sentence each one
 * becomes. The rules themselves are the database's and are tested against the local stack in
 * `app/api/admin/owner.integration.test.ts`; this pins the mapping, and that the actor sent is the
 * one the caller passed (the gate's), never anything else.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';

function client(answer: unknown) {
  const rpc = vi.fn(async () => ({ data: answer, error: null }));
  return { rpc, db: { rpc } as unknown as ServiceClient };
}

describe('setMemberRole', () => {
  it.each([
    ['not_member', 404, NO_SUCH_MEMBER],
    ['forbidden', 403, NOT_A_GROUP_ADMIN],
    ['owner_only', 403, ONLY_OWNER],
    ['is_owner', 409, OWNER_CANNOT_BE_DEMOTED],
    ['last_admin', 409, LAST_ADMIN],
  ] as const)('%s -> %i', async (answer, status, error) => {
    const { db } = client(answer);
    expect(
      await setMemberRole(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER, role: 'member' }),
    ).toEqual({
      ok: false,
      status,
      error,
    });
  });

  it('answers ok and unchanged, and sends the actor and the role to set_group_member_role_v2', async () => {
    const { db, rpc } = client('ok');
    expect(
      await setMemberRole(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER, role: 'admin' }),
    ).toEqual({
      ok: true,
      value: { playerId: PLAYER, role: 'admin', changed: true },
    });
    expect(rpc).toHaveBeenCalledWith('set_group_member_role_v2', {
      p_group_id: GROUP,
      p_actor_id: ACTOR,
      p_player_id: PLAYER,
      p_role: 'admin',
    });
    const again = client('unchanged');
    expect(
      await setMemberRole(again.db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER, role: 'admin' }),
    ).toMatchObject({ ok: true, value: { changed: false } });
  });

  it('never sends owner: ownership only moves by transfer', async () => {
    const { db, rpc } = client('ok');
    await expect(
      setMemberRole(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER, role: 'owner' as never }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws on a word it does not know: that is our bug, not the caller', async () => {
    const { db } = client('maybe');
    await expect(
      setMemberRole(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER, role: 'admin' }),
    ).rejects.toThrow(/unexpected answer maybe/);
  });
});

describe('removeMember', () => {
  it.each([
    ['not_member', 404, NO_SUCH_MEMBER],
    ['forbidden', 403, NOT_A_GROUP_ADMIN],
    ['owner_only', 403, ONLY_OWNER],
    ['is_owner', 409, OWNER_CANNOT_BE_REMOVED],
    ['last_admin', 409, LAST_ADMIN],
  ] as const)('%s -> %i', async (answer, status, error) => {
    const { db } = client(answer);
    expect(await removeMember(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER })).toEqual({
      ok: false,
      status,
      error,
    });
  });

  it('answers ok and sends the actor to remove_group_member', async () => {
    const { db, rpc } = client('ok');
    expect(await removeMember(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER })).toEqual({
      ok: true,
      value: { playerId: PLAYER },
    });
    expect(rpc).toHaveBeenCalledWith('remove_group_member', {
      p_group_id: GROUP,
      p_actor_id: ACTOR,
      p_player_id: PLAYER,
    });
  });
});

describe('transferOwnership', () => {
  it.each([
    ['not_member', 404, NO_SUCH_MEMBER],
    ['owner_only', 403, ONLY_OWNER],
    ['not_admin', 409, OWNER_NEEDS_ADMIN],
  ] as const)('%s -> %i', async (answer, status, error) => {
    const { db } = client(answer);
    expect(await transferOwnership(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER })).toEqual({
      ok: false,
      status,
      error,
    });
  });

  it('answers ok with the new owner and the caller as admin, unchanged with the caller as owner', async () => {
    const { db, rpc } = client('ok');
    expect(await transferOwnership(db, { groupId: GROUP, actorId: ACTOR, playerId: PLAYER })).toEqual({
      ok: true,
      value: { ownerId: PLAYER, role: 'admin', changed: true },
    });
    expect(rpc).toHaveBeenCalledWith('transfer_group_ownership', {
      p_group_id: GROUP,
      p_actor_id: ACTOR,
      p_player_id: PLAYER,
    });
    const self = client('unchanged');
    expect(await transferOwnership(self.db, { groupId: GROUP, actorId: ACTOR, playerId: ACTOR })).toEqual({
      ok: true,
      value: { ownerId: ACTOR, role: 'owner', changed: false },
    });
  });
});

describe('the sentences', () => {
  it("are product's where product wrote them", () => {
    expect(ONLY_OWNER).toBe('Only the owner can do that.');
    expect(OWNER_CANNOT_BE_REMOVED).toBe("The owner can't be removed. Hand ownership to an admin first.");
    expect(LAST_ADMIN).toBe('This group needs at least one admin.');
  });
});
