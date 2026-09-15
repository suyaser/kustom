import { describe, expect, it } from 'vitest';
import type { BoardView } from '../board/types';
import { workedBoardRows, workedWindowRows } from '../testing/boardFixtures';
import { nightlyLeaderboardSkip } from './post';

/**
 * When the nightly board is not worth posting (M3.5, product 2026-09-09; windowed by M5.12).
 *
 * The rule is the result embed's: a message that says nothing is worse than silence. With the
 * board read through `This week`, a week nobody has played simply has no rows — membership is
 * the games — and the seeded-board rule is what still guards a caller reading `All time`.
 */

function board(overrides: Partial<BoardView> = {}): BoardView {
  return {
    window: 'this-week',
    rows: workedWindowRows(),
    range: 'Sunday 6 Sep to Saturday 12 Sep',
    games: 6,
    ...overrides,
  };
}

describe('nightlyLeaderboardSkip', () => {
  it('posts a window that has been played', () => {
    expect(nightlyLeaderboardSkip(board())).toBeNull();
  });

  it('says nothing when nobody has played in the window', () => {
    // A week with no games has no rows at all: on a window, membership *is* the games.
    expect(nightlyLeaderboardSkip(board({ rows: [] }))).toBe('nobody on the board');
  });

  it('says nothing on a board of seeded players nobody has played with', () => {
    // `All time` seeds every known player from their rank, so this is ten real names with real
    // Proven numbers and `0 games` against every one of them — a ranking of games that have
    // not happened, while `/leaderboard` says `No games yet.`
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));

    expect(nightlyLeaderboardSkip(board({ window: 'all-time', rows: seeded }))).toBe(
      'nobody has played in this window',
    );
  });

  it('posts again after one rated game', () => {
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));
    const first = seeded[0] as (typeof seeded)[number];
    const played = [{ ...first, games: 1, wins: 1, losses: 0 }, ...seeded.slice(1)];

    expect(nightlyLeaderboardSkip(board({ rows: played }))).toBeNull();
  });
});
