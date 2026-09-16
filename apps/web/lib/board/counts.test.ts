import { describe, expect, it } from 'vitest';
import { gateRatedGame } from '../ingest/fold';
import { countedGames } from '../stats/fold';
import { playerStatsView } from '../stats/player';
import type { StatsGame } from '../stats/types';
import { statsView } from '../stats/view';
import { puuidOf, rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import { boardSlotLine, gamesLabel, PLAYER_COUNTS_SENTENCE, ratedGamesLabel, windowSlotLine } from './copy';

/**
 * **One window, two counts, and every page says which** (M7.18, product 2026-09-16).
 *
 * `/leaderboard` counts the games that moved a rating and `/stats` counts the games the group
 * played. Since M7.1 those are different numbers — they differ by every ARAM in the window — and
 * until this task they printed under the same dates, one tab apart, with nothing saying which was
 * which. **Both counts are right.** The fix is a word beside each, not a merge, so this file pins
 * two things at once: the words, and the fact that neither number moved.
 */

/** Wednesday's month, the window every fixture below is read through. */
const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };
const ZONE = 'Africa/Cairo';

/**
 * A month the two counts disagree about: three Rift customs the fold rated, one ARAM it stored
 * and refused (M7.1), and one three-minute remake that is in neither universe.
 *
 * The ARAM is `unrated` because that is what it is in the database: `gateRatedGame` turns it
 * down, so every `mu_after` on its ten rows is null — which is exactly the column the board's
 * count reads.
 */
function month(): StatsGame[] {
  return [
    tenPlayerGame({ at: '2026-09-01T18:00:00Z', blue: ['hana'] }),
    tenPlayerGame({ at: '2026-09-02T18:00:00Z', blue: ['hana'], winner: 200 }),
    tenPlayerGame({ at: '2026-09-03T18:00:00Z', blue: ['hana'] }),
    tenPlayerGame({ at: '2026-09-04T18:00:00Z', blue: ['hana'], gameMode: 'ARAM', unrated: true }),
    // The remake is `unrated` for the same reason: the fold refused it, so nothing wrote a
    // `mu_after` on any of its ten rows either.
    tenPlayerGame({ at: '2026-09-05T18:00:00Z', blue: ['hana'], durationS: 200, unrated: true }),
  ];
}

/**
 * The board's count, expressed the way `lib/board/load.ts` asks the database for it: **games with
 * a rated scoreboard row**, `not('game_players.mu_after', 'is', null)`.
 *
 * Written out here rather than imported because the loader's is a PostgREST query and this file
 * takes no client. If the two ever part, the integration test that reads a real window is where
 * it shows — what this pins is the *number*, so that M7.18's word cannot arrive beside a count
 * that quietly changed with it.
 */
function boardGames(games: readonly StatsGame[]): number {
  return games.filter((game) => game.rows.some((row) => row.muAfter !== null)).length;
}

describe('the two counts still count what they counted', () => {
  it('is the two gates, and they answer two different questions', () => {
    const [rift, , , aram, remake] = month();
    const gate = (game: StatsGame) =>
      gateRatedGame(
        game.rows.map((row) => ({ playerId: row.playerId, puuid: row.puuid, side: row.side })),
        game.durationS,
        { gameMode: game.gameMode },
      );

    expect(gate(rift as StatsGame).ok).toBe(true);
    // The one game that is played and never rated, which is the whole reason the two numbers
    // differ and therefore the whole reason they are named.
    expect(gate(aram as StatsGame)).toEqual({ ok: false, reason: 'game-mode' });
    expect(gate(remake as StatsGame)).toEqual({ ok: false, reason: 'duration' });
  });

  /**
   * The numbers, pinned against what they are today. **This task may not change one**: it prints
   * words next to counts that already exist, and a diff that moved any of the three below is a
   * diff that went wrong.
   */
  it('pins the board, /stats and the player page over one fixture window', () => {
    const games = month();
    const players = rosterFor(games);
    const input = { games, players, range: MONTH, capped: false, cap: 2_000, timeZone: ZONE };

    // `/leaderboard`: the games that moved a rating. Three.
    expect(boardGames(games)).toBe(3);
    // `/stats`: the games the group played, ARAM included, remake excluded. Four.
    expect(statsView({ window: 'this-month', ...input }).games).toBe(4);
    expect(countedGames(games)).toHaveLength(4);
    // `/p/[puuid]`'s sections under the chart read the same universe `/stats` does.
    expect(playerStatsView({ window: 'this-month', puuid: puuidOf('hana'), ...input }).games).toBe(4);
    // Her record in the header is the rated one — the three games that moved her number.
    expect(games.filter((game) => game.rows.some((row) => row.muAfter !== null))).toHaveLength(3);
  });

  /**
   * And the two slot lines over that same window: one set of dates, two counts, two words. The
   * pages are not lying to each other — they are answering two questions, out loud.
   */
  it('prints both counts under the same dates, each saying what it counted', () => {
    const games = month();
    const range = 'September';

    expect(boardSlotLine(range, boardGames(games))).toBe('September · 3 rated games');
    expect(windowSlotLine(range, countedGames(games).length)).toBe('September · 4 games');
  });
});

describe('boardSlotLine', () => {
  /** Product's string, on all five windows, by code point (acceptance 1). */
  it('names the range and the rated count on every window', () => {
    expect(boardSlotLine('Sunday 13 Sep to Saturday 19 Sep', 12)).toBe(
      'Sunday 13 Sep to Saturday 19 Sep · 12 rated games',
    );
    expect(boardSlotLine('Sunday 6 Sep to Saturday 12 Sep', 14)).toBe(
      'Sunday 6 Sep to Saturday 12 Sep · 14 rated games',
    );
    expect(boardSlotLine('September', 34)).toBe('September · 34 rated games');
    expect(boardSlotLine('August', 41)).toBe('August · 41 rated games');
    expect(boardSlotLine('Since 8 Sep 2025', 312)).toBe('Since 8 Sep 2025 · 312 rated games');
  });

  it('never reads `1 rated games`, and never `rated 1 game`', () => {
    expect(ratedGamesLabel(1)).toBe('1 rated game');
    expect(boardSlotLine('Sunday 13 Sep to Saturday 19 Sep', 1)).toBe(
      'Sunday 13 Sep to Saturday 19 Sep · 1 rated game',
    );
    expect(ratedGamesLabel(12)).toBe('12 rated games');
    expect(ratedGamesLabel(0)).toBe('0 rated games');
  });

  /**
   * **The word is not conditional.** A window with no ARAM in it has two equal counts and still
   * says what each of them counted: a label that appeared only when the numbers differed would
   * teach nobody anything and would read as an error on the day it showed up.
   */
  it('says `rated` on a window whose two counts are equal', () => {
    expect(boardSlotLine('September', 34)).toContain('rated');
    expect(windowSlotLine('September', 34)).not.toContain('rated');
  });
});

/**
 * **`windowSlotLine` is not edited** (acceptance 2). `/stats`, `/fun` and `/games` count the games
 * the group played — M5.26's decision, still standing — and print the string they printed before
 * M7.18, byte for byte. The board's wording is a second formatter beside it and never a flag on
 * this one: the day one of the two sentences moves, the other must not.
 */
describe('windowSlotLine, untouched', () => {
  it('prints exactly what it printed before the board took its own wording', () => {
    expect(windowSlotLine('Sunday 6 Sep to Saturday 12 Sep', 14)).toBe(
      'Sunday 6 Sep to Saturday 12 Sep · 14 games',
    );
    expect(windowSlotLine('September', 34)).toBe('September · 34 games');
    expect(windowSlotLine('Since 8 Sep 2025', 312)).toBe('Since 8 Sep 2025 · 312 games');
    expect(windowSlotLine('Sunday 6 Sep to Saturday 12 Sep', 1)).toBe(
      'Sunday 6 Sep to Saturday 12 Sep · 1 game',
    );
  });

  it('is still `gamesLabel`, which the two formatters do not share a body with', () => {
    expect(windowSlotLine('September', 7)).toBe(`September · ${gamesLabel(7)}`);
    expect(boardSlotLine('September', 7)).toBe(`September · ${ratedGamesLabel(7)}`);
    expect(windowSlotLine('September', 7)).not.toBe(boardSlotLine('September', 7));
  });
});

/**
 * The one sentence on `/p/[puuid]`, where the two universes part (acceptance 3). Its placement is
 * `app/_board/PlayerView.test.tsx`'s; this is the string.
 */
describe('PLAYER_COUNTS_SENTENCE', () => {
  it("is product's sentence, by code point", () => {
    expect(PLAYER_COUNTS_SENTENCE).toBe(
      'The record above counts games that moved a rating; everything below counts every game you played, ARAM included.',
    );
  });

  /**
   * **Second person, and one sentence.** The page is about a person and the reader is usually
   * looking at their own — the one case M3.26's third-person rule does not cover. A third-person
   * twin is product's to write, not this file's to grow.
   */
  it('addresses the reader and names ARAM once', () => {
    expect(PLAYER_COUNTS_SENTENCE).toContain('you played');
    expect(PLAYER_COUNTS_SENTENCE.match(/ARAM/g) ?? []).toHaveLength(1);
    expect(PLAYER_COUNTS_SENTENCE.match(/\./g) ?? []).toHaveLength(1);
  });
});
