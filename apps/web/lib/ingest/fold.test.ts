import { describe, expect, it } from 'vitest';
import { countedGames } from '../stats/fold';
import { statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { type FoldPlayer, gateGame, gateRatedGame, isRatedMode } from './fold';

/**
 * The two gates (M7.1).
 *
 * `gateGame` answers "did a game happen that can be read?" and `gateRatedGame` answers "and may
 * it move the rating?". The whole point of this file is that those are different questions: an
 * ARAM custom passes the first and fails the second, and `/stats` and `/fun` read the first.
 */

/** Ten rows, five a side, with puuids that are deliberately not in sorted order. */
function ten(): FoldPlayer[] {
  return Array.from({ length: 10 }, (_, index) => ({
    playerId: `p${index}`,
    puuid: `u${9 - index}`,
    side: index < 5 ? (100 as const) : (200 as const),
  }));
}

/** A stored `games.raw` with a mode on it, the way the client writes one. */
function raw(gameMode: string | null): Record<string, unknown> {
  return gameMode === null ? { gameId: 1 } : { gameId: 1, gameMode };
}

describe('gateGame', () => {
  it('passes a ten-player custom over 300 seconds, whatever the mode is', () => {
    // No `raw` argument at all: the played gate cannot see a mode, which is what stops it
    // emptying `/fun?queue=aram`.
    expect(gateGame(ten(), 1_800).ok).toBe(true);
  });

  it('still refuses nine rows, a lopsided split, 300 seconds exactly and a duplicate player', () => {
    expect(gateGame(ten().slice(0, 9), 1_800)).toEqual({ ok: false, reason: 'participant-count' });
    const lopsided = ten().map((player, index) => ({
      ...player,
      side: index < 6 ? (100 as const) : (200 as const),
    }));
    expect(gateGame(lopsided, 1_800)).toEqual({ ok: false, reason: 'side-split' });
    expect(gateGame(ten(), 300)).toEqual({ ok: false, reason: 'duration' });
    const twice = ten();
    twice[9] = { ...(twice[9] as FoldPlayer), puuid: (twice[0] as FoldPlayer).puuid };
    expect(gateGame(twice, 1_800)).toEqual({ ok: false, reason: 'duplicate-player' });
  });

  it('sorts both sides by puuid', () => {
    const gate = gateGame(ten(), 1_800);
    if (!gate.ok) throw new Error('expected a passing gate');
    expect(gate.blue.map((player) => player.puuid)).toEqual(['u5', 'u6', 'u7', 'u8', 'u9']);
    expect(gate.red.map((player) => player.puuid)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4']);
  });
});

describe('isRatedMode', () => {
  it('is Summoner’s Rift and nothing else', () => {
    expect(isRatedMode(raw('CLASSIC'))).toBe(true);
    expect(isRatedMode(raw('classic'))).toBe(true);
    expect(isRatedMode(raw('ARAM'))).toBe(false);
    expect(isRatedMode(raw('aram'))).toBe(false);
    expect(isRatedMode(raw('KIWI'))).toBe(false);
    expect(isRatedMode(raw('URF'))).toBe(false);
    expect(isRatedMode(raw('NEXUSBLITZ'))).toBe(false);
  });

  it('treats a missing mode as Rift, because every night before the mode was read was one', () => {
    expect(isRatedMode(raw(null))).toBe(true);
    expect(isRatedMode({})).toBe(true);
    expect(isRatedMode(null)).toBe(true);
    expect(isRatedMode(undefined)).toBe(true);
    expect(isRatedMode({ gameMode: '' })).toBe(true);
    // Not an object, and not a crash: a blob shaped like nothing we know is old Rift too.
    expect(isRatedMode('CLASSIC')).toBe(true);
    expect(isRatedMode([{ gameMode: 'ARAM' }])).toBe(true);
    expect(isRatedMode({ gameMode: 12 })).toBe(true);
  });
});

describe('gateRatedGame', () => {
  it('rates a Rift custom, and one whose block named no mode', () => {
    expect(gateRatedGame(ten(), 1_800, raw('CLASSIC')).ok).toBe(true);
    expect(gateRatedGame(ten(), 1_800, raw(null)).ok).toBe(true);
    expect(gateRatedGame(ten(), 1_800, null).ok).toBe(true);
  });

  it('never rates an ARAM, however long it was', () => {
    expect(gateRatedGame(ten(), 1_800, raw('ARAM'))).toEqual({ ok: false, reason: 'game-mode' });
    expect(gateRatedGame(ten(), 4_000, raw('ARAM'))).toEqual({ ok: false, reason: 'game-mode' });
  });

  it('never rates a mode we have never seen', () => {
    for (const mode of ['KIWI', 'URF', 'NEXUSBLITZ', 'CLASIC']) {
      expect(gateRatedGame(ten(), 1_800, raw(mode))).toEqual({ ok: false, reason: 'game-mode' });
    }
  });

  it('reports the older reason first, so a nine-player ARAM is still participant-count', () => {
    // The skip counters in a rebuild report only grow a new column; nothing moves between the
    // four that were already there.
    expect(gateRatedGame(ten().slice(0, 9), 1_800, raw('ARAM'))).toEqual({
      ok: false,
      reason: 'participant-count',
    });
    expect(gateRatedGame(ten(), 300, raw('ARAM'))).toEqual({ ok: false, reason: 'duration' });
  });

  it('hands back exactly what gateGame did when it passes', () => {
    expect(gateRatedGame(ten(), 1_800, raw('CLASSIC'))).toEqual(gateGame(ten(), 1_800));
  });
});

/**
 * Acceptance 4: the mode check is beside `gateGame`, not inside it, so the universe `/stats`,
 * `/fun`, `/p/[puuid]` and the board's streak fold is the one it was before M7.1.
 */
describe('countedGames is unchanged', () => {
  const rift = tenPlayerGame({ at: '2026-09-14T20:00:00.000Z', blue: ['lena'] });
  const aram = tenPlayerGame({ at: '2026-09-14T21:00:00.000Z', blue: ['lena'], gameMode: 'ARAM' });
  const kiwi = tenPlayerGame({ at: '2026-09-14T22:00:00.000Z', blue: ['lena'], gameMode: 'KIWI' });
  const remake = tenPlayerGame({ at: '2026-09-14T23:00:00.000Z', blue: ['lena'], durationS: 200 });
  const shortHanded = statsGame({
    at: '2026-09-15T00:00:00.000Z',
    blue: ['lena', 'f1', 'f2', 'f3'],
    red: ['f4', 'f5', 'f6', 'f7', 'f8'],
  });

  it('counts a window holding both maps, and still drops what it always dropped', () => {
    const counted = countedGames([rift, aram, kiwi, remake, shortHanded]);
    expect(counted.map((game) => game.id)).toEqual([rift.id, aram.id, kiwi.id]);
  });

  it('counts an ARAM night on its own, which is what /fun?queue=aram folds', () => {
    // The page folds `countedGames` and *then* filters to ARAM. An empty answer here would be
    // an empty page.
    expect(countedGames([aram]).map((game) => game.id)).toEqual([aram.id]);
  });
});
