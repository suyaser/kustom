import { describe, expect, it } from 'vitest';
import { GROUP_SLUG_CASES } from '../groupSlugCases';
import {
  GROUP_ROLES,
  groupIdSchema,
  groupRoleSchema,
  groupSlugSchema,
  mysteryTodayQuerySchema,
  ORIGINAL_GROUP_ID,
  overlayGroupsResponseSchema,
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
  it('is exactly member and admin', () => {
    expect(GROUP_ROLES).toEqual(['member', 'admin']);
    expect(groupRoleSchema.safeParse('admin').success).toBe(true);
    expect(groupRoleSchema.safeParse('owner').success).toBe(false);
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
