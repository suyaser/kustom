import { describe, expect, it } from 'vitest';
import {
  isWindow,
  LEADERBOARD_WINDOW,
  PLAYER_WINDOW,
  STATS_WINDOW,
  WINDOW_ORDER,
  windowKindSchema,
  windowOrDefault,
} from './window';

/** M14.45: the zod-free guard client links use agrees with the schema the server parses with. */
describe('isWindow', () => {
  it('accepts exactly the three, like windowKindSchema', () => {
    for (const value of [
      ...WINDOW_ORDER,
      'this-month',
      'last-month',
      'foo',
      '',
      'All-Time',
      ['all-time'],
      null,
      3,
    ]) {
      expect(isWindow(value), String(value)).toBe(windowKindSchema.safeParse(value).success);
    }
  });
});

/** M14.7: an unknown `?window=` falls back to the page's default, never a 404. */
describe('windowOrDefault', () => {
  it('keeps a known window', () => {
    expect(windowOrDefault('all-time', LEADERBOARD_WINDOW)).toBe('all-time');
  });

  it('uses the default when the parameter is absent', () => {
    expect(windowOrDefault(undefined, LEADERBOARD_WINDOW)).toBe(LEADERBOARD_WINDOW);
  });

  it('falls back on an unknown or repeated value instead of refusing it', () => {
    expect(windowOrDefault('foo', LEADERBOARD_WINDOW)).toBe(LEADERBOARD_WINDOW);
    expect(windowOrDefault('', LEADERBOARD_WINDOW)).toBe(LEADERBOARD_WINDOW);
    expect(windowOrDefault(['all-time', 'last-week'], LEADERBOARD_WINDOW)).toBe(LEADERBOARD_WINDOW);
  });

  /** M14.48: the retired month windows are old links in chat history; they open the page's default. */
  it.each([
    ['the board', LEADERBOARD_WINDOW],
    ['a player page', PLAYER_WINDOW],
    ['Stats', STATS_WINDOW],
  ] as const)('sends ?window=this-month and ?window=last-month on %s to its default', (_page, fallback) => {
    expect(windowOrDefault('this-month', fallback)).toBe(fallback);
    expect(windowOrDefault('last-month', fallback)).toBe(fallback);
  });

  it('offers no month window any more (M14.48)', () => {
    expect(WINDOW_ORDER).toEqual(['this-week', 'last-week', 'all-time']);
    expect(isWindow('this-month')).toBe(false);
    expect(isWindow('last-month')).toBe(false);
  });
});
