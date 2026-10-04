/**
 * Which games `Recent games` on `/p/[puuid]` lists (M3.23, product 2026-09-10).
 *
 * **The last five games this player played, rated or not.** The loader used to filter
 * rated rows only before it took the five, so a game that landed unrated — every backfilled
 * game until `rebuild-ratings` runs, and every game the fold refused for being too short or a
 * player short — was simply missing from the list with nothing saying why, while it sat in the
 * database and on `/admin/games`. A gap in a list of five is a page that disagrees with the
 * night the reader remembers.
 *
 * Everything a rating is folded from stays rated-only and is **not** this function: the two
 * numbers, the chart series, the seed line, the by-role record and the `37 games · 20W 17L`
 * line all count the games `ratings.games` counted. This decides one list.
 */

/** The shape both the loader's rows and the tests need: when it was, and whether it counted. */
export interface DatedGame {
  /** ISO 8601, from `games.started_at`. */
  startedAt: string;
  /** Whether the page's track folded this game (`r_after`, or `week_r_after` on a week); not: `not rated`. */
  rated: boolean;
}

/**
 * The newest `limit` games, newest first, unrated ones among them.
 *
 * The input may be in any order — `game_players` comes back in whatever order Postgres feels
 * like — so the sort is here rather than assumed. Ties on `started_at` keep the order they
 * arrived in, which is `Array.prototype.sort`'s guarantee, so two games of the same night do
 * not swap between two renders of the same page.
 */
export function recentGames<T extends DatedGame>(games: readonly T[], limit: number): T[] {
  return [...games]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(0, limit));
}

/** Whether a listed game moved this player's rating. The row's `not rated` label hangs off it. */
export function isRated(game: DatedGame): boolean {
  return game.rated;
}

/**
 * The two unrounded Ratings a listed game's change is printed from, on the page's track (M18.6):
 * the weekly pair on a week tab (05-design 11.5: a week row prints that game's weekly change), the
 * all-time pair on `All time`. `null` when that track did not rate the game.
 */
export function trackPair(
  game: {
    rBefore: number | null;
    rAfter: number | null;
    weekRBefore: number | null;
    weekRAfter: number | null;
  },
  track: 'all-time' | 'week',
): { rBefore: number; rAfter: number } | null {
  const [rBefore, rAfter] =
    track === 'week' ? [game.weekRBefore, game.weekRAfter] : [game.rBefore, game.rAfter];
  return rBefore === null || rAfter === null ? null : { rBefore, rAfter };
}
