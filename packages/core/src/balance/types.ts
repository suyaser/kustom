import type { KustomCalib } from '../rating/kustom';
import type { Role } from '../types';

/**
 * One of the ten. `name` is only used in the explanation; identity is the puuid.
 *
 * M18.2: the player's stored **all-time Kustom Rating**, the same `r` and `n` the fold reads.
 * There is no rank field and no seed: a player with no rated game is `{ r: 1200, n: 0 }`, as in
 * the fold, and `balance` refuses `n: 0` at any other Rating.
 */
export interface BalancePlayer {
  puuid: string;
  name: string;
  /** Unrounded all-time Rating (`ratings.r`). */
  r: number;
  /** All-time rated games before tonight's roll (whole number, >= 0). */
  n: number;
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
  /**
   * The odds function's calibration (M18.1 `winProbability`), the same pair the fold passes.
   * Absent is `{ a: 0, b: 1 }`, which every caller uses until M18.11. It changes the odds only,
   * never which splits are chosen.
   */
  calib?: KustomCalib;
  /**
   * Teammate variety (M18.13): every pair of puuids who were teammates in the recent window
   * (`config.balance.varietyWindowGames`, the night's previous game), computed by the caller.
   * Order inside a pair and duplicates do not matter; a pair naming someone not in tonight's
   * ten, the same player twice, or two players locked together as a duo is ignored, never an
   * error. Absent, `null` or empty: no variety term, every split's `variety` is 0.
   */
  recentTeammates?: readonly Duo[] | null;
}

/**
 * Every term of a split's score (M18.13), stored as `splits.score_parts` so the receipt can say
 * why a split ranked lower from stored numbers. `score === gap + offRole + repeat + variety`,
 * summed in that order, exactly.
 */
export interface ScoreParts {
  /** The unrounded gap in Rating points on role-adjusted strength; `Split.gap` is its rounding. */
  gap: number;
  /** Sum of each off-role seat's cost: 120 at baseline, up to 240 under fill protection. */
  offRole: number;
  /** `repeatSplitPenalty` (200) when this split is the same five as `lastSplit`, else 0. */
  repeat: number;
  /**
   * `min(varietyCap, varietyPerPair * (repeatedPairs - floor))`, the floor being the fewest
   * `repeatedPairs` of any split of this lobby (M18.14): the pairs kept beyond what the lobby
   * forces. Not derivable from one split alone; it is what was charged.
   */
  variety: number;
  /** Raw: pairs on the same side here who were also teammates in the recent window. */
  repeatedPairs: number;
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
  /** `Math.round(rawGap)`, Rating points, on role-adjusted strength (`r − roleDrop`, M18.13). */
  gap: number;
  /**
   * Blue's chance to win, in `[0, 1]`: `winProbability(Σ blue r, Σ red r, calib)` on the plain
   * Ratings (not role-weighted), so it equals the fold's blue expected for the same ten (M18.2).
   */
  blueWinProb: number;
  /**
   * Unrounded: `rawGap + sum(off-role cost of each filled seat) + 200 * isRepeat + variety`.
   * One seat costs 120 at baseline and up to 240 under fill protection (M7.5); variety is 0 to
   * 100 (M18.13), charged beyond the lobby's floor of repeated pairs (M18.14). This ordered the list.
   */
  score: number;
  /**
   * The terms of `score` (M18.13). `balance` always sets it; it is optional only so a `Split`
   * built by hand, or read back from a row stored before `splits.score_parts`, still types.
   */
  scoreParts?: ScoreParts;
  /** Players not on a main role, 0 to 10. */
  offRoleCount: number;
}

export interface BalanceResult {
  /** One to three, best first. */
  splits: Split[];
  /** `explanations[i]` is the sentence for `splits[i]`. */
  explanations: string[];
}
