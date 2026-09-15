import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Rating, rateGameWeekly, seedFromRank } from '@customs/core';
import { describe, expect, it, vi } from 'vitest';
import { foldWeeklyRatings, isWeekWindow, type WeeklyGame } from './weekly';

/**
 * The weekly fold (M7.3), on its own: seeds in, one week's games in, a rating per player out.
 *
 * Everything with a database behind it is `app/weekBoard.integration.test.ts`; this file is the
 * three rules the fold is made of — the order, the seed, and what it does with a game it cannot
 * read — plus the two windows it applies to.
 */

const SEED: Rating = seedFromRank('GOLD', 'IV');
const TEN = Array.from({ length: 10 }, (_, index) => `p${index}`);
const seeds = (): Map<string, Rating> => new Map(TEN.map((id) => [id, SEED]));

function game(overrides: Partial<WeeklyGame> = {}): WeeklyGame {
  return {
    gameId: 'game-1',
    startedAt: '2026-03-09T19:00:00Z',
    lcuGameId: 1,
    winningSide: 100,
    players: TEN.map((id, seat) => ({ playerId: id, puuid: `puuid-${id}`, side: seat < 5 ? 100 : 200 })),
    ...overrides,
  };
}

describe('isWeekWindow', () => {
  it('is the two week windows and nothing else', () => {
    expect(isWeekWindow('this-week')).toBe(true);
    expect(isWeekWindow('last-week')).toBe(true);
    // The month windows keep the all-time number for ever (user, 2026-09-15): this predicate
    // is a list of two on purpose, not a window length.
    expect(isWeekWindow('this-month')).toBe(false);
    expect(isWeekWindow('last-month')).toBe(false);
    expect(isWeekWindow('all-time')).toBe(false);
  });
});

describe('the weekly fold', () => {
  it('is every player at their seed when the week has no games', () => {
    const folded = foldWeeklyRatings([], seeds());

    expect([...folded.keys()].sort()).toEqual([...TEN].sort());
    for (const held of folded.values()) {
      expect(held.rating).toEqual(SEED);
      expect(held.seed).toEqual(SEED);
      expect(held.games).toEqual([]);
    }
  });

  it('is `rateGameWeekly` applied to the seeds, and keeps the seed beside the answer', () => {
    const folded = foldWeeklyRatings([game()], seeds());
    const expected = rateGameWeekly(Array(5).fill(SEED), Array(5).fill(SEED), 100);

    expect(folded.get('p0')?.rating).toEqual(expected.blue[0]);
    expect(folded.get('p9')?.rating).toEqual(expected.red[0]);
    // The seed is carried, not recomputed: the row's climb is seed → end.
    expect(folded.get('p0')?.seed).toEqual(SEED);
    // And one step, for the row's expand.
    expect(folded.get('p0')?.games).toEqual([
      { gameId: 'game-1', muBefore: SEED.mu, muAfter: (expected.blue[0] as Rating).mu },
    ]);
  });

  /**
   * **`started_at`, then `lcu_game_id`** — the rebuild's order (M5.2), so a week and a history
   * folded from the same games tell the same story. The games are handed over newest first here
   * (the order the loader's own select returns them in) and the answer must be the ordered one.
   */
  it('folds in started_at then lcu_game_id order, whatever order it is given them in', () => {
    const first = game({ gameId: 'a', startedAt: '2026-03-09T19:00:00Z', lcuGameId: 1, winningSide: 100 });
    const second = game({ gameId: 'b', startedAt: '2026-03-09T19:00:00Z', lcuGameId: 2, winningSide: 200 });
    const third = game({ gameId: 'c', startedAt: '2026-03-10T19:00:00Z', lcuGameId: 3, winningSide: 100 });

    const ordered = foldWeeklyRatings([first, second, third], seeds());
    const shuffled = foldWeeklyRatings([third, second, first], seeds());

    expect(shuffled.get('p0')?.rating).toEqual(ordered.get('p0')?.rating);
    expect(shuffled.get('p0')?.games.map((played) => played.gameId)).toEqual(['a', 'b', 'c']);
    // A different order really would be a different number: the same three games with the tie
    // broken the other way do not land on the same rating.
    const reversedTie = foldWeeklyRatings(
      [{ ...first, lcuGameId: 2 }, { ...second, lcuGameId: 1 }, third],
      seeds(),
    );
    expect(reversedTie.get('p0')?.games.map((played) => played.gameId)).toEqual(['b', 'a', 'c']);
  });

  it('chains each game from the one before it', () => {
    const folded = foldWeeklyRatings(
      [game({ gameId: 'a', lcuGameId: 1 }), game({ gameId: 'b', lcuGameId: 2, winningSide: 200 })],
      seeds(),
    );
    const played = folded.get('p0')?.games ?? [];

    expect(played).toHaveLength(2);
    expect(played[0]?.muBefore).toBe(SEED.mu);
    expect(played[1]?.muBefore).toBe(played[0]?.muAfter);
    expect(folded.get('p0')?.rating.mu).toBe(played[1]?.muAfter);
  });

  /**
   * **A game it cannot read is skipped, loudly, and never thrown.** `rateGameWeekly` takes five
   * and five; the all-time fold already refused anything else, so this cannot come from the
   * pipeline — but a board that 500s over one odd row would be worse than a board that is one
   * game stale.
   */
  it('skips a game that is not five and five, and leaves everybody else folded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const odd = game({
      gameId: 'odd',
      lcuGameId: 1,
      players: TEN.slice(0, 9).map((id, seat) => ({
        playerId: id,
        puuid: `puuid-${id}`,
        side: seat < 5 ? 100 : 200,
      })),
    });

    const folded = foldWeeklyRatings([odd, game({ gameId: 'good', lcuGameId: 2 })], seeds());

    expect(folded.get('p0')?.games.map((played) => played.gameId)).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('odd');
    warn.mockRestore();
  });

  it('skips a game whose seat the board has no seed for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const short = new Map(seeds());
    short.delete('p9');

    const folded = foldWeeklyRatings([game()], short);

    expect(folded.get('p0')?.games).toEqual([]);
    expect(folded.get('p0')?.rating).toEqual(SEED);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /**
   * **The weekly track never forms teams** (M7.3's acceptance 4). The balancer, the live fold
   * and the rebuild all read the all-time rating, and a week folded at read time must not reach
   * them: the check is a grep, so here is the grep.
   */
  it('is imported by nothing under lib/ingest', () => {
    const ingest = join(import.meta.dirname, '..', 'ingest');
    const offenders = readdirSync(ingest)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => {
        const source = readFileSync(join(ingest, name), 'utf8');
        return /from\s+'[^']*board\/weekly'/.test(source) || source.includes('rateGameWeekly');
      });

    expect(offenders).toEqual([]);
  });

  /**
   * **No weekly settling constant of any name** (M7.3's acceptance 9, product 2026-09-15). A
   * week never claims to settle, so there is no second threshold and no second chip to hold
   * one, and the name product refused appears nowhere a grep can find it.
   */
  it('leaves no weekly settling threshold anywhere in the app', () => {
    const roots = ['app', 'lib', 'scripts'].map((dir) => join(import.meta.dirname, '..', '..', dir));
    const offenders: string[] = [];
    // Assembled rather than typed, so `grep -r` over the repo finds nothing — including this
    // file, which would otherwise be the one hit the acceptance check forbids.
    const needle = ['WEEKLY', 'SETTLING'].join('_');

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && readFileSync(path, 'utf8').includes(needle)) {
          offenders.push(path);
        }
      }
    };
    for (const root of roots) walk(root);

    expect(offenders).toEqual([]);
  });

  /** Nothing is stored and nothing is shared: two folds of the same week are the same numbers. */
  it('is a pure function of its arguments', () => {
    const once = foldWeeklyRatings([game()], seeds());
    const twice = foldWeeklyRatings([game()], seeds());

    expect([...twice].map(([id, held]) => [id, held.rating])).toEqual(
      [...once].map(([id, held]) => [id, held.rating]),
    );
  });
});
