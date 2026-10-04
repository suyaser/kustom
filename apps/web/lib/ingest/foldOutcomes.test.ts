import { config, displayRating, foldWinProbability, predictWin, type Rating } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { type FoldRatedPlayer, foldGame, foldGameOutcomes, gameAward, gateRatedGame } from './fold';

/**
 * M14.58 / M14.59: what the fold stores beside `mu_after` (`0034`): the odds it used for each side,
 * the base `mu_after` before the MVP/ACE bonus, and the award. The ratings themselves are pinned by
 * `fold.test.ts`; this pins the breakdown that explains them.
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

function tenRated(): FoldRatedPlayer[] {
  return Array.from({ length: 10 }, (_, index) => ({
    playerId: `p${index}`,
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

function ratingsBefore(players: readonly FoldRatedPlayer[]): Map<string, Rating> {
  return new Map(
    players.map((player, index) => [player.playerId, { mu: 25 + index * 0.5, sigma: 8 - index * 0.2 }]),
  );
}

function gated(players: readonly FoldRatedPlayer[]) {
  const gate = gateRatedGame(players, 1_800, { gameMode: 'CLASSIC' }, true);
  if (!gate.ok) throw new Error(`expected a rated gate, got ${gate.reason}`);
  return gate;
}

describe('foldGameOutcomes (0034)', () => {
  it('returns the same ratings foldGame does', () => {
    const players = tenRated();
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);
    const outcomes = foldGameOutcomes(blue, red, ratings, 100);
    const after = foldGame(blue, red, ratings, 100);
    for (const player of players) {
      expect(outcomes.get(player.playerId)?.after).toEqual(after.get(player.playerId));
    }
  });

  it('stores the side s odds from the exact befores: the balancer s predictWin, blue and 1 - blue', () => {
    const players = tenRated();
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);
    const outcomes = foldGameOutcomes(blue, red, ratings, 200);
    const blueBefore = blue.map((player) => ratings.get(player.playerId) as Rating);
    const redBefore = red.map((player) => ratings.get(player.playerId) as Rating);

    for (const player of blue) {
      expect(outcomes.get(player.playerId)?.foldP).toBe(predictWin(blueBefore, redBefore));
    }
    for (const player of red) {
      expect(outcomes.get(player.playerId)?.foldP).toBe(foldWinProbability(blueBefore, redBefore, 200));
      expect(outcomes.get(player.playerId)?.foldP).toBeCloseTo(1 - predictWin(blueBefore, redBefore), 15);
    }
  });

  /** Acceptance 2: base delta times the award multiplier is the stored delta, within a point. */
  it('names the MVP and the ACE and keeps the base mu_after, so base x multiplier = stored', () => {
    const players = tenRated();
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);
    const award = gameAward([...blue, ...red], 100);
    if (award === null) throw new Error('expected an MVP');
    const outcomes = foldGameOutcomes(blue, red, ratings, 100);

    for (const player of players) {
      const outcome = outcomes.get(player.playerId);
      if (outcome === undefined) throw new Error('missing outcome');
      const before = (ratings.get(player.playerId) as Rating).mu;
      const expected = player.puuid === award.mvp ? 'mvp' : player.puuid === award.ace ? 'ace' : 'none';
      expect(outcome.award).toBe(expected);
      if (expected === 'none') {
        expect(outcome.baseMuAfter).toBe(outcome.after.mu);
        continue;
      }
      const factor =
        expected === 'mvp' ? 1 + config.rating.mvp.bonusFraction : 1 - config.rating.mvp.aceReliefFraction;
      expect(outcome.after.mu).toBeCloseTo(before + (outcome.baseMuAfter - before) * factor, 12);
      const baseDelta = displayRating(outcome.baseMuAfter) - displayRating(before);
      const storedDelta = displayRating(outcome.after.mu) - displayRating(before);
      expect(Math.abs(baseDelta * factor - storedDelta)).toBeLessThanOrEqual(1);
    }
  });

  it('stores award none for everybody in a game nobody could be scored in (roles unknown)', () => {
    const players = tenRated().map((player) => ({ ...player, role: null }));
    const ratings = ratingsBefore(players);
    const { blue, red } = gated(players);
    for (const outcome of foldGameOutcomes(blue, red, ratings, 100).values()) {
      expect(outcome.award).toBe('none');
      expect(outcome.baseMuAfter).toBe(outcome.after.mu);
    }
  });
});
