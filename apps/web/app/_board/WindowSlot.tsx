import { WINDOW_EMPTY } from '@/lib/board/copy';
import type { WindowKind } from '@/lib/night';

/**
 * The line under the window picker, on all three pages that have one (M5.12, M5.23).
 *
 * **The slot holds exactly one of two things, never both and never neither** (`05-design.md`,
 * "The window picker"): the window's range and count — `Sunday 6 Sep to Saturday 12 Sep · 14
 * rated games` on the board, `· 14 games` on `/stats`, and on `/p/[puuid]` the range half alone —
 * or, when the window has no games, the window's own empty sentence. `· 0 games` is a thing no
 * reader needs told twice, and neither is `· 0 rated games`.
 *
 * **One component, so the empty sentence has one home and one dress** (the designer, 2026-09-11,
 * M5.23). `/leaderboard` and `/p/[puuid]` printed it here in `dim`; `/stats` printed the same
 * sentence in the body at `t-base` in `text` under a strip with its hairline taken off, which is
 * M5.8's rule 6 — written when `/stats` was the only page whose whole subject is the window.
 * Three pages carrying one picker may not answer the same tap three ways: the sentence is a
 * statement about the window that was just chosen, the window is the header, and the sentence
 * belongs to the control that changed it. The hairline stays on all three, because on every one
 * of them the same slot sits over rows on the windows that have some.
 *
 * The caller decides whether the window is empty, because only the caller knows what "no games"
 * means on its own page: a `null` range on the board, and the same on a person's page.
 */
export interface WindowSlotProps {
  window: WindowKind;
  /**
   * The slot's line, already composed — `boardSlotLine(range, games)` on `/leaderboard`,
   * `windowSlotLine(range, games)` on `/stats`, `/fun` and `/games`, the bare range on
   * `/p/[puuid]` — or `null` for a window with nothing in it, which prints the sentence instead.
   *
   * **The two formatters are the two counts** (M7.18): the board counts the games that moved a
   * rating and says `· 12 rated games`, the other three count the games the group played and say
   * `· 14 games`. This component composes neither and dresses both the same, which is the point
   * of it — the words are the caller's, the slot is one.
   */
  line: string | null;
}

export function WindowSlot({ window, line }: WindowSlotProps) {
  return line === null ? (
    <p className="cn-empty">{WINDOW_EMPTY[window]}</p>
  ) : (
    <p className="cn-num cn-window-line">{line}</p>
  );
}
