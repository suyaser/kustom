import { displayRating, seedFromRank } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { favoredClause } from '../discord/embeds';
import { workedPlayer, workedRecentGame } from '../testing/boardFixtures';
import { rankLabel, UNRANKED_LABEL } from './copy';
import { explainGame, explainRatingStart, sideWinChance } from './explain';

/**
 * "How you got here" (M5.15): the two sentences that let somebody retrace their own rating.
 *
 * The rule this file exists to hold is acceptance check 6: **every number printed is
 * byte-identical to what `lib/ratingDisplay.ts` produces**, asserted by calling it rather than
 * by re-rounding here. A test that hard-codes `+43` passes on the day somebody changes the
 * delta rule and the page starts disagreeing with the Discord message about the same game.
 */

describe('the win chance, for the side the player was on', () => {
  it("is blue's own number on 100 and its complement on 200", () => {
    expect(sideWinChance(0.58, 100)).toBe(58);
    expect(sideWinChance(0.58, 200)).toBe(42);
  });

  it('rounds to whole percent, the same way the result card and the embed do', () => {
    expect(sideWinChance(0.4249, 100)).toBe(42);
    expect(sideWinChance(0.425, 100)).toBe(43);
  });

  /**
   * The half-percent case, which is the only one where "round red's own share" and "100 minus
   * blue's" disagree. The embed is the tie-breaker: it prints `100 - round(p × 100)`, so this
   * does too, and the two halves always add to 100 (the reviewer, 2026-09-10).
   */
  it('is 100 minus blue on the other side, so the page and the embed name one number', () => {
    expect(sideWinChance(0.425, 200)).toBe(57);
    expect(favoredClause(0.425)).toBe('Red was favored 57%.');
    for (const probability of [0.425, 0.58, 0.5, 0.005]) {
      expect((sideWinChance(probability, 100) ?? 0) + (sideWinChance(probability, 200) ?? 0)).toBe(100);
    }
  });

  it('is nothing at all when no split was stored, rather than 50', () => {
    expect(sideWinChance(null, 100)).toBeNull();
    expect(sideWinChance(null, 200)).toBeNull();
  });
});

describe('one row of Recent games', () => {
  /**
   * **The clause and nothing else** (product and the designer, 2026-09-10): the row's head
   * already prints `Won`, the date and `1392 (−42)`, and a caption that repeated them would
   * say three of the four things on the line twice.
   */
  it("is the chance their own side was given, in product's exact words", () => {
    // Won on red, where the split gave blue 58%: their own side was the 42% one.
    const game = workedRecentGame({ won: true, side: 200, blueWinProb: 0.58, muBefore: 23.2, muAfter: 23.9 });

    expect(explainGame(game)).toBe('As the 42% side.');
  });

  it('says the same thing about the favourite that lost, without repeating the result', () => {
    const game = workedRecentGame({ won: false, side: 100, blueWinProb: 0.58 });

    expect(explainGame(game)).toBe('As the 58% side.');
    // No `Won`, no `Lost`, no delta: they are the row, not the caption.
    expect(explainGame(game)).not.toMatch(/Won|Lost|[+−]/);
  });

  it('is nothing at all for a backfilled game: no chance, and no line repeating the row', () => {
    const game = workedRecentGame({ won: true, blueWinProb: null, muBefore: 23.2, muAfter: 23.9 });

    expect(explainGame(game)).toBeNull();
  });

  it('says nothing at all about an unrated game: M3.23 owns that row whole', () => {
    expect(explainGame(workedRecentGame({ muBefore: null, muAfter: null, blueWinProb: 0.6 }))).toBeNull();
    // A half-folded row is not a rating either.
    expect(explainGame(workedRecentGame({ muBefore: 23.9, muAfter: null }))).toBeNull();
  });
});

describe('the seed line', () => {
  it('names the displayed seed and the games since', () => {
    const player = workedPlayer();

    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}, 37 games since.`);
  });

  /**
   * **The rank clause is gone, not softened** (M7.19, product 2026-09-16). Every rating starts at
   * `provisionalSeed()` now, the same number for everybody, so a tier on the one line that
   * explains where a rating came from would be read as the reason for it whatever the preposition
   * did. The fixture is still seeded `Silver II` — `player.seedRank` is loaded and simply has no
   * reader here — which is exactly why this guard asserts on the rendered sentence.
   */
  it('never names a League rank, and never says `Seeded`', () => {
    const player = workedPlayer();

    expect(player.seedRank).toBe('Silver II');
    const line = explainRatingStart(player) ?? '';
    expect(line).not.toContain('Silver');
    expect(line).not.toContain('Seeded');
    expect(line).not.toMatch(/rank/i);
  });

  it('is drawn from the same number the chart draws its hairline at', () => {
    const player = workedPlayer();

    expect(player.reference).toBe(displayRating(seedFromRank('SILVER', 'II').mu));
    expect(explainRatingStart(player)).toContain(String(player.reference));
  });

  it('is the whole page for a player with no games, and never says `0 games`', () => {
    const player = workedPlayer('Hana', { games: 0, wins: 0, losses: 0, history: [], recent: [] });

    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}.`);
    expect(explainRatingStart(player)).not.toMatch(/\b0\b games/);
    expect(explainRatingStart(player)).not.toContain('NaN');
  });

  it('says one game, not `1 games`, for somebody one night in', () => {
    const player = workedPlayer('Hana', { games: 1 });

    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}, 1 game since.`);
  });

  it('becomes `Started the week` in a week window and `the month` in a month one', () => {
    const week = workedPlayer('Hana', { window: 'this-week', games: 6, reference: 1469 });
    const month = workedPlayer('Hana', { window: 'last-month', games: 14, reference: 1469 });

    expect(explainRatingStart(week)).toBe('Started the week at 1469, 6 games since.');
    expect(explainRatingStart(month)).toBe('Started the month at 1469, 14 games since.');
    // A window names its own calendar and never the whole history: `Started at 1469` would be
    // the all-time sentence, and the week's hairline is where Sunday found them, not a seed.
    expect(explainRatingStart(week)).toContain('the week');
    expect(explainRatingStart(week)).not.toBe('Started at 1469, 6 games since.');
  });

  it('says nothing in a window the player did not play: `reference` is only their seed there', () => {
    expect(
      explainRatingStart(workedPlayer('Hana', { window: 'last-week', games: 0, range: null })),
    ).toBeNull();
  });
});

describe('the rank, as words', () => {
  it('title-cases the tier and keeps the division numeral', () => {
    expect(rankLabel('GOLD', 'II')).toBe('Gold II');
    expect(rankLabel('emerald', 'iv')).toBe('Emerald IV');
  });

  it('drops the division for the three tiers that have none', () => {
    expect(rankLabel('MASTER', 'I')).toBe('Master');
    expect(rankLabel('GRANDMASTER', null)).toBe('Grandmaster');
    expect(rankLabel('CHALLENGER', 'I')).toBe('Challenger');
  });

  it('says `Unranked` for a rank the client never reported, and for one core cannot read', () => {
    expect(rankLabel(null, null)).toBe(UNRANKED_LABEL);
    expect(rankLabel('', '')).toBe(UNRANKED_LABEL);
    // The seed for this string is the unranked seed, so the words must be too.
    expect(rankLabel('WOOD', 'IX')).toBe(UNRANKED_LABEL);
  });
});
