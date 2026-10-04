import { calibration } from '@customs/core';
import { describe, expect, it } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import {
  type CalibrationCandidate,
  calibrationGameOf,
  gameReceiptOf,
  type ReceiptSeat,
  splitSidesOf,
  teamsMatchSplit,
} from './receipt';

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const BLUE = ['b1', 'b2', 'b3', 'b4', 'b5'];
const RED = ['r1', 'r2', 'r3', 'r4', 'r5'];

function seats(blue = BLUE, red = RED, rating: { r: number | null } = { r: 1500 }): ReceiptSeat[] {
  const seat = (puuid: string, side: 100 | 200): ReceiptSeat => ({ puuid, side, rBefore: rating.r });
  return [...blue.map((puuid) => seat(puuid, 100)), ...red.map((puuid) => seat(puuid, 200))];
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

describe('splitSidesOf (M21.4)', () => {
  it('same: the split on its own sides, whatever order or lanes', () => {
    expect(splitSidesOf(split(1), seats([...BLUE].reverse(), RED))).toBe('same');
  });

  it("swapped: the split's two teams on each other's sides; teamsMatchSplit stays false", () => {
    expect(splitSidesOf(split(1), seats(RED, BLUE))).toBe('swapped');
    expect(teamsMatchSplit(split(1), seats(RED, BLUE))).toBe(false);
  });

  it('different: two people traded, a player missing, or a smaller game that is not the split', () => {
    expect(splitSidesOf(split(1), seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5']))).toBe(
      'different',
    );
    expect(splitSidesOf(split(1), seats(BLUE, RED.slice(0, 4)))).toBe('different');
    expect(splitSidesOf(split(1), seats(BLUE.slice(0, 3), RED.slice(0, 3)))).toBe('different');
  });

  it('a smaller split matches a smaller game, swapped too', () => {
    const small = split(1, {}, BLUE.slice(0, 3), RED.slice(0, 3));
    expect(splitSidesOf(small, seats(BLUE.slice(0, 3), RED.slice(0, 3)))).toBe('same');
    expect(splitSidesOf(small, seats(RED.slice(0, 3), BLUE.slice(0, 3)))).toBe('swapped');
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

  it('carries a missing r_before through, for the receipt to say No odds (M18.5)', () => {
    const receipt = gameReceiptOf({
      aram: false,
      rated: true,
      seats: seats(BLUE, RED, { r: null }),
      splits: [],
    });
    expect(receipt).toMatchObject({ kind: 'pre-game' });
    if (receipt.kind !== 'pre-game') throw new Error('unreachable');
    expect(receipt.ratingsBefore.blue[0]).toEqual({ r: null });
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
    chosen: { ...split(1, { blueWinProb: 0.6 }), oddsModel: 'kustom' },
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
    expect(
      calibrationGameOf(candidate({ chosen: { ...split(1, { blueWinProb: 0.5 }), oddsModel: 'kustom' } })),
    ).toBeNull();
    expect(calibrationGameOf(candidate({ chosen: null }))).toBeNull();
  });

  it('counts only Kustom rolls (M18.6): an OpenSkill roll, or one with no model, is not a call this line checks', () => {
    expect(
      calibrationGameOf(candidate({ chosen: { ...split(1, { blueWinProb: 0.6 }), oddsModel: 'openskill' } })),
    ).toBeNull();
    expect(calibrationGameOf(candidate({ chosen: split(1, { blueWinProb: 0.6 }) }))).toBeNull();
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
