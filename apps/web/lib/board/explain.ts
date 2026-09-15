import type { SideValue } from '@customs/db';
import { gameExplanation, seededLine, startedLine } from './copy';
import type { PlayerBoardView, RecentGame } from './types';

/**
 * "How you got here" (M5.15): the two sentences that say why a rating is where it is.
 *
 * Somebody is sure the bot is wrong about them. They open their own page and read, in order,
 * where they started and then every game since — what the balancer thought their side's chances
 * were, what happened, and what it cost or paid. **A number you can retrace is a number you stop
 * arguing with**, which is the same reason the split posts its win chance (`00-product.md`,
 * principle 3).
 *
 * Nothing here computes a rating. Both functions take numbers the loader already read and hand
 * them to `lib/ratingDisplay.ts` and to `lib/board/copy.ts` — the delta in the sentence is the
 * *same call* the column beside it makes, so the two can never disagree by a point.
 *
 * Pure, and separate from the component, because these are the lines M5.15 is judged on and a
 * ternary inside a `<p>` is not something a test can hold.
 */

/**
 * The chance the balancer gave **this player's own side**, as a whole number of percent, or
 * `null` when the game has no stored split.
 *
 * **Blue is rounded and red is `100 − blue`** — deliberately, and not `round((1 − p) × 100)`
 * (the reviewer, 2026-09-10). The two disagree by a point at an exact half — `p = 0.425` gives
 * blue 43 and this red 57, while rounding red's own share gives 58 — and `favoredClause` in
 * `lib/discord/embeds.ts` already prints `100 - percent` for red. The result card and the
 * Discord message say `Red was favored 57%.` about that game, so this row says `the 57% side`:
 * one number for one game on every surface, and the two halves always add to 100.
 */
export function sideWinChance(blueWinProb: number | null, side: SideValue): number | null {
  if (blueWinProb === null) return null;
  const blue = Math.round(blueWinProb * 100);
  return side === 100 ? blue : 100 - blue;
}

/**
 * One row of `Recent games`, in a caption: `As the 58% side.`
 *
 * `null` three ways, and each of them is a row that says everything it can already:
 *
 *   - **no stored chance** — a backfilled game, a game whose lobby row was cleared, a game the
 *     group played without the bot. No row invents a chance, and none gets a caption that only
 *     repeats the result beside it (product and the designer, 2026-09-10);
 *   - **not rated** — M3.23 owns that row whole: three words, no chance, no change;
 *   - both.
 */
export function explainGame(game: RecentGame): string | null {
  if (game.muBefore === null || game.muAfter === null) return null;

  const chance = sideWinChance(game.blueWinProb, game.side);
  return chance === null ? null : gameExplanation(chance);
}

/**
 * The line above the chart: `Started at 1200, 37 games since.` on `All time` (M7.19 dropped the
 * rank clause it carried until 2026-09-16), and `Started the week at 1469, 6 games since.` in a
 * window (M5.12's four).
 *
 * The number is `player.reference` — **the value the chart's reference line is drawn from** —
 * read once so the hairline and the sentence cannot disagree, exactly as the chart's `seed` /
 * `start` labels already switch on the window.
 *
 * `null` in a window this player has no counted game in: `reference` falls back to their seed
 * there, and `Started the week at <their seed>` would name a number the week never saw. The
 * window's own empty sentence is already on the page and says the true thing.
 */
export function explainRatingStart(player: PlayerBoardView): string | null {
  if (player.window === 'all-time') return seededLine(player.reference, player.games);
  return player.games === 0 ? null : startedLine(player.window, player.reference, player.games);
}
