import { describe, expect, it } from 'vitest';
import { GROUP_SLUG_CASES } from '../groupSlugCases';
import { GROUP_ROLES, groupRoleSchema, groupSlugSchema, ORIGINAL_GROUP_ID } from './index';

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
