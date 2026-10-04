import { predictWin, provisionalSeed, type Rating } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import { type BreakdownGame, type BreakdownRow, ratingBlueWinProb, resultOdds, rowReason } from './read';

/**
 * M14.58 (why this many points) and M14.59 (which odds the result line shows), read from the
 * fold's stored breakdown. The fixture is ten settled players and one newcomer.
 */

const SETTLED: Rating = { mu: 25, sigma: 4 };

function tenRows(over: (index: number) => Partial<BreakdownRow> = () => ({})): BreakdownRow[] {
  const befores = Array.from({ length: 10 }, (_, index) => ({ mu: 24 + index * 0.3, sigma: SETTLED.sigma }));
  const blue = befores.slice(0, 5);
  const red = befores.slice(5);
  const blueP = predictWin(blue, red);
  return befores.map((before, index) => {
    const side = index < 5 ? (100 as const) : (200 as const);
    const muAfter = side === 100 ? before.mu + 0.5 : before.mu - 0.5;
    return {
      playerId: `p${index}`,
      side,
      muBefore: before.mu,
      sigmaBefore: before.sigma,
      muAfter,
      foldP: side === 100 ? blueP : 1 - blueP,
      baseMuAfter: muAfter,
      award: 'none',
      ratedGamesBefore: 20,
      ...over(index),
    };
  });
}

function game(rows: BreakdownRow[], botBlueWinProb: number | null = null): BreakdownGame {
  return { winningSide: 100, botBlueWinProb, rows };
}

describe('rowReason (M14.58)', () => {
  it('explains a stored row from what the fold stored: odds, certainty, award', () => {
    const rows = tenRows((index) =>
      index === 0 ? { muAfter: 24 + 0.625, baseMuAfter: 24.5, award: 'mvp', ratedGamesBefore: 2 } : {},
    );
    const reason = rowReason(game(rows), 'p0');
    expect(reason).toMatchObject({ basis: 'stored', result: 'won', certainty: 'new' });
    if (reason?.basis !== 'stored') throw new Error('expected a stored reason');
    expect(reason.award).toMatchObject({ kind: 'mvp' });
    expect(reason.points).toBe(Math.round(24.625 * 60) - Math.round(24 * 60));
  });

  it('uses the stored award even where a read-time badge would disagree', () => {
    // The stat columns are not read at all: the award is the stored one, what moved the number.
    const rows = tenRows((index) =>
      index === 6 ? { muAfter: 25.8 - 0.4, baseMuAfter: 25.8 - 0.5, award: 'ace' } : {},
    );
    const reason = rowReason(game(rows), 'p6');
    expect(reason).toMatchObject({ basis: 'stored', result: 'lost', award: { kind: 'ace' } });
  });

  it('falls back to the legacy reason for a row stored before 0034: award unknown', () => {
    const rows = tenRows(() => ({ foldP: null, baseMuAfter: null, award: null, ratedGamesBefore: null }));
    expect(rowReason(game(rows), 'p3')).toMatchObject({ basis: 'legacy', award: 'unknown' });
  });

  it('says only the lead for an old row missing a before', () => {
    const rows = tenRows((index) =>
      index === 9
        ? { sigmaBefore: null, foldP: null, baseMuAfter: null, award: null, ratedGamesBefore: null }
        : { foldP: null, baseMuAfter: null, award: null, ratedGamesBefore: null },
    );
    expect(rowReason(game(rows), 'p1')).toMatchObject({ basis: 'lead-only', result: 'won' });
  });

  it('is null for a row with no change (unrated, ARAM)', () => {
    const rows = tenRows(() => ({
      muBefore: null,
      muAfter: null,
      foldP: null,
      baseMuAfter: null,
      award: null,
    }));
    expect(rowReason(game(rows), 'p0')).toBeNull();
  });

  it('logs and explains as legacy a stored breakdown core refuses', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // An award of none with a bonus in it: not something the fold writes.
    const rows = tenRows((index) => (index === 0 ? { baseMuAfter: 24.3 } : {}));
    expect(rowReason(game(rows), 'p0')).toMatchObject({ basis: 'legacy' });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe('resultOdds (M14.59)', () => {
  it('shows one number when the bot s odds and the rating s round to the same percent', () => {
    const rows = tenRows();
    const p = ratingBlueWinProb(rows) as number;
    const odds = resultOdds(game(rows, p + 0.001));
    expect(odds).toMatchObject({ differ: false, reason: null });
    expect(odds?.botBluePct).toBe(odds?.ratingBluePct);
  });

  it('names both, because new players start at 1200, when one of the ten was new', () => {
    const seed = provisionalSeed();
    const rows = tenRows((index) =>
      index === 2 ? { muBefore: seed.mu, sigmaBefore: seed.sigma, ratedGamesBefore: 0 } : {},
    );
    // The bot rated the newcomer from their rank at the roll: a different number.
    const odds = resultOdds(game(rows, 0.57));
    expect(odds).toMatchObject({ botBluePct: 57, differ: true, reason: 'new-players' });
    expect(odds?.ratingBluePct).not.toBe(57);
    expect(odds?.pointsBluePct).toBe(odds?.ratingBluePct);
  });

  it('says ratings moved since the roll when nobody was new', () => {
    const odds = resultOdds(game(tenRows(), 0.9));
    expect(odds).toMatchObject({ botBluePct: 90, differ: true, reason: 'ratings-moved' });
  });

  it('recognises a newcomer on a legacy row by the 1200 seed', () => {
    const seed = provisionalSeed();
    const rows = tenRows((index) => ({
      foldP: null,
      baseMuAfter: null,
      award: null,
      ratedGamesBefore: null,
      ...(index === 7 ? { muBefore: seed.mu, sigmaBefore: seed.sigma } : {}),
    }));
    expect(resultOdds(game(rows, 0.99))).toMatchObject({ differ: true, reason: 'new-players' });
  });

  it('uses the rating s number on a game the bot did not pick', () => {
    const odds = resultOdds(game(tenRows(), null));
    expect(odds).toMatchObject({ botBluePct: null, differ: false, reason: null });
    expect(odds?.pointsBluePct).toBe(odds?.ratingBluePct);
  });

  it('is the bot s number alone for an unrated game, and null with neither', () => {
    const unrated = tenRows(() => ({
      muBefore: null,
      muAfter: null,
      foldP: null,
      baseMuAfter: null,
      award: null,
    }));
    expect(resultOdds(game(unrated, 0.55))).toMatchObject({
      botBluePct: 55,
      ratingBluePct: null,
      differ: false,
    });
    expect(resultOdds(game(unrated, null))).toBeNull();
  });

  /** Acceptance 4: the explanation's percent equals the result line's rating percent. */
  it('agrees with the explanation s percent on every row of a stored game', () => {
    const rows = tenRows();
    const odds = resultOdds(game(rows, 0.3));
    for (const row of rows) {
      const reason = rowReason(game(rows, 0.3), row.playerId);
      if (reason?.basis !== 'stored') throw new Error('expected a stored reason');
      const sidePct = row.side === 100 ? odds?.ratingBluePct : 100 - (odds?.ratingBluePct as number);
      expect(reason.odds.pct).toBe(sidePct);
    }
  });
});
