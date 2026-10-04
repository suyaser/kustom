import { describe, expect, it } from 'vitest';
import { landingPath } from './landing';
import { groupSlugFromPath } from './pageGroup';

/**
 * `/` (M13.9 acceptance 3, revised by M14.24 acceptance 1): who the landing page redirects, and
 * who stays on it (`null`). The page-level half (307, the back bar, `Create your group`) is
 * `components/landing/landingRoute.test.tsx`.
 */

const member = (...slugs: string[]) => ({
  kind: 'signed-in' as const,
  memberships: slugs.map((slug) => ({ slug })),
});

describe('where / sends somebody', () => {
  it('keeps a signed-out visitor on the landing page, whatever the cookie says', () => {
    expect(landingPath({ kind: 'anonymous' }, null)).toBeNull();
    expect(landingPath({ kind: 'anonymous' }, 'thursday-flex')).toBeNull();
  });

  it("sends a member to the cookie's group when they are in it", () => {
    expect(landingPath(member('customs', 'thursday-flex'), 'thursday-flex')).toBe('/g/thursday-flex');
    expect(landingPath(member('customs', 'thursday-flex'), 'customs')).toBe('/g/customs');
  });

  it('ignores a cookie naming a group the viewer is not in, and uses their oldest group', () => {
    expect(landingPath(member('customs'), 'thursday-flex')).toBe('/g/customs');
    // Somebody who only plays in another group is not dropped on the original group's night.
    expect(landingPath(member('thursday-flex'), 'customs')).toBe('/g/thursday-flex');
    expect(landingPath(member('thursday-flex', 'customs'), null)).toBe('/g/thursday-flex');
  });

  it('keeps a signed-in person in no group at all on the landing page, cookie or not', () => {
    expect(landingPath(member(), null)).toBeNull();
    expect(landingPath(member(), 'customs')).toBeNull();
  });
});

describe('the cookie the shell writes', () => {
  it('is the slug of a group path, at any depth', () => {
    expect(groupSlugFromPath('/g/customs')).toBe('customs');
    expect(groupSlugFromPath('/g/thursday-flex/games/0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12')).toBe(
      'thursday-flex',
    );
  });

  it('is nothing for a game uuid, a malformed segment or a page outside /g/', () => {
    expect(groupSlugFromPath('/g/0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12')).toBeNull();
    expect(groupSlugFromPath('/g/Customs')).toBeNull();
    expect(groupSlugFromPath('/g/new')).toBeNull();
    expect(groupSlugFromPath('/g/%E0%A4%A')).toBeNull();
    expect(groupSlugFromPath('/leaderboard')).toBeNull();
  });
});
