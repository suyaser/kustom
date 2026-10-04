import { describe, expect, it } from 'vitest';
import { canUnlinkDiscord, memberActions } from './memberActions';

/** Which buttons each row shows (M14.22 acceptance 8; STRATEGY 3.5). */

const OWNER = { role: 'owner', playerId: 'p-owner' } as const;
const ADMIN = { role: 'admin', playerId: 'p-admin' } as const;
const row = (playerId: string, role: 'owner' | 'admin' | 'member') => ({ playerId, role });

describe('member actions', () => {
  it('the owner row has no actions, for anyone, not even the owner', () => {
    expect(memberActions(OWNER, row('p-owner', 'owner'))).toEqual([]);
    expect(memberActions(ADMIN, row('p-owner', 'owner'))).toEqual([]);
    expect(memberActions({ role: 'read-only' }, row('p-owner', 'owner'))).toEqual([]);
  });

  it('the owner: members can be made admin or removed; admins made member, made owner or removed', () => {
    expect(memberActions(OWNER, row('p1', 'member'))).toEqual(['make-admin', 'remove']);
    expect(memberActions(OWNER, row('p2', 'admin'))).toEqual(['make-member', 'make-owner', 'remove']);
  });

  it('an admin: members only; no remove, demote or handover on another admin, nothing on themselves', () => {
    expect(memberActions(ADMIN, row('p1', 'member'))).toEqual(['make-admin', 'remove']);
    expect(memberActions(ADMIN, row('p2', 'admin'))).toEqual([]);
    expect(memberActions(ADMIN, row('p-admin', 'admin'))).toEqual([]);
  });

  it('the operator acts on nobody', () => {
    expect(memberActions({ role: 'read-only' }, row('p1', 'member'))).toEqual([]);
    expect(memberActions({ role: 'read-only' }, row('p2', 'admin'))).toEqual([]);
  });
});

describe('Unlink Discord (M14.60)', () => {
  const linked = (playerId: string, role: 'owner' | 'admin' | 'member', discordLinked = true) => ({
    playerId,
    role,
    discordLinked,
  });

  it('only when a Discord account is linked', () => {
    expect(canUnlinkDiscord(OWNER, linked('p1', 'member', false))).toBe(false);
    expect(canUnlinkDiscord(OWNER, linked('p1', 'member'))).toBe(true);
  });

  it('the owner unlinks admins and members, never themselves (round 2 ruling)', () => {
    expect(canUnlinkDiscord(OWNER, linked('p-owner', 'owner'))).toBe(false);
    expect(canUnlinkDiscord(OWNER, linked('p2', 'admin'))).toBe(true);
  });

  it('an admin unlinks members and themselves, never the owner or another admin', () => {
    expect(canUnlinkDiscord(ADMIN, linked('p1', 'member'))).toBe(true);
    expect(canUnlinkDiscord(ADMIN, linked('p-admin', 'admin'))).toBe(true);
    expect(canUnlinkDiscord(ADMIN, linked('p-owner', 'owner'))).toBe(false);
    expect(canUnlinkDiscord(ADMIN, linked('p2', 'admin'))).toBe(false);
  });

  it('the operator unlinks nobody', () => {
    expect(canUnlinkDiscord({ role: 'read-only' }, linked('p1', 'member'))).toBe(false);
  });
});
