import { windowRangeLabel } from '../board/window';
import type { WindowKind, WindowRange } from '../night';
import { type AwardRender, awardsView, WEB_AWARD_RENDER, type WeeklySeeds } from './awards';
import { DUOS_SHOWN } from './copy';
import {
  averageGameMinutes,
  blueWinRate,
  compareDuosWorst,
  countedGames,
  duoRecords,
  longestStreak,
  noRoleGames,
  onAStreak,
  playerStreaks,
  playersWhoPlayed,
  roleBlocks,
} from './fold';
import type { StatsGame, StatsPlayer, StatsView } from './types';

/**
 * The whole of `/stats`, assembled from a list of games — **pure**, so the page's own shape is
 * a unit test with a hand-built fixture and not a seeded database (M5.4's acceptance).
 *
 * `load.ts` reads the rows and calls this; the component renders what comes back and decides
 * nothing. The one thing that is decided here and nowhere else is **the universe**: `gateGame`
 * is applied once, at the top, and every number below counts the same list.
 */

export interface StatsInput {
  window: WindowKind;
  /** As read: this applies the gate. Anything the fold refused is not on this page. */
  games: readonly StatsGame[];
  players: readonly StatsPlayer[];
  /** The window's bounds, for the slot's range half. */
  range: WindowRange;
  /** True when the read hit its cap, which prints one line and drops nothing silently. */
  capped: boolean;
  cap: number;
  timeZone?: string | undefined;
  /** The web's glyphs by default; the Sunday post passes Discord's. */
  awardRender?: AwardRender | undefined;
  /**
   * Where each player's week started (M7.4), keyed by `players.id`. The loader reads it on the
   * two week windows and on no other, because `Most improved` is the one number on this page
   * that a week measures on the weekly track.
   */
  seeds?: WeeklySeeds | undefined;
}

export function statsView(input: StatsInput): StatsView {
  const counted = countedGames(input.games);
  const players = input.players;
  const streaks = playerStreaks(counted, players);
  const duos = duoRecords(counted, players);
  const first = counted[0];

  return {
    window: input.window,
    /**
     * The slot's range half, from the board's own formatter so the two pages name a window
     * with one string (M5.12) — and `null` when the window holds no counted game, which is
     * what the page turns into the window's empty sentence.
     *
     * `All time`'s `Since 8 Sep 2025` is dated from the **oldest counted game this read
     * holds**: the group's first, until the day the cap bites, at which point the cap line
     * above it says exactly which games the page is showing.
     */
    range:
      counted.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            first === undefined ? null : new Date(first.startedAt),
            input.timeZone,
          ),
    games: counted.length,
    players: playersWhoPlayed(counted),
    capped: input.capped,
    cap: input.cap,
    blueWinRate: blueWinRate(counted),
    averageMinutes: averageGameMinutes(counted),
    roles: roleBlocks(counted, players),
    noRoleGames: noRoleGames(counted),
    bestDuos: duos.slice(0, DUOS_SHOWN),
    // The same list read from the other end, not the best five reversed: a pair can be in
    // neither list, and with fewer than ten qualifying pairs it can be in both.
    worstDuos: [...duos].sort(compareDuosWorst).slice(0, DUOS_SHOWN),
    longestWin: longestStreak(streaks, 'W'),
    longestLoss: longestStreak(streaks, 'L'),
    onAStreak: onAStreak(streaks),
    awards: awardsView(input.window, counted, players, input.awardRender ?? WEB_AWARD_RENDER, input.seeds),
  };
}
