import { displayRating, seedFromRank } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { favoredClause } from '../discord/embeds';
import type { WindowKind } from '../night';
import { workedPlayer, workedRecentGame } from '../testing/boardFixtures';
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
  it('names the displayed seed and the rated games since', () => {
    const player = workedPlayer();

    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}, 37 rated games since.`);
  });

  /**
   * **The count says which universe it counted** (M7.22, product 2026-09-16). `player.games` is
   * the rated count on every window, and this line sits directly above sections that count every
   * game played — so the clause carries the adjective rather than leaving the reader to guess.
   * Pinned against the retired wording, which is what the page said until 2026-09-16.
   */
  it('never says plain `games since` again, on any of the five windows', () => {
    const windows: readonly WindowKind[] = ['all-time', 'this-week', 'last-week', 'this-month', 'last-month'];

    for (const window of windows) {
      const line = explainRatingStart(workedPlayer('Hana', { window, games: 6, reference: 1469 })) ?? '';
      expect(line).toContain(', 6 rated games since.');
      expect(line).not.toContain(', 6 games since.');
    }
  });

  /**
   * **The rank clause is gone, not softened** (M7.19, product 2026-09-16). Every rating starts at
   * `provisionalSeed()` now, the same number for everybody, so a tier on the one line that
   * explains where a rating came from would be read as the reason for it whatever the preposition
   * did. The fixture's seed number is still Silver II's — the rank itself stopped being a field on
   * the view at all in M7.20 — which is why this guard asserts on the rendered sentence and on the
   * tier's own word, the one thing that would come back if somebody re-added the clause.
   */
  it('never names a League rank, and never says `Seeded`', () => {
    const player = workedPlayer();

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

  it('is the whole page for a player with no games, and never says `0 rated games`', () => {
    const player = workedPlayer('Hana', { games: 0, wins: 0, losses: 0, history: [], recent: [] });

    // M7.22 left this arm byte for byte: at zero the clause is dropped whole, not worded, so the
    // adjective never arrives attached to a zero either.
    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}.`);
    expect(explainRatingStart(player)).not.toMatch(/\b0\b (rated )?games/);
    expect(explainRatingStart(player)).not.toContain('rated');
    expect(explainRatingStart(player)).not.toContain('NaN');
  });

  it('says one rated game, not `1 rated games`, for somebody one night in', () => {
    const player = workedPlayer('Hana', { games: 1 });

    expect(explainRatingStart(player)).toBe(`Started at ${player.reference}, 1 rated game since.`);
    // And never `rated 1 game`: the adjective belongs to the noun, not to the count.
    expect(explainRatingStart(player)).not.toContain('rated 1 game');
  });

  it('becomes `Started the week` in a week window and `the month` in a month one', () => {
    const week = workedPlayer('Hana', { window: 'this-week', games: 6, reference: 1469 });
    const month = workedPlayer('Hana', { window: 'last-month', games: 14, reference: 1469 });

    expect(explainRatingStart(week)).toBe('Started the week at 1469, 6 rated games since.');
    expect(explainRatingStart(month)).toBe('Started the month at 1469, 14 rated games since.');
    // A window names its own calendar and never the whole history: `Started at 1469` would be
    // the all-time sentence, and the week's hairline is where Sunday found them, not a seed.
    expect(explainRatingStart(week)).toContain('the week');
    expect(explainRatingStart(week)).not.toBe('Started at 1469, 6 rated games since.');
  });

  it('says nothing in a window the player did not play: `reference` is only their seed there', () => {
    expect(
      explainRatingStart(workedPlayer('Hana', { window: 'last-week', games: 0, range: null })),
    ).toBeNull();
  });
});

/*
 * **`describe('the rank, as words')` is gone** (M7.20, 2026-09-16): seven cases over `rankLabel`,
 * deleted with the function they covered. They pinned the format of a string that M7.19 took off
 * the only sentence that printed it, so what they protected was a formatter with no surface. The
 * guard above — the rendered seed line names no tier and never says `Seeded` — is the one that
 * survives, because it is about what a player reads.
 */
