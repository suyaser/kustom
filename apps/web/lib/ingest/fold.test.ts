import { config, type Rating, rateGame } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { countedGames } from '../stats/fold';
import { statsGame, tenPlayerGame } from '../testing/statsFixtures';
import {
  type FoldPlayer,
  type FoldRatedPlayer,
  foldGame,
  gameAward,
  gateGame,
  gateRatedGame,
  isRatedMode,
} from './fold';

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

/**
 * The MVP / ACE bonus inside the fold (M7.9).
 *
 * Everything here goes in through `gateRatedGame`, the way both real callers do, so the arrays
 * `foldGame` reads are the arrays the live fold and the rebuild read: sorted by puuid, five a
 * side, carrying the stat line off `game_players`.
 */
describe('foldGame and the MVP / ACE bonus', () => {
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  /** Ten rated rows: five a side, every role once a side, a different stat line each. */
  function tenRated(): FoldRatedPlayer[] {
    return Array.from({ length: 10 }, (_, index) => ({
      playerId: `p${index}`,
      // Deliberately not in sorted order, so the gate's sort is part of what is tested.
      puuid: `u${9 - index}`,
      side: index < 5 ? (100 as const) : (200 as const),
      role: ROLES[index % 5] ?? null,
      kills: index,
      deaths: 10 - index,
      assists: index * 2,
      damageToChamps: 20_000 + index * 2_500,
      gold: 10_000 + index * 250,
      cs: 150 + index * 3,
      visionScore: 20 + index,
      damageSelfMitigated: 8_000 + index * 400,
      damageToObjectives: 3_000 + index * 600,
    }));
  }

  /** Ten different ratings, so a swapped player would show up as a different answer. */
  function ratingsBefore(players: readonly FoldRatedPlayer[]): Map<string, Rating> {
    return new Map(
      players.map((player, index) => [player.playerId, { mu: 25 + index * 0.5, sigma: 8 - index * 0.2 }]),
    );
  }

  /** The gate both callers go through, and the two arrays it hands the fold. */
  function gated(players: readonly FoldRatedPlayer[]) {
    const gate = gateRatedGame(players, 1_800, raw('CLASSIC'));
    if (!gate.ok) throw new Error(`expected a rated gate, got ${gate.reason}`);
    return gate;
  }

  /** What `rateGame` alone says, keyed by player id: the answer before M7.9 existed. */
  function unadjusted(
    blue: readonly FoldRatedPlayer[],
    red: readonly FoldRatedPlayer[],
    ratings: ReadonlyMap<string, Rating>,
  ): Map<string, Rating> {
    const rated = rateGame(
      blue.map((player) => ratings.get(player.playerId) as Rating),
      red.map((player) => ratings.get(player.playerId) as Rating),
      100,
    );
    const out = new Map<string, Rating>();
    blue.forEach((player, index) => {
      out.set(player.playerId, rated.blue[index] as Rating);
    });
    red.forEach((player, index) => {
      out.set(player.playerId, rated.red[index] as Rating);
    });
    return out;
  }

  it('amplifies exactly one winner and reduces exactly one loser, and leaves eight alone', () => {
    const players = tenRated();
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);

    const award = gameAward([...blue, ...red], 100);
    if (award === null) throw new Error('expected a game with every component to have an MVP');

    const plain = unadjusted(blue, red, ratings);
    const after = foldGame(blue, red, ratings, 100);

    // The MVP is on the winning side and the ACE on the losing one, and they are two people.
    const sideOf = new Map(players.map((player) => [player.puuid, player.side]));
    expect(sideOf.get(award.mvp)).toBe(100);
    expect(sideOf.get(award.ace)).toBe(200);
    expect(award.mvp).not.toBe(award.ace);

    const moved: string[] = [];
    for (const player of players) {
      const was = ratings.get(player.playerId) as Rating;
      const base = plain.get(player.playerId) as Rating;
      const now = after.get(player.playerId) as Rating;
      // `sigma` is never touched by the bonus, for anybody (M7.8).
      expect(now.sigma).toBe(base.sigma);

      const factor =
        player.puuid === award.mvp
          ? 1 + config.rating.mvp.bonusFraction
          : player.puuid === award.ace
            ? 1 - config.rating.mvp.aceReliefFraction
            : null;
      if (factor === null) {
        expect(now.mu).toBe(base.mu);
      } else {
        expect(now.mu).toBe(was.mu + (base.mu - was.mu) * factor);
        moved.push(player.puuid);
      }
    }
    // Two moved, eight untouched.
    expect(moved.sort()).toEqual([award.ace, award.mvp].sort());
  });

  it('keeps the MVP’s gain bigger and the ACE’s loss smaller than the plain fold', () => {
    const players = tenRated();
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);
    const award = gameAward([...blue, ...red], 100) as { mvp: string; ace: string };

    const plain = unadjusted(blue, red, ratings);
    const after = foldGame(blue, red, ratings, 100);
    const idOf = new Map(players.map((player) => [player.puuid, player.playerId]));

    const mvpId = idOf.get(award.mvp) as string;
    const aceId = idOf.get(award.ace) as string;
    const mu = (map: Map<string, Rating>, id: string) => (map.get(id) as Rating).mu;

    // The winner gained more than they would have; the loser gave back less. Neither sign flips.
    expect(mu(after, mvpId) - mu(ratings, mvpId)).toBeGreaterThan(mu(plain, mvpId) - mu(ratings, mvpId));
    expect(mu(plain, mvpId) - mu(ratings, mvpId)).toBeGreaterThan(0);
    expect(mu(after, aceId) - mu(ratings, aceId)).toBeGreaterThan(mu(plain, aceId) - mu(ratings, aceId));
    expect(mu(after, aceId) - mu(ratings, aceId)).toBeLessThan(0);
  });

  /**
   * Acceptance 1: a game with a null in any required column rates **digit for digit** as it did
   * before M7.9. The rule is core's and is per game, never per player — one missing number on
   * one row takes the MVP off the whole game — so this walks every column that can be null.
   */
  it('rates a game with a missing column exactly as rateGame alone does', () => {
    const holes: { what: string; hole: (player: FoldRatedPlayer) => FoldRatedPlayer }[] = [
      { what: 'vision score', hole: (player) => ({ ...player, visionScore: null }) },
      { what: 'damage self mitigated', hole: (player) => ({ ...player, damageSelfMitigated: null }) },
      { what: 'damage to objectives', hole: (player) => ({ ...player, damageToObjectives: null }) },
      { what: 'the role', hole: (player) => ({ ...player, role: null }) },
      { what: 'cs', hole: (player) => ({ ...player, cs: null }) },
    ];

    for (const { what, hole } of holes) {
      // The hole is on one player of ten, and on the *losing* side, where nothing about the
      // winner's own numbers changed: the game still has no MVP.
      const players = tenRated().map((player, index) => (index === 7 ? hole(player) : player));
      const ratings = ratingsBefore(players);
      const { blue, red } = gated(players);

      expect(gameAward([...blue, ...red], 100), what).toBeNull();

      const plain = unadjusted(blue, red, ratings);
      const after = foldGame(blue, red, ratings, 100);
      for (const player of players) {
        expect([what, after.get(player.playerId)]).toEqual([what, plain.get(player.playerId)]);
      }
    }
  });

  it('rates a backfilled game — ten null roles — exactly as rateGame alone does', () => {
    const players = tenRated().map((player) => ({ ...player, role: null }));
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);

    expect(gameAward([...blue, ...red], 100)).toBeNull();
    expect(foldGame(blue, red, ratings, 100)).toEqual(unadjusted(blue, red, ratings));
  });

  it('gives the losing side’s winner the same answer whichever side won', () => {
    // The award follows the result, not the colour: flip the winner and the two titles swap
    // sides, with nothing else about the ten rows changing.
    const players = tenRated();
    const { blue, red } = gated(players);
    const blueWon = gameAward([...blue, ...red], 100) as { mvp: string; ace: string };
    const redWon = gameAward([...blue, ...red], 200) as { mvp: string; ace: string };
    expect([redWon.mvp, redWon.ace]).toEqual([blueWon.ace, blueWon.mvp]);
  });
});
