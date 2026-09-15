import { describe, expect, it } from 'vitest';
import { INT32_MAX, storedStat } from './statValue';

/**
 * The gate between a number in `games.raw` and an `integer` column (M7.7 review).
 *
 * The bug it exists for: a blob with `VISION_SCORE: -3` used to write the `games` row and then
 * fail the `game_players` insert on the column's check constraint, so the game was stored,
 * unratable, and retried into the same 500 for ever. A value past int4 did the same by
 * overflow, which no check constraint can catch. Both are now null — the one value that
 * already means "this game never stored it".
 */

describe('storedStat', () => {
  it('keeps a real number, including a genuine zero', () => {
    expect(storedStat(0)).toBe(0);
    expect(storedStat(53)).toBe(53);
    expect(storedStat(199_376)).toBe(199_376);
    expect(storedStat(INT32_MAX)).toBe(INT32_MAX);
  });

  it('is null for nothing at all', () => {
    expect(storedStat(null)).toBeNull();
    expect(storedStat(undefined)).toBeNull();
  });

  it('is null for a negative: the check constraint must never be what catches one', () => {
    expect(storedStat(-1)).toBeNull();
    expect(storedStat(-3)).toBeNull();
    expect(storedStat(-2_147_483_648)).toBeNull();
  });

  it('is null past int4, which the check constraint cannot see at all', () => {
    expect(storedStat(INT32_MAX + 1)).toBeNull();
    expect(storedStat(4_000_000_000)).toBeNull();
    expect(storedStat(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('is null for a number that is not one', () => {
    expect(storedStat(Number.NaN)).toBeNull();
    expect(storedStat(Number.POSITIVE_INFINITY)).toBeNull();
    expect(storedStat(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('truncates a float, the way every other stat read does', () => {
    expect(storedStat(12.7)).toBe(12);
    expect(storedStat(0.9)).toBe(0);
  });

  it('never invents a number: nonsense is null, not 0 and not the maximum', () => {
    // The whole point. A clamped-to-0 tank would be scored as a tank who mitigated nothing,
    // and a clamped-to-INT32_MAX one would be the MVP of every game with a corrupt blob.
    expect(storedStat(-5)).not.toBe(0);
    expect(storedStat(1e12)).not.toBe(INT32_MAX);
  });
});
