import { describe, expect, it } from 'vitest';
import { GROUP_SLUG_CASES } from '../groupSlugCases';
import {
  ASSIGNABLE_GROUP_ROLES,
  assignableGroupRoleSchema,
  GROUP_ROLES,
  groupIdSchema,
  groupRoleSchema,
  groupSlugSchema,
  isAtLeast,
  memberRemoveRequestSchema,
  memberRoleRequestSchema,
  memberUnlinkDiscordRequestSchema,
  mysteryTodayQuerySchema,
  ORIGINAL_GROUP_ID,
  overlayGroupsResponseSchema,
  ownerTransferRequestSchema,
  roleTonightRequestSchema,
} from './index';

describe('groupSlugSchema', () => {
  it.each(GROUP_SLUG_CASES.map((c) => [c.slug, c.valid, c.why] as const))(
    '%s -> valid %s (%s)',
    (slug, valid) => {
      expect(groupSlugSchema.safeParse(slug).success).toBe(valid);
    },
  );

  it('does not trim or lowercase its way into accepting a slug the database refuses', () => {
    expect(groupSlugSchema.safeParse(' abc').success).toBe(false);
    expect(groupSlugSchema.safeParse('ABC').success).toBe(false);
  });
});

describe('groupRoleSchema', () => {
  it('is exactly member, admin and owner, lowest first (M14.11, 0023)', () => {
    expect(GROUP_ROLES).toEqual(['member', 'admin', 'owner']);
    expect(groupRoleSchema.safeParse('owner').success).toBe(true);
    expect(groupRoleSchema.safeParse('superadmin').success).toBe(false);
  });

  it('only lets the role route set member or admin, never owner', () => {
    expect(ASSIGNABLE_GROUP_ROLES).toEqual(['member', 'admin']);
    expect(assignableGroupRoleSchema.safeParse('owner').success).toBe(false);
  });
});

describe('isAtLeast', () => {
  it('ranks owner above admin above member', () => {
    expect(isAtLeast('owner', 'admin')).toBe(true);
    expect(isAtLeast('admin', 'admin')).toBe(true);
    expect(isAtLeast('member', 'admin')).toBe(false);
    expect(isAtLeast('admin', 'owner')).toBe(false);
    expect(isAtLeast('owner', 'owner')).toBe(true);
    expect(isAtLeast('member', 'member')).toBe(true);
  });

  it('is false for somebody who is not a member at all', () => {
    expect(isAtLeast(null, 'member')).toBe(false);
    expect(isAtLeast(undefined, 'admin')).toBe(false);
  });
});

describe('the member writes (M14.11)', () => {
  const GROUP = '00000000-0000-0000-0000-000000000001';
  const PLAYER = '22222222-2222-4222-8222-222222222222';

  it('take the original group id (not a v4 uuid) and a player uuid', () => {
    for (const schema of [
      memberRemoveRequestSchema,
      ownerTransferRequestSchema,
      memberUnlinkDiscordRequestSchema,
    ]) {
      expect(schema.safeParse({ groupId: GROUP, playerId: PLAYER }).success).toBe(true);
      expect(schema.safeParse({ groupId: GROUP, playerId: 'nope' }).success).toBe(false);
      expect(schema.safeParse({ playerId: PLAYER }).success).toBe(false);
    }
  });

  it('refuse owner as a role to set', () => {
    expect(
      memberRoleRequestSchema.safeParse({ groupId: GROUP, playerId: PLAYER, role: 'admin' }).success,
    ).toBe(true);
    expect(
      memberRoleRequestSchema.safeParse({ groupId: GROUP, playerId: PLAYER, role: 'owner' }).success,
    ).toBe(false);
  });
});

describe('ORIGINAL_GROUP_ID', () => {
  it('is the fixed id 0018_groups.sql gives the original group', () => {
    expect(ORIGINAL_GROUP_ID).toBe('00000000-0000-0000-0000-000000000001');
  });
});

/**
 * The original group's fixed id has version nibble 0, which zod's `z.uuid()` refuses (it checks
 * the RFC 9562 version and variant). Every schema that carries a group id must accept it, or the
 * only group that exists is a 400 on every route and a 500 on every response that names it
 * (`/api/overlay/groups` shipped that way in M13.3; fixed in M13.4).
 */
describe('groupIdSchema', () => {
  it("accepts the original group's id, and a random v4 one, and nothing that is not a uuid", () => {
    expect(groupIdSchema.safeParse(ORIGINAL_GROUP_ID).success).toBe(true);
    expect(groupIdSchema.safeParse('3f1c2a9e-8b7d-4c6e-9a5b-1d2e3f4a5b6c').success).toBe(true);
    expect(groupIdSchema.safeParse('customs').success).toBe(false);
    expect(groupIdSchema.safeParse('').success).toBe(false);
  });

  it('is what every group-carrying schema accepts the original group through', () => {
    expect(
      overlayGroupsResponseSchema.safeParse({
        ok: true,
        groups: [{ id: ORIGINAL_GROUP_ID, slug: 'customs', name: 'Customs Night' }],
      }).success,
    ).toBe(true);
    expect(mysteryTodayQuerySchema.safeParse({ group: ORIGINAL_GROUP_ID }).success).toBe(true);
    expect(
      roleTonightRequestSchema.safeParse({
        groupId: ORIGINAL_GROUP_ID,
        lobbyId: '3f1c2a9e-8b7d-4c6e-9a5b-1d2e3f4a5b6c',
        role: 'mid',
      }).success,
    ).toBe(true);
  });
});
