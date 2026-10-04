import { calibration } from '@customs/core';
import { describe, expect, it } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import {
  type CalibrationCandidate,
  calibrationGameOf,
  gameReceiptOf,
  type ReceiptSeat,
  teamsMatchSplit,
} from './receipt';

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const BLUE = ['b1', 'b2', 'b3', 'b4', 'b5'];
const RED = ['r1', 'r2', 'r3', 'r4', 'r5'];

function seats(
  blue = BLUE,
  red = RED,
  rating: { mu: number | null; sigma: number | null } = { mu: 25, sigma: 5 },
): ReceiptSeat[] {
  return [
    ...blue.map((puuid) => ({ puuid, side: 100 as const, muBefore: rating.mu, sigmaBefore: rating.sigma })),
    ...red.map((puuid) => ({ puuid, side: 200 as const, muBefore: rating.mu, sigmaBefore: rating.sigma })),
  ];
}

function split(rank: number, options: Partial<StoredSplit> = {}, blue = BLUE, red = RED): StoredSplit {
  return {
    rank,
    isChosen: rank === 1,
    blueWinProb: 0.54,
    gap: 40,
    offRoleCount: 0,
    blue: blue.map((puuid, i) => ({ puuid, role: ROLES[i] ?? 'top' })),
    red: red.map((puuid, i) => ({ puuid, role: ROLES[i] ?? 'top' })),
    explanation: 'Blue favored 54%.',
    ...options,
  };
}

describe('teamsMatchSplit', () => {
  it('is the same ten on the same sides, whatever order or lanes', () => {
    expect(teamsMatchSplit(split(1), seats([...BLUE].reverse(), RED))).toBe(true);
  });

  it('is false when two people swapped sides in the lobby, or a tenth is missing', () => {
    expect(
      teamsMatchSplit(split(1), seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5'])),
    ).toBe(false);
    expect(teamsMatchSplit(split(1), seats(BLUE, RED.slice(0, 4)))).toBe(false);
  });
});

describe('gameReceiptOf', () => {
  it('is the rolled receipt when the bot picked the teams that played', () => {
    const run = [split(1), split(2, { blueWinProb: 0.57 })];
    const receipt = gameReceiptOf({ aram: false, rated: true, seats: seats(), splits: run });
    expect(receipt).toMatchObject({ kind: 'rolled', chosen: { rank: 1 } });
  });

  it('is pre-game odds with the no-split line for a backfilled game', () => {
    const receipt = gameReceiptOf({ aram: false, rated: true, seats: seats(), splits: [] });
    expect(receipt).toMatchObject({ kind: 'pre-game', reason: 'no-split', rolled: null });
    if (receipt.kind !== 'pre-game') throw new Error('unreachable');
    expect(receipt.ratingsBefore.blue).toHaveLength(5);
  });

  it('is pre-game odds with the teams-changed line, keeping the run for the disclosure', () => {
    const run = [split(1)];
    const receipt = gameReceiptOf({
      aram: false,
      rated: true,
      seats: seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5']),
      splits: run,
    });
    expect(receipt).toMatchObject({ kind: 'pre-game', reason: 'teams-changed', rolled: run });
  });

  it('carries a missing mu_before through, for the receipt to say No odds', () => {
    const receipt = gameReceiptOf({
      aram: false,
      rated: true,
      seats: seats(BLUE, RED, { mu: null, sigma: null }),
      splits: [],
    });
    expect(receipt).toMatchObject({ kind: 'pre-game' });
    if (receipt.kind !== 'pre-game') throw new Error('unreachable');
    expect(receipt.ratingsBefore.blue[0]).toEqual({ mu: null, sigma: null });
  });

  it('makes no rating claim on an ARAM the bot did not roll', () => {
    expect(gameReceiptOf({ aram: true, rated: false, seats: seats(), splits: [] })).toEqual({ kind: 'none' });
    expect(gameReceiptOf({ aram: true, rated: false, seats: seats(), splits: [split(1)] })).toMatchObject({
      kind: 'rolled',
    });
  });

  describe('a game played not rated (M15.18)', () => {
    const swapped = () => seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5']);

    it('keeps its rolled odds when the bot picked the teams that played', () => {
      const run = [split(1), split(2, { blueWinProb: 0.57 })];
      expect(gameReceiptOf({ aram: false, rated: false, seats: seats(), splits: run })).toMatchObject({
        kind: 'rolled',
        chosen: { rank: 1, blueWinProb: 0.54 },
      });
    });

    it('shows no odds once the teams changed after the roll, as for ARAM', () => {
      expect(gameReceiptOf({ aram: false, rated: false, seats: swapped(), splits: [split(1)] })).toEqual({
        kind: 'none',
      });
    });

    it('shows no odds with no roll at all', () => {
      expect(gameReceiptOf({ aram: false, rated: false, seats: seats(), splits: [] })).toEqual({
        kind: 'none',
      });
    });

    it('a rated game whose teams changed keeps its pre-game odds', () => {
      expect(gameReceiptOf({ aram: false, rated: true, seats: swapped(), splits: [split(1)] })).toMatchObject(
        {
          kind: 'pre-game',
          reason: 'teams-changed',
        },
      );
    });
  });

  it('trusts only is_chosen: a run with no chosen split is a split-less game', () => {
    const receipt = gameReceiptOf({
      aram: false,
      rated: true,
      seats: seats(),
      splits: [split(1, { isChosen: false })],
    });
    expect(receipt).toMatchObject({ kind: 'pre-game', reason: 'no-split' });
  });
});

describe('calibrationGameOf (STRATEGY §4.8)', () => {
  const candidate = (overrides: Partial<CalibrationCandidate> = {}): CalibrationCandidate => ({
    aram: false,
    winningSide: 100,
    rated: true,
    seats: seats(),
    chosen: split(1, { blueWinProb: 0.6 }),
    ...overrides,
  });

  it('counts a rated Rift game whose ten played the chosen split', () => {
    expect(calibrationGameOf(candidate())).toEqual({ blueWinProb: 0.6, blueWon: true });
  });

  it('drops a changed-teams game, an unrated one, an ARAM, an even call and a split-less one', () => {
    expect(
      calibrationGameOf(
        candidate({ seats: seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5']) }),
      ),
    ).toBeNull();
    expect(calibrationGameOf(candidate({ rated: false }))).toBeNull();
    expect(calibrationGameOf(candidate({ aram: true }))).toBeNull();
    expect(calibrationGameOf(candidate({ chosen: split(1, { blueWinProb: 0.5 }) }))).toBeNull();
    expect(calibrationGameOf(candidate({ chosen: null }))).toBeNull();
  });

  it('feeds core: the changed-teams game is not in N', () => {
    const games = [
      candidate({ winningSide: 100 }),
      candidate({ winningSide: 200 }),
      candidate({ seats: seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5']) }),
    ];
    const counted = games.map(calibrationGameOf).filter((game) => game !== null);
    expect(calibration(counted)).toMatchObject({ n: 2, favoredWon: 1, expectedPct: 60, actualPct: 50 });
  });
});
