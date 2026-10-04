/**
 * Every friend-facing string of the game recap line (M16.4), verbatim from the brief
 * (`redesign/briefs/m16.1-premium-ai.md` 1.3 and 1.5), all [NEW COPY] there.
 *
 * Pure strings, safe in client components. Lives under `lib/ai/` so the M16.2 guard holds: the
 * type-only import below is erased at build and pulls nothing server-side into a client bundle.
 */
import type { AiGate } from '../premium';

/** The label in front of the line, on the site and on Discord. */
export const AI_RECAP_LABEL = 'AI recap';

/** Tapping or hovering the label, on the site (game line). */
export const AI_RECAP_TAP =
  'Written by AI from the numbers on this page. Every number in it is checked against the game before it shows up.';

/** Tapping or hovering the label on the board's Last week storyline (M16.5; brief 1.3). */
export const AI_STORYLINE_TAP =
  "Written by AI from the week's games. Every number in it is checked against the board before it shows up.";

/** The admin's one-tap control beside the label (game page, board's Last week). */
export const HIDE_LABEL = 'Hide';

/** After `Hide`. */
export const HIDDEN_NOTICE = "Hidden. It won't come back.";

/** Shown in place of a Hide that did not go through: not in the brief, kept neutral [NEW COPY]. */
export const HIDE_FAILED = "Couldn't hide it. Try again.";

/** The player page's label (M16.6; brief 1.3) [NEW COPY in the brief]. */
export const AI_SCOUTING_LABEL = 'AI scouting report';

/** Tapping or hovering the scouting report's label (M16.6; brief 1.3, reworded in design round 1). */
export const AI_SCOUTING_TAP =
  "Written by AI from this player's games. Every number in it is checked before it shows up. Rewritten each Sunday after a week they play.";

/** Under the report: the day it was written (brief 1.2, `Written Sunday 4 Oct`). */
export function scoutingWrittenLine(dayName: string, dayMonth: string): string {
  return `Written ${dayName} ${dayMonth}`;
}

/** Documents the gate this copy only ever shows behind. */
export type RecapCopyGate = AiGate;
