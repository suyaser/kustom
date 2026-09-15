import { balance, config } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { workedBalance, workedPool } from '../testing/workedExample';
import { type FillGame, fillDistances, toBalancePlayer } from './balance';
import type { PoolMember } from './selection';

/**
 * Fill protection's input (M7.6), on the pure half: the walk that turns a player's games,
 * newest first, into `gamesSinceLastFill`, and the mapping that hands it to the balancer.
 *
 * The query that produces those rows is in `fill.integration.test.ts`, against the local
 * stack, driven through the real ingest — the flags there are written by the fold rather than
 * by a fixture.
 */

const WINDOW = config.roles.inferenceWindow;

/** `'.'` is a game that counts, `'x'` is one the balancer filled them into. Newest first. */
function history(pattern: string, playerId = 'p'): FillGame[] {
  return [...pattern].map((mark) => ({ playerId, countsForRoleInference: mark !== 'x' }));
}

describe('fillDistances', () => {
  it('is empty for no games at all', () => {
    expect(fillDistances([])).toEqual(new Map());
  });

  it('reads 0 when their last game was a fill', () => {
    expect(fillDistances(history('x...')).get('p')).toBe(0);
  });

  it('reads 3 three games after a fill', () => {
    expect(fillDistances(history('...x..')).get('p')).toBe(3);
  });

  it('leaves out a player with no fill, which the caller reads as null', () => {
    const distances = fillDistances(history('.....'));
    expect(distances.has('p')).toBe(false);
    expect(distances.get('p') ?? null).toBeNull();
  });

  it('counts from the most recent fill, not the oldest', () => {
    expect(fillDistances(history('.x..x.')).get('p')).toBe(1);
  });

  it('sees a fill on the last game of the window and not one game past it', () => {
    const edge = `${'.'.repeat(WINDOW - 1)}x`;
    expect(fillDistances(history(edge)).get('p')).toBe(WINDOW - 1);

    const past = `${'.'.repeat(WINDOW)}x`;
    expect(fillDistances(history(past)).has('p')).toBe(false);
  });

  it('counts each player over their own games, whoever else was in them', () => {
    // One night of five games, interleaved the way the rows come back: game by game, newest
    // first, every player in each of them.
    const rows: FillGame[] = [];
    for (const marks of ['..x', '.x.', '...', 'x..', '...']) {
      for (const [seat, mark] of [...marks].entries()) {
        rows.push({ playerId: `p${seat}`, countsForRoleInference: mark !== 'x' });
      }
    }

    const distances = fillDistances(rows);
    expect(distances.get('p0')).toBe(3);
    expect(distances.get('p1')).toBe(1);
    expect(distances.get('p2')).toBe(0);
  });

  it('takes the window as an argument so the default is the one config decides', () => {
    expect(fillDistances(history('..x'), 2).has('p')).toBe(false);
    expect(fillDistances(history('..x'), 3).get('p')).toBe(2);
  });
});

/** One of the worked ten, so the mapping is exercised on a real `PoolMember`. */
function member(overrides: Partial<PoolMember> = {}): PoolMember {
  const [first] = workedPool(overrides);
  if (first === undefined) throw new Error('the worked pool is empty');
  return first;
}

describe('toBalancePlayer', () => {
  it('hands the number through untouched', () => {
    expect(toBalancePlayer(member({ gamesSinceLastFill: 0 })).gamesSinceLastFill).toBe(0);
    expect(toBalancePlayer(member({ gamesSinceLastFill: 7 })).gamesSinceLastFill).toBe(7);
  });

  it('is null when the pool member carries nothing', () => {
    expect(member().gamesSinceLastFill).toBeUndefined();
    expect(toBalancePlayer(member()).gamesSinceLastFill).toBeNull();
  });

  it('acceptance 3: a lobby with no fills in its history splits exactly as it did', () => {
    // M1.4's worked example, through the real mapping: gaps 100 / 170 / 220, everybody on a
    // main, the same sentences. `workedBalance()` is the pinned case core's own test uses.
    const fromPool = balance({
      players: workedPool().map(toBalancePlayer),
      duos: [],
      lastSplit: null,
    });

    expect(fromPool).toEqual(workedBalance());
    expect(fromPool.splits.map((split) => split.gap)).toEqual([100, 170, 220]);
  });
});
