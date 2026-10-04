import { windowRangeLabel } from '../board/window';
import type { WindowKind, WindowRange } from '../night';
import { type AwardRender, awardsView, WEB_AWARD_RENDER } from './awards';
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
import type { DuoRecord, StatsGame, StatsPlayer, StatsView } from './types';

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
    ...splitDuos(duos),
    longestWin: longestStreak(streaks, 'W'),
    longestLoss: longestStreak(streaks, 'L'),
    onAStreak: onAStreak(streaks),
    awards: awardsView(input.window, counted, players, input.awardRender ?? WEB_AWARD_RENDER),
  };
}

/**
 * Best and worst together, **never the same pair in both** (M14.17, the audit's duos bug: with
 * fewer than ten qualifying pairs the two lists used to overlap, so one pair could be a group's
 * best and worst duo at once). The ranked list is cut in two: the better half (rounded up, at most
 * five) is `Best together`, and the worst of what is left (at most five) is `Worst together`. One
 * qualifying pair is a best duo and nothing else.
 */
export function splitDuos(duos: readonly DuoRecord[]): { bestDuos: DuoRecord[]; worstDuos: DuoRecord[] } {
  const { best, worst } = splitBestWorst(duos, DUOS_SHOWN, compareDuosWorst);
  return { bestDuos: best, worstDuos: worst };
}

/**
 * The rule {@link splitDuos} applies, for any list already ranked best first (M14.35 reuses it for
 * the player page's Partners): the better half, rounded up and at most `shown`, is the best list;
 * the worst of the rest, at most `shown`, read with `compareWorst`, is the worst list. Nobody is in
 * both.
 */
export function splitBestWorst<T>(
  ranked: readonly T[],
  shown: number,
  compareWorst: (a: T, b: T) => number,
): { best: T[]; worst: T[] } {
  const bestCount = Math.min(shown, Math.ceil(ranked.length / 2));
  return {
    best: ranked.slice(0, bestCount),
    worst: [...ranked.slice(bestCount)].sort(compareWorst).slice(0, shown),
  };
}
