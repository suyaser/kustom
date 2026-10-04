import type { CalibrationGame, KustomBefore } from '@customs/core';
import type { RatingsBefore, StoredSplit } from '@/components/receipt/types';

/**
 * Which receipt a stored game gets (M14.16; STRATEGY §4.7, §4.8, §4.10). Pure: the loaders read
 * rows, this decides, the components draw. No odds are computed here: a rolled game's odds are
 * its chosen split's stored `blue_win_prob`, a split-less game's are core's `preGameOdds` inside
 * the receipt components, and calibration is core's `calibration` over {@link calibrationGameOf}.
 */

/** One scoreboard row, as much of it as the receipt reads. */
export interface ReceiptSeat {
  puuid: string;
  side: 100 | 200;
  /** The all-time Kustom Rating going in (`r_before`, 0036): what the pre-game odds read (M18.5). */
  rBefore: number | null;
}

export type GameReceipt =
  /** The bot picked these teams and they played: the stored run, finished variant. */
  | { kind: 'rolled'; splits: readonly StoredSplit[]; chosen: StoredSplit }
  /**
   * Pre-game odds from everyone's ratings going in. `no-split`: backfilled or never rolled.
   * `teams-changed`: rolled, then the lobby moved people; `rolled` is the run, for the disclosure.
   * `preGameOdds` may still say no (a rating missing): the components then print `No odds for this game.`
   */
  | {
      kind: 'pre-game';
      reason: 'no-split' | 'teams-changed';
      ratingsBefore: RatingsBefore;
      rolled: readonly StoredSplit[] | null;
    }
  /**
   * Nothing honest to show: an ARAM the bot did not roll (no rating claims on ARAM), or, the same
   * way, a game played not rated whose teams are not the bot's (M15.18).
   */
  | { kind: 'none' };

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return set.size === right.length && right.every((puuid) => set.has(puuid));
}

/**
 * Whether the ten who played are the chosen split's ten, each on the split's side (§4.8's "teams
 * weren't changed in the lobby after the roll"). Roles do not count: a lane swap inside a team is
 * still the bot's teams.
 */
export function teamsMatchSplit(
  split: Pick<StoredSplit, 'blue' | 'red'>,
  seats: readonly ReceiptSeat[],
): boolean {
  const blue = seats.filter((seat) => seat.side === 100).map((seat) => seat.puuid);
  const red = seats.filter((seat) => seat.side === 200).map((seat) => seat.puuid);
  return (
    sameMembers(
      split.blue.map((a) => a.puuid),
      blue,
    ) &&
    sameMembers(
      split.red.map((a) => a.puuid),
      red,
    )
  );
}

/** The chosen split of a run, or `null` when none is flagged (history only trusts `is_chosen`). */
export function chosenOf(splits: readonly StoredSplit[]): StoredSplit | null {
  return splits.find((split) => split.isChosen) ?? null;
}

function ratingsBeforeOf(seats: readonly ReceiptSeat[]): RatingsBefore {
  const of = (side: 100 | 200): KustomBefore[] =>
    seats.filter((seat) => seat.side === side).map((seat) => ({ r: seat.rBefore }));
  return { blue: of(100), red: of(200) };
}

export function gameReceiptOf(input: {
  aram: boolean;
  /**
   * `games.rated` (M15.18): false for a game played not rated (a rule's default or the Rated
   * switch). Its rolled odds stay (they were posted before anyone picked); odds worked out
   * afterwards from ratings are a rating claim it does not make, as for ARAM.
   */
  rated: boolean;
  seats: readonly ReceiptSeat[];
  /** The run the chosen split belongs to (every rank), or `[]` for a game with no lobby or no split. */
  splits: readonly StoredSplit[];
}): GameReceipt {
  const chosen = chosenOf(input.splits);
  if (chosen !== null && teamsMatchSplit(chosen, input.seats)) {
    return { kind: 'rolled', splits: input.splits, chosen };
  }
  // ARAM is unrated: odds from ratings would be a rating claim the mode does not make. A game
  // played not rated makes none either (decision 2026-10-04, M15.18).
  if (input.aram || !input.rated) return { kind: 'none' };
  return {
    kind: 'pre-game',
    reason: chosen === null ? 'no-split' : 'teams-changed',
    ratingsBefore: ratingsBeforeOf(input.seats),
    rolled: chosen === null ? null : input.splits,
  };
}

/** What {@link calibrationGameOf} needs to know about one stored game. */
export interface CalibrationCandidate {
  aram: boolean;
  winningSide: 100 | 200;
  /** Every row has `r_after`: the all-time fold rated it. */
  rated: boolean;
  seats: readonly ReceiptSeat[];
  /**
   * The chosen split's sides, odds and odds model (`splits.odds_model`, 0036), or `null` with no
   * chosen split. Absent `oddsModel` reads as `openskill`.
   */
  chosen: (Pick<StoredSplit, 'blue' | 'red' | 'blueWinProb'> & { oddsModel?: 'openskill' | 'kustom' }) | null;
}

/**
 * One game's input to core's `calibration`, or `null` when it does not qualify (STRATEGY §4.8):
 * a rated Summoner's Rift game with a chosen split whose odds are not exactly 50/50 and whose ten
 * played on the split's sides. Pre-game odds never count: the bot computed those afterwards.
 * Every group game counts, whatever the page's filters say; a rating reset does not wipe them.
 * **Only Kustom rolls count** (M18.6): the line checks `winProbability`'s odds, so a split rolled
 * with OpenSkill is not one of its calls, and the line restarts at `0 of 20` at the switch.
 */
export function calibrationGameOf(game: CalibrationCandidate): CalibrationGame | null {
  if (game.aram || !game.rated || game.chosen === null) return null;
  if (game.chosen.oddsModel !== 'kustom') return null;
  const p = game.chosen.blueWinProb;
  if (!Number.isFinite(p) || p < 0 || p > 1 || p === 0.5) return null;
  if (!teamsMatchSplit(game.chosen, game.seats)) return null;
  return { blueWinProb: p, blueWon: game.winningSide === 100 };
}
