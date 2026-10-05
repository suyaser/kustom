import { calibration } from '@customs/core';
import { describe, expect, it } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import {
  type CalibrationCandidate,
  calibrationGameOf,
  type FoldedRow,
  foldBlueWinProb,
  gameReceiptOf,
  kickoffOddsFor,
  playedOddsOf,
  type ReceiptSeat,
  receiptBlueWinProb,
  rolledOddsOf,
  splitRolesFor,
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
    expect(
      splitSidesOf(split(1), seats(['r1', 'b2', 'b3', 'b4', 'b5'], ['b1', 'r2', 'r3', 'r4', 'r5'])),
    ).toBe('different');
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

/**
 * M21.7: the one rule for the after-game readers. Three fixture games: rolled and played (as
 * before M21.7), rolled then two people traded in the lobby (pre-game odds, the kickoff record's
 * first), and nobody rolled (as before). Swapped sides keep the bot's teams, turned round.
 */
describe('the after-game rule (M21.7)', () => {
  const TRADED_BLUE = ['r1', 'b2', 'b3', 'b4', 'b5'];
  const TRADED_RED = ['b1', 'r2', 'r3', 'r4', 'r5'];
  const traded = () => seats(TRADED_BLUE, TRADED_RED);
  const custom = (blueWinProb = 0.41) => ({
    kind: 'custom' as const,
    blue: TRADED_BLUE,
    red: TRADED_RED,
    at: '2026-10-05T19:00:00.000Z',
    blueWinProb,
    oddsModel: 'kustom' as const,
  });
  const chosen = (blueWinProb = 0.62, rank = 1) => ({ ...split(rank, { blueWinProb }), rank });

  describe('gameReceiptOf', () => {
    it('reads swapped sides as the rolled receipt, every split turned round', () => {
      const run = [split(1, { blueWinProb: 0.62 }), split(2, { blueWinProb: 0.57, isChosen: false })];
      const receipt = gameReceiptOf({ aram: false, rated: true, seats: seats(RED, BLUE), splits: run });
      expect(receipt.kind).toBe('rolled');
      if (receipt.kind !== 'rolled') return;
      expect(receipt.swapped).toBe(true);
      expect(receipt.chosen.blueWinProb).toBeCloseTo(0.38, 10);
      expect(receipt.chosen.blue.map((a) => a.puuid)).toEqual(RED);
      expect(receipt.splits[1]?.blueWinProb).toBeCloseTo(0.43, 10);
      expect(receiptBlueWinProb(receipt)).toBeCloseTo(0.38, 10);
    });

    it('carries the kickoff odds for changed teams, and prints them over the befores', () => {
      const receipt = gameReceiptOf({
        aram: false,
        rated: true,
        seats: traded(),
        splits: [split(1)],
        kickoff: custom(),
      });
      expect(receipt).toMatchObject({ kind: 'pre-game', reason: 'teams-changed', kickoffBlueWinProb: 0.41 });
      expect(receiptBlueWinProb(receipt, 0.7)).toBe(0.41);
    });

    it('a played game is exactly as before: not swapped, the run untouched', () => {
      const run = [split(1)];
      expect(gameReceiptOf({ aram: false, rated: true, seats: seats(), splits: run })).toEqual({
        kind: 'rolled',
        splits: run,
        chosen: run[0],
        swapped: false,
      });
    });
  });

  describe('kickoffOddsFor', () => {
    it('reads a custom or unrolled record whose teams are the scoreboard, side for side', () => {
      expect(kickoffOddsFor(custom(), traded())).toBe(0.41);
      expect(kickoffOddsFor({ ...custom(), kind: 'unrolled' }, traded())).toBe(0.41);
    });

    it('ignores a rolled record, a missing one, and one the scoreboard disagrees with', () => {
      expect(
        kickoffOddsFor({ kind: 'rolled', blue: BLUE, red: RED, at: 'x', swapped: false }, seats()),
      ).toBeNull();
      expect(kickoffOddsFor(null, traded())).toBeNull();
      expect(kickoffOddsFor(undefined, traded())).toBeNull();
      // The end of game wins: the record names other sides.
      expect(kickoffOddsFor(custom(), seats(TRADED_RED, TRADED_BLUE))).toBeNull();
    });
  });

  describe('playedOddsOf', () => {
    it('rolled and played: the stored odds and the pick number', () => {
      const played = playedOddsOf({ aram: false, rated: true, seats: seats(), chosen: chosen(0.62, 2) });
      expect(played).toEqual({ kind: 'rolled', blueWinProb: 0.62, rank: 2, swapped: false });
    });

    it('swapped sides: 1 - p, the pick number kept', () => {
      const played = playedOddsOf({
        aram: false,
        rated: true,
        seats: seats(RED, BLUE),
        chosen: chosen(0.62, 2),
      });
      expect(played.kind).toBe('rolled');
      expect(played.blueWinProb).toBeCloseTo(0.38, 10);
      expect(played).toMatchObject({ rank: 2, swapped: true });
    });

    it('changed teams: the kickoff odds, else preGameOdds over the befores; never the split', () => {
      const withRecord = playedOddsOf({
        aram: false,
        rated: true,
        seats: traded(),
        chosen: chosen(),
        kickoff: custom(),
      });
      expect(withRecord).toEqual({ kind: 'pre-game', blueWinProb: 0.41, rank: null, swapped: false });
      const without = playedOddsOf({ aram: false, rated: true, seats: traded(), chosen: chosen() });
      expect(without.blueWinProb).toBe(0.5);
    });

    it('changed teams on a not-rated game or an ARAM: none', () => {
      for (const flags of [
        { aram: false, rated: false },
        { aram: true, rated: false },
      ]) {
        const played = playedOddsOf({ ...flags, seats: traded(), chosen: chosen(), kickoff: custom() });
        expect(played).toEqual({ kind: 'none', blueWinProb: null, rank: null, swapped: false });
      }
    });

    it("unrolled (M21.14): the kickoff record's odds, as on the full receipt", () => {
      const played = playedOddsOf({
        aram: false,
        rated: true,
        seats: traded(),
        chosen: null,
        kickoff: { ...custom(), kind: 'unrolled' },
      });
      expect(played).toEqual({ kind: 'pre-game', blueWinProb: 0.41, rank: null, swapped: false });
    });

    it("no lobby (M21.14): the fold's number, else preGameOdds; the kickoff record still first", () => {
      const base = { aram: false, rated: true, seats: traded(), chosen: null };
      expect(playedOddsOf({ ...base, fallback: 0.37 }).blueWinProb).toBe(0.37);
      expect(playedOddsOf(base).blueWinProb).toBe(0.5);
      expect(
        playedOddsOf({ ...base, kickoff: { ...custom(), kind: 'unrolled' }, fallback: 0.37 }).blueWinProb,
      ).toBe(0.41);
      expect(playedOddsOf({ ...base, seats: seats(BLUE, RED, { r: null }) }).blueWinProb).toBeNull();
    });

    it("is gameReceiptOf's number (receiptBlueWinProb) on every kind of game", () => {
      const unrolled = { ...custom(), kind: 'unrolled' as const };
      const cases = [
        { seats: seats(), chosen: chosen(0.62, 2), kickoff: null },
        { seats: seats(RED, BLUE), chosen: chosen(0.62), kickoff: null },
        { seats: traded(), chosen: chosen(), kickoff: custom() },
        { seats: traded(), chosen: chosen(), kickoff: null },
        { seats: traded(), chosen: null, kickoff: unrolled },
        { seats: seats(), chosen: null, kickoff: null },
      ];
      for (const one of cases) {
        for (const flags of [
          { aram: false, rated: true },
          { aram: false, rated: false },
          { aram: true, rated: false },
        ]) {
          for (const fallback of [null, 0.33]) {
            const played = playedOddsOf({ ...flags, ...one, fallback });
            const receipt = gameReceiptOf({
              ...flags,
              seats: one.seats,
              splits: one.chosen === null ? [] : [{ ...one.chosen, isChosen: true }],
              kickoff: one.kickoff,
            });
            expect(played.blueWinProb).toBe(receiptBlueWinProb(receipt, fallback));
          }
        }
      }
    });
  });

  describe('foldBlueWinProb', () => {
    const rows = (blueP: number | null, rAfter: number | null = 1200): FoldedRow[] => [
      ...BLUE.map(() => ({ side: 100, rAfter, foldP: blueP })),
      ...RED.map(() => ({ side: 200, rAfter, foldP: blueP === null ? null : 1 - blueP })),
    ];
    it("blue's fold_p when all ten were folded with one, else null", () => {
      expect(foldBlueWinProb(rows(0.3))).toBe(0.3);
      expect(foldBlueWinProb(rows(null))).toBeNull();
      expect(foldBlueWinProb(rows(0.3, null))).toBeNull();
      expect(foldBlueWinProb(rows(0.3).slice(1))).toBeNull();
    });
  });

  describe('rolledOddsOf', () => {
    it("is the bot's claim for its own teams only", () => {
      expect(rolledOddsOf(chosen(0.62), seats())).toBe(0.62);
      expect(rolledOddsOf(chosen(0.62), seats(RED, BLUE))).toBeCloseTo(0.38, 10);
      expect(rolledOddsOf(chosen(0.62), traded())).toBeNull();
    });
  });

  describe('splitRolesFor', () => {
    it('gives the split lanes to a team on either side, none to a changed side', () => {
      const roles = splitRolesFor(chosen(), seats(RED, BLUE));
      expect(roles.get('r1')).toBe('top');
      expect(roles.get('b5')).toBe('support');
      const changed = splitRolesFor(chosen(), traded());
      expect(changed.size).toBe(0);
      expect(splitRolesFor(null, seats()).size).toBe(0);
    });

    it('keeps the lanes of the team that stayed when only the other side changed', () => {
      const oneSide = seats(BLUE, ['r1', 'r2', 'r3', 'r4', 'x5']);
      const roles = splitRolesFor(chosen(), oneSide);
      expect([...roles.keys()].sort()).toEqual([...BLUE].sort());
    });
  });

  describe('calibrationGameOf', () => {
    const candidate = (seatsOf: ReceiptSeat[], winningSide: 100 | 200 = 100): CalibrationCandidate => ({
      aram: false,
      winningSide,
      rated: true,
      seats: seatsOf,
      chosen: { ...split(1, { blueWinProb: 0.62 }), oddsModel: 'kustom' },
    });

    it('counts swapped sides with the odds flipped, and never the changed-teams game', () => {
      const flipped = calibrationGameOf(candidate(seats(RED, BLUE)));
      expect(flipped?.blueWinProb).toBeCloseTo(0.38, 10);
      expect(flipped?.blueWon).toBe(true);
      expect(calibrationGameOf(candidate(traded()))).toBeNull();
    });
  });
});
