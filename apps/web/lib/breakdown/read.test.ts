import { rateGameKustom, winProbability } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  BREAKDOWN_COLUMNS,
  type BreakdownGame,
  type BreakdownRow,
  ratingBlueWinProb,
  resultOdds,
  rowReason,
  toBreakdownRow,
} from './read';

/**
 * The breakdown read (M14.58 / M14.59, Kustom since M18.6): rows the fold stored in, core's
 * `explainKustomDelta` parts out, on either track, and never an OpenSkill column.
 */

const BLUE = ['b1', 'b2', 'b3', 'b4', 'b5'];
const RED = ['r1', 'r2', 'r3', 'r4', 'r5'];

/**
 * One game as the fold stores it: `rateGameKustom` over the ten on each track, red winning, with
 * scores so every seat has a share rank. All-time: settled players around 1300 (K 16). Weekly:
 * everyone's first game of the week (1200, K 32).
 */
function storedGame(): BreakdownGame {
  const scores = new Map([...BLUE, ...RED].map((puuid, i) => [puuid, 10 - (i % 5)]));
  const allTime = rateGameKustom({
    players: [
      ...BLUE.map((puuid, i) => ({
        puuid,
        side: 100 as const,
        r: 1280 + i,
        n: 20,
        score: scores.get(puuid) ?? null,
      })),
      ...RED.map((puuid, i) => ({
        puuid,
        side: 200 as const,
        r: 1300 + i,
        n: 20,
        score: scores.get(puuid) ?? null,
      })),
    ],
    winningSide: 200,
  });
  const week = rateGameKustom({
    players: [...BLUE, ...RED].map((puuid) => ({
      puuid,
      side: (BLUE.includes(puuid) ? 100 : 200) as 100 | 200,
      r: 1200,
      n: 0,
      score: scores.get(puuid) ?? null,
    })),
    winningSide: 200,
  });
  const weekOf = new Map(week.map((row) => [row.puuid, row]));
  const rows: BreakdownRow[] = allTime.map((row) => {
    const w = weekOf.get(row.puuid);
    if (w === undefined) throw new Error('unreachable');
    return {
      playerId: row.puuid,
      side: row.side,
      rBefore: row.rBefore,
      rAfter: row.rAfter,
      k: row.k,
      foldP: row.expected,
      ratedGamesBefore: 20,
      shareRank: row.shareRank,
      award: row.award,
      weekRBefore: w.rBefore,
      weekRAfter: w.rAfter,
      weekK: w.k,
      weekFoldP: w.expected,
      weekGamesBefore: 0,
    };
  });
  return { winningSide: 200, botBlueWinProb: 0.43, botOddsModel: 'openskill', rows };
}

describe('rowReason (M18.6)', () => {
  it('explains the all-time change from the stored row: odds, K, share and award', () => {
    const game = storedGame();
    const reason = rowReason(game, 'r1');
    const bluePct = Math.round(winProbability(1280 * 5 + 10, 1300 * 5 + 10) * 100);
    expect(reason).toMatchObject({
      track: 'all-time',
      gamesBefore: 20,
      allTime: null,
      parts: {
        side: 200,
        result: 'win',
        expectedPct: 100 - bluePct,
        k: 16,
        firstTenGames: false,
        shareRank: 1,
        share: 1.2,
        award: 'mvp',
      },
    });
    const row = game.rows.find((one) => one.playerId === 'r1') as BreakdownRow;
    expect(reason?.parts.points).toBe(Math.round(row.rAfter as number) - Math.round(row.rBefore as number));
  });

  it('explains the weekly change on the week track, with the all-time change as its clause', () => {
    const game = storedGame();
    const row = game.rows.find((one) => one.playerId === 'b1') as BreakdownRow;
    const reason = rowReason(game, 'b1', 'week');
    expect(reason).toMatchObject({
      track: 'week',
      gamesBefore: 0,
      parts: {
        result: 'loss',
        expectedPct: 50,
        k: 32,
        firstTenGames: true,
        shareRank: 1,
        share: 0.8,
        award: 'ace',
      },
      allTime: {
        points: Math.round(row.rAfter as number) - Math.round(row.rBefore as number),
        rating: Math.round(row.rAfter as number),
      },
    });
    expect(reason?.parts.points).toBe(Math.round(row.weekRAfter as number) - 1200);
  });

  it('is null for a row the track did not fold, and the all-time clause is null on a weekly-only row', () => {
    const game = storedGame();
    const weeklyOnly: BreakdownGame = {
      ...game,
      rows: game.rows.map((row) => ({
        ...row,
        rBefore: null,
        rAfter: null,
        k: null,
        foldP: null,
        ratedGamesBefore: null,
      })),
    };
    expect(rowReason(weeklyOnly, 'r1')).toBeNull();
    expect(rowReason(weeklyOnly, 'r1', 'week')?.allTime).toBeNull();
    expect(rowReason(game, 'nobody')).toBeNull();
  });

  it('a game with no performance score: share 1 and no award, whatever the award column says', () => {
    const game = storedGame();
    const unscored: BreakdownGame = {
      ...game,
      rows: game.rows.map((row) => ({ ...row, shareRank: null, award: 'none' })),
    };
    expect(rowReason(unscored, 'r1')?.parts).toMatchObject({ shareRank: null, share: 1, award: 'none' });
  });

  it('logs and leaves unexplained a stored row core refuses', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const game = storedGame();
    const broken: BreakdownGame = { ...game, rows: game.rows.map((row) => ({ ...row, shareRank: 9 })) };
    expect(rowReason(broken, 'r1')).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('resultOdds (M14.59, M18.6)', () => {
  it('reads the rating number off the stored fold_p of the blue rows', () => {
    const game = storedGame();
    const p = ratingBlueWinProb(game.rows);
    expect(p).toBe(game.rows.find((row) => row.side === 100)?.foldP);
    expect(resultOdds(game)).toMatchObject({
      botBluePct: 43,
      ratingBluePct: Math.round((p as number) * 100),
      pointsBluePct: Math.round((p as number) * 100),
    });
  });

  it('names both only on an OpenSkill roll whose percent differs (a game rolled before the switch)', () => {
    const game = storedGame();
    const rating = Math.round((ratingBlueWinProb(game.rows) as number) * 100);
    expect(resultOdds({ ...game, botBlueWinProb: 0.2 })?.differ).toBe(rating !== 20);
    expect(resultOdds({ ...game, botBlueWinProb: 0.2, botOddsModel: 'kustom' })?.differ).toBe(false);
    expect(resultOdds({ ...game, botBlueWinProb: rating / 100 })?.differ).toBe(false);
  });

  it('uses the bot number when the fold has none, and is null with neither', () => {
    const game = storedGame();
    const unfolded: BreakdownGame = {
      ...game,
      rows: game.rows.map((row) => ({ ...row, rAfter: null, foldP: null })),
    };
    expect(resultOdds(unfolded)).toMatchObject({ ratingBluePct: null, pointsBluePct: 43, differ: false });
    expect(resultOdds({ ...unfolded, botBlueWinProb: null })).toBeNull();
  });
});

describe('the columns', () => {
  it('reads no OpenSkill column', () => {
    expect(BREAKDOWN_COLUMNS).not.toMatch(/mu_|sigma|base_mu/);
  });

  it('maps a raw row, an absent column as null', () => {
    const row = toBreakdownRow({ player_id: 'p', side: 200 } as Parameters<typeof toBreakdownRow>[0]);
    expect(row).toMatchObject({ playerId: 'p', side: 200, rAfter: null, shareRank: null, weekRAfter: null });
  });
});
