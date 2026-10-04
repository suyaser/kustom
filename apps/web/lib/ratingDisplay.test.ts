import { displayKustom } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { displayDelta, sumDisplayDeltas } from './ratingDisplay';

/**
 * The one delta rule (M3.3, Kustom since M18.6), which every surface that prints a rating change
 * depends on.
 */

describe('displayDelta', () => {
  it('rounds both Ratings first, so the row on the screen adds up', () => {
    expect(displayDelta(1291.6, 1300.0)).toBe(8);
    expect(displayKustom(1291.6) + displayDelta(1291.6, 1300.0)).toBe(displayKustom(1300.0));
  });

  it('is never `round(rAfter - rBefore)` (the XETA case of 05-design 11.8)', () => {
    // 1243.7 -> 1237.4 is -6.3, printed -7 because the Ratings print 1244 and 1237.
    expect(displayDelta(1243.7, 1237.4)).toBe(-7);
    expect(Math.round(1237.4 - 1243.7)).toBe(-6);
  });

  it('keeps the direction of a change too small to round to a point', () => {
    const down = displayDelta(1200.2, 1200.1);
    expect(down === 0).toBe(true);
    expect(Object.is(down, -0)).toBe(true);
    expect(Object.is(displayDelta(1200.1, 1200.2), -0)).toBe(false);
    expect(Object.is(displayDelta(1200, 1200), -0)).toBe(false);
  });
});

describe('sumDisplayDeltas', () => {
  it('sums the printed changes of a chain to round(last) - round(first)', () => {
    const chain = [1200, 1216.4, 1209.1, 1224.9, 1218.5];
    const pairs = chain.slice(1).map((rAfter, i) => ({ rBefore: chain[i] as number, rAfter }));
    expect(sumDisplayDeltas(pairs)).toBe(displayKustom(1218.5) - 1200);
  });

  it('is null for nothing and +0 for a net zero', () => {
    expect(sumDisplayDeltas([])).toBeNull();
    const zero = sumDisplayDeltas([
      { rBefore: 1200, rAfter: 1208 },
      { rBefore: 1208, rAfter: 1200 },
    ]);
    expect(Object.is(zero, 0)).toBe(true);
  });
});
