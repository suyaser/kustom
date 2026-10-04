import { describe, expect, it } from 'vitest';
import { missingThing } from './GroupNotFound';

/** The group 404 names what was missing from the path (M14.7, 05-design.md 5.8). */
describe('missingThing', () => {
  it('reads a game, a player, or anything else from the path under the group', () => {
    expect(missingThing('/g/customs/games/abc', '/g/customs')).toBe('game');
    expect(missingThing('/g/customs/p/xyz', '/g/customs')).toBe('player');
    expect(missingThing('/g/customs/games', '/g/customs')).toBe('page');
    expect(missingThing('/g/customs/p/', '/g/customs')).toBe('page');
    expect(missingThing('/g/customs/zzz', '/g/customs')).toBe('page');
    expect(missingThing('/g/customs', '/g/customs')).toBe('page');
  });
});
