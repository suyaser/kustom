import type { Role } from '../types';

/** One of the ten. `name` is only used in the explanation; identity is the puuid. */
export interface BalancePlayer {
  puuid: string;
  name: string;
  mu: number;
  sigma: number;
  /** `null` means flexible: every role is a main and the player is never off-role. */
  mainRole: Role | null;
  secondaryRole: Role | null;
  /** Tonight only. Becomes the main; the usual main becomes the backup. */
  roleOverride?: Role | null;
  /**
   * Fill protection (M7.5): how many games since this player was last filled off their role.
   * `0` means their last game was a fill, and makes an off-role seat cost the most; the price
   * decays back to `config.balance.offRolePenalty` as the number grows. `null` or absent —
   * never filled, or no history to read — is the flat penalty, the baseline behaviour.
   * A negative number is read as `0`; anything that is not a finite number is read as `null`.
   * The caller computes it (M7.6); core never reads a database.
   */
  gamesSinceLastFill?: number | null;
}

/** Two puuids that must land on the same team. Order does not matter. */
export type Duo = readonly [string, string];

export interface BalanceInput {
  /** Exactly ten, in any order. */
  players: readonly BalancePlayer[];
  duos?: readonly Duo[];
  /** The five puuids on one side of the last chosen split for these ten, or `null`. */
  lastSplit?: readonly string[] | null;
}

export interface Assignment {
  puuid: string;
  role: Role;
}

export interface Split {
  /** Five, in lane order (top, jungle, mid, adc, support). */
  blue: Assignment[];
  /** Five, in lane order. */
  red: Assignment[];
  /** `Math.round(rawGap)`, display-rating units. */
  gap: number;
  /** Blue's chance to win, in `[0, 1]`, from OpenSkill on the real ratings. */
  blueWinProb: number;
  /**
   * Unrounded: `rawGap + sum(off-role cost of each filled seat) + 200 * isRepeat`. One seat
   * costs 120 at baseline and up to 240 under fill protection (M7.5). This ordered the list.
   */
  score: number;
  /** Players not on a main role, 0 to 10. */
  offRoleCount: number;
}

export interface BalanceResult {
  /** One to three, best first. */
  splits: Split[];
  /** `explanations[i]` is the sentence for `splits[i]`. */
  explanations: string[];
}
