import { describe, expect, it } from 'vitest';
import { JUST_NOW, timeAgo } from './timeAgo';

const NOW = new Date('2026-10-03T21:00:00.000Z');
const msAgo = (ms: number) => new Date(NOW.getTime() - ms);

describe('timeAgo', () => {
  it('reads like a person would say it', () => {
    expect(timeAgo(msAgo(10_000), NOW)).toBe(JUST_NOW);
    expect(timeAgo(msAgo(60_000), NOW)).toBe('1 minute ago');
    expect(timeAgo(msAgo(45 * 60_000), NOW)).toBe('45 minutes ago');
    expect(timeAgo(msAgo(3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(timeAgo(msAgo(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(timeAgo(msAgo(5 * 86_400_000), NOW)).toBe('5 days ago');
    expect(timeAgo(msAgo(70 * 86_400_000), NOW)).toBe('2 months ago');
  });

  it('a time ahead of the clock, or garbage, is just now', () => {
    expect(timeAgo(new Date(NOW.getTime() + 120_000), NOW)).toBe(JUST_NOW);
    expect(timeAgo('not a date', NOW)).toBe(JUST_NOW);
  });
});
