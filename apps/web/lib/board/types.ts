import type { DeltaReason, RatingBefore } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import type { ResultOdds } from '../breakdown/read';
import type { WindowKind } from '../night';
import type { PlayerName } from '../tonight/types';

/**
 * What the board (`/g/<slug>/leaderboard`) and the player page (`/g/<slug>/p/<puuid>`) know
 * (M3.5; one Rating since M14.15). Loaded on the server with the anon key, **one group's games and
 * ratings only** (M13.10), and rendered there.
 *
 * **`BoardRow` does cross the wire** (M3.19): the tonight page's rail renders the board's first
 * five through a client component, so every field is a string, a number, a boolean or `null`.
 *
 * **Numbers are display numbers, deltas are not.** `rating` is `displayRating(mu)` from core, the
 * same integer every embed prints. A rating *change* is carried as the two mu values it comes from
 * and turned into a delta where it is rendered (`displayDelta`): `-0` does not survive a
 * `JSON.stringify`.
 */

/**
 * What a row is ranked on. There is one rating track (M14.57 retired the weekly one); this says
 * which **board** the row belongs to.
 *
 * - `all-time`: ranked on Rating, the stored fold (`ratings`). Ranked rows and a settling section
 *   (M14.15).
 * - `week`: `This week` / `Last week`, ranked on **net points**: the sum of the printed all-time
 *   deltas of the player's rated games in the window (M14.57). One list, no settling section; the
 *   row still carries the all-time settling chip ({@link BoardRow.settlingChip}).
 */
export type RatingTrack = 'all-time' | 'week';

/** One row of the board (`05-design.md` 5.2). */
export interface BoardRow {
  puuid: string;
  /** `null` for a player the database has no name for yet: rendered `Someone` (M3.10). */
  name: PlayerName;
  /**
   * The same-name suffix (`#EUW`, `(2)`) printed muted after the name, or null/absent when nobody
   * else in the group prints the same name (M14.69, `lib/names/roster.ts`).
   */
  nameSuffix?: string | null | undefined;
  /** Which board the row is on, and so what it is ranked on (M14.57). Never a mix. */
  track: RatingTrack;
  /**
   * Net points in the window (M14.57): the sum of `displayDelta` over the player's rated games in
   * it (`sumDisplayDeltas`), on `This week` / `Last week`; the week board's sorted number, printed
   * signed (`+86`, a net zero `+0`). `null` on `All time`.
   */
  points: number | null;
  /**
   * The unrounded `mu` behind {@link BoardRow.rating}: the tie-break under equal printed Ratings,
   * so the printed column never goes up as you read down it. **Never printed.**
   */
  sortKey: number;
  /**
   * `displayRating(mu)` of the player's **current** all-time rating on every window: All time's
   * sorted number, and the week board's fourth tie-break (M14.57).
   */
  rating: number;
  /** The **window's** counted games (on `All time`, `ratings.games`). */
  games: number;
  wins: number;
  losses: number;
  /**
   * Rated games in this group, all time (`ratings.games`): what the settling rule counts, in every
   * window. A player with one game this week and two hundred behind them is not settling.
   */
  ratedGames: number;
  /**
   * What the history did to their rating, as the two mu values (`displayDelta` at render): on
   * `All time` the seed the history started from to today's rating. `null` on a week, whose change
   * is {@link BoardRow.points} (a sum of printed rows, not one mu difference, M14.57).
   */
  climb: Climb | null;
  /**
   * In the settling **section**: under core's `SETTLING_GAMES` rated games in the group
   * (`isSettling(ratedGames)`), on `All time` only. **Always `false` on a week**: week boards are
   * one ranked list (STRATEGY §5, M14.57).
   */
  settling: boolean;
  /**
   * Whether the row carries the all-time `settling` chip: `isSettling(ratedGames)` on every
   * window (M14.57: on a week it says why a newcomer's points run large). Equals
   * {@link BoardRow.settling} on `All time`.
   */
  settlingChip: boolean;
  /**
   * The titles of the awards this player won in a **closed** window (M8.3), from `lib/stats`.
   * Empty everywhere else.
   */
  awards: readonly string[];
}

/** The two mu values a change is computed from. */
export interface Climb {
  muBefore: number;
  muAfter: number;
}

export interface BoardView {
  /** Which of the five this board was read through. */
  window: WindowKind;
  /**
   * The rows, in the board's order (`lib/board/order.ts`): on the all-time track the ranked rows
   * by Rating and then the settling rows by Rating; on a week one list by net points (M14.57).
   */
  rows: BoardRow[];
  /**
   * The header slot's range half (`Sunday 6 Sep to Saturday 12 Sep`, `September`, `Since 8 Sep
   * 2025`). A week always has one (an empty week prints its dates, M14.70); `All time` is `null`
   * when it has no counted games.
   */
  range: string | null;
  /** The window's counted games. `0` on an empty window. */
  games: number;
  /** Whether the group has any rated game at all: an empty group's board says so (STRATEGY §6(b)). */
  everRated: boolean;
  /**
   * The group's people who are not on this board: members (and anybody with a rating row in the
   * group) with no rated game in the window (STRATEGY §5, `+ 9 people who haven't played...`).
   */
  notPlayed: number;
  /**
   * The day of the group's latest `Reset ratings` (`1 Nov`, M14.18), or null/absent for a group that
   * never reset. `All time`'s chip then reads `Since 1 Nov`.
   */
  resetDay?: string | null;
  /**
   * Where an empty `This week` points (M14.70): `last-week` when last week has a counted game,
   * `all-time` otherwise; `all-time` on an empty `Last week`; `null` on a window with games, on
   * `All time` and on a group with no rated game at all. Absent reads as `all-time` for a week.
   */
  fallback?: EmptyWindowFallback | null;
}

/** The two windows an empty week can point to (M14.70). */
export type EmptyWindowFallback = 'last-week' | 'all-time';

/** One of the player's own five in a recent game, in lane order. */
export interface RecentTeammate {
  puuid: string;
  name: PlayerName;
  role: RoleValue | null;
}

/** This player's place in one game's award (M7.10): MVP on the winning side, ACE on the losing. */
export type RecentAward = 'mvp' | 'ace';

export interface RecentGame {
  gameId: string;
  /** ISO 8601. The list is newest first. */
  startedAt: string;
  durationS: number;
  won: boolean;
  side: SideValue;
  /** The side that won, for the compact receipt (`Blue was 54%. Blue won.`). */
  winningSide: SideValue;
  /** The player's own role in this game, from the scoreboard. */
  role: RoleValue | null;
  /** The two mu values the delta is computed from, at render. `null` on an unrated game. */
  muBefore: number | null;
  muAfter: number | null;
  /** `mvp`, `ace`, or `null` (M7.10). */
  award: RecentAward | null;
  /**
   * Blue's chance in the split the group played (`splits.blue_win_prob` of the chosen split), or
   * `null` for a game with no stored split.
   */
  blueWinProb: number | null;
  /** The chosen split's rank (`pick #2` after a reroll), or `null` with no split. */
  pickRank: number | null;
  /**
   * Everyone's rating going in, by side, for a game with no stored split: the compact receipt's
   * pre-game odds come from core's `preGameOdds` over these (STRATEGY §4.10). `null` when the game
   * has a split.
   */
  ratingsBefore: { blue: RatingBefore[]; red: RatingBefore[] } | null;
  /** An ARAM: the receipt keeps its line and adds the label; no rating claims. */
  aram: boolean;
  /** The five on the player's own side, lane order, this player among them. */
  team: RecentTeammate[];
  /**
   * Why this game moved their Rating by as much as it did (M14.58): core's structured reason from
   * the fold's stored breakdown (`basis: 'stored'`), or from the stored befores for a game stored
   * before `0034` (`legacy`, award `unknown`; `lead-only` when a before is missing). `null` on an
   * unrated game. The web renders the words (tap-to-explain, after M15.5 / M16.4).
   */
  reason?: DeltaReason | null;
  /**
   * The result line's odds (M14.59): the bot's split odds and the rating's, whether they round
   * differently, and why. `null` with neither number.
   */
  odds?: ResultOdds | null;
}

/**
 * One player, in one group, read through one window (M3.5, windowed by M5.12, grouped by M13.10).
 */
export interface PlayerBoardView {
  puuid: string;
  name: PlayerName;
  /** As {@link BoardView.resetDay} (M14.18). */
  resetDay?: string | null;
  /** Which of the five this page was read through. */
  window: WindowKind;
  /** Which board this page is a lens on (M14.57). */
  track: RatingTrack;
  /**
   * `displayRating(mu)` of their **current** all-time rating, on every window: there is no week's
   * Rating any more (M14.57). The seed for somebody never rated.
   */
  rating: number;
  /**
   * Net points in the window, the number their week-board row prints (`+86 this week`), or
   * `null` on `All time`. A week they did not play is `0`.
   */
  points: number | null;
  /** The window's counted games. `All time` is the fold's own total. */
  games: number;
  wins: number;
  losses: number;
  /** Rated games in this group, all time: what the settling chip counts. */
  ratedGames: number;
  /** The header slot's range half, or `null` when they have nothing to date from. */
  range: string | null;
  /** `isSettling(ratedGames)` on `All time`; always `false` on a week. */
  settling: boolean;
  /**
   * Their place among the group's ranked players on `All time` (1 is the top), or `null` while
   * settling or on any other window. The self lens's `Rating, #3` tile reads it.
   */
  rank: number | null;
  /**
   * The chart's reference line: the seed on `All time` (`Started at 1200`), the all-time rating
   * carried into the window on a week (their first game's `mu_before` there; the seed with none).
   */
  reference: number;
  /**
   * The all-time `Rating` series in `started_at` order, oldest first, over the window's rated
   * games. Empty for no games.
   */
  history: number[];
  /** The window's newest games, rated or not, newest first (at most `RECENT_GAMES`). */
  recent: RecentGame[];
}
