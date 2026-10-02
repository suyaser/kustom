/**
 * Test-only (like `localStack.ts`): the one table of slug cases that both `groupSlugSchema` and
 * the `groups_slug_*` check constraints in `0018_groups.sql` must agree on (M13.2, acceptance 4).
 * The unit test runs it through zod; `groups.integration.test.ts` runs it through Postgres.
 * Nothing in the app imports this.
 */

export interface GroupSlugCase {
  slug: string;
  valid: boolean;
  why: string;
}

export const GROUP_SLUG_CASES: readonly GroupSlugCase[] = [
  { slug: 'customs', valid: true, why: 'the original group' },
  { slug: 'abc', valid: true, why: 'the shortest allowed' },
  { slug: `a${'b'.repeat(30)}c`, valid: true, why: '32 characters, the longest allowed' },
  { slug: 'team-42', valid: true, why: 'digits and a dash in the middle' },
  { slug: 'ab', valid: false, why: 'two characters' },
  { slug: `a${'b'.repeat(31)}c`, valid: false, why: '33 characters' },
  { slug: '-abc', valid: false, why: 'leading dash' },
  { slug: 'abc-', valid: false, why: 'trailing dash' },
  { slug: 'Abc', valid: false, why: 'uppercase' },
  { slug: 'a_bc', valid: false, why: 'underscore' },
  { slug: 'new', valid: false, why: 'reserved' },
  { slug: 'join', valid: false, why: 'reserved' },
  { slug: 'admin', valid: false, why: 'reserved' },
  { slug: 'ops', valid: false, why: 'reserved' },
  { slug: 'f1a2b3c4-d5e6-7890-abcd-ef1234567890', valid: false, why: 'a uuid (36 characters)' },
];
