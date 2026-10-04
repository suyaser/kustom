import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as constants from './constants';
import { GROUP_SLUG_CASES } from './groupSlugCases';
import * as schemas from './schemas/index';

describe('@customs/db/constants (M14.44)', () => {
  it('isGroupSlug agrees with groupSlugSchema on every slug case', () => {
    for (const { slug, valid } of GROUP_SLUG_CASES) {
      expect(constants.isGroupSlug(slug), slug).toBe(valid);
      expect(constants.isGroupSlug(slug), slug).toBe(schemas.groupSlugSchema.safeParse(slug).success);
    }
  });

  it('is what ./schemas re-exports, not a second copy', () => {
    expect(schemas.ORIGINAL_GROUP_ID).toBe(constants.ORIGINAL_GROUP_ID);
    expect(schemas.RESERVED_GROUP_SLUGS).toBe(constants.RESERVED_GROUP_SLUGS);
    expect(schemas.GROUP_SLUG_PATTERN).toBe(constants.GROUP_SLUG_PATTERN);
    expect(schemas.DETECTED_TEAM_POSITION_ROLES).toBe(constants.DETECTED_TEAM_POSITION_ROLES);
    expect(schemas.roleFromDetectedTeamPosition).toBe(constants.roleFromDetectedTeamPosition);
  });

  it('imports no zod, only types and zod-free files', () => {
    // The whole point of the entry: a browser bundle that imports it must not pull zod in.
    const source = fs.readFileSync(new URL('./constants.ts', import.meta.url), 'utf8');
    const valueImports = [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(
      (match) => match[1],
    );
    expect(valueImports).toEqual(['./rosterKey']);
    expect(fs.readFileSync(new URL('./rosterKey.ts', import.meta.url), 'utf8')).not.toMatch(
      /^import\s+(?!type)/m,
    );
  });
});
