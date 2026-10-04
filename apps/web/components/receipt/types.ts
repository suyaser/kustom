import type { Assignment, Calibration, RatingBefore, Role } from '@customs/core';
import type { ReceiptSplit } from '@/lib/receipt/copy';

/**
 * One stored split as the page's receipt reads it: `lib/receipt/copy`'s `ReceiptSplit` (the
 * numeric columns Discord reads too) plus the two things only the page needs. A loader maps a
 * row with `receiptSplitFromRow`; the receipt never sees `score`, which no copy may explain.
 *
 * `blue` / `red` are the parsed jsonb arrays (five `{ puuid, role }` each); parsing them is the
 * loader's job (`readAssignments`), not the component's.
 */
export interface StoredSplit extends ReceiptSplit {
  /** `splits.is_chosen`: the one in play. A reroll promotes 2, then 3. */
  isChosen: boolean;
  /**
   * `splits.explanation`, printed verbatim after `The bot's note:` inside the disclosure and
   * nowhere else. Never parsed: every other word on the receipt comes from the columns.
   */
  explanation: string;
}

/** A `splits` row with `blue` / `red` already parsed. */
export interface SplitRowLike {
  rank: number;
  is_chosen: boolean;
  blue_win_prob: number;
  gap: number;
  off_role_count: number;
  blue: readonly Assignment[];
  red: readonly Assignment[];
  explanation: string;
}

/** puuid -> the name the page prints. A puuid missing here prints the shared fallback word. */
export type ReceiptNames = Readonly<Record<string, string>>;

/** The winning side, as the client numbers it (100 blue, 200 red). */
export type WinnerSide = 100 | 200;

/** A player the page knows is off their main role tonight (live only, from core's `isOffRole`). */
export interface OffRoleSeat {
  puuid: string;
  role: Role;
}

/** What `How the bot decided` needs beyond the splits. */
export interface DisclosureExtras {
  /** M14.4's `calibration()` output for this group, or absent to leave the line out entirely. */
  calibration?: Calibration | null | undefined;
  /** Where `More on how it works` goes. */
  howHref?: string | undefined;
  /** The `<details>` id. Defaults to `RECEIPT_ANCHOR`, which Discord's teams post links to. */
  disclosureId?: string | undefined;
  /** Open on first paint (the landing page only, STRATEGY §4.5). */
  defaultOpen?: boolean | undefined;
  /**
   * ARAM (M14.16 design round 1): one lane, so no `Main roles` chip, no off-role term on the
   * splits and no lane words in a swap. The numbers are unchanged.
   */
  laneless?: boolean | undefined;
}

export type HeadingLevel = 'h2' | 'h3';

/** The ten ratings going in, for a game with no usable split (STRATEGY §4.10). */
export interface RatingsBefore {
  blue: readonly RatingBefore[];
  red: readonly RatingBefore[];
}
