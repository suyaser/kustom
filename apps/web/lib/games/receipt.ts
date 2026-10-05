import { type CalibrationGame, type KustomBefore, preGameOdds, type Role } from '@customs/core';
import type { LobbyKickoff } from '@customs/db/schemas';
import type { RatingsBefore, StoredSplit } from '@/components/receipt/types';

/**
 * Which receipt a stored game gets (M14.16; STRATEGY §4.7, §4.8, §4.10). Pure: the loaders read
 * rows, this decides, the components draw. No odds are computed here: a rolled game's odds are
 * its chosen split's stored `blue_win_prob`, a split-less game's are core's `preGameOdds` inside
 * the receipt components, and calibration is core's `calibration` over {@link calibrationGameOf}.
 *
 * **The one rule for every after-game reader (M21.7).** A finished game's odds are printed only
 * through {@link gameReceiptOf} or {@link playedOddsOf}: the bot's split counts when the ten who
 * played are its teams (`splitSidesOf` `same`, or `swapped` with the odds flipped, as the kickoff
 * record calls it, decision row "M21.4 kickoff record rules"); anything else is pre-game odds (the
 * kickoff record's stored odds when its teams are the eog's, else core's `preGameOdds` over the
 * `r_before`s), and a not-rated game or an ARAM the bot did not roll has none.
 * `receipt.guard.test.ts` fails on a reader that reads `blue_win_prob` without going through here.
 */

/** One scoreboard row, as much of it as the receipt reads. */
export interface ReceiptSeat {
  puuid: string;
  side: 100 | 200;
  /** The all-time Kustom Rating going in (`r_before`, 0036): what the pre-game odds read (M18.5). */
  rBefore: number | null;
}

export type GameReceipt =
  /**
   * The bot picked these teams and they played: the stored run, finished variant. `swapped`: they
   * sat on each other's sides (M21.7), and `splits` / `chosen` are the run turned round
   * ({@link orientRun}), so every side and every percentage names the side each team really played.
   */
  | { kind: 'rolled'; splits: readonly StoredSplit[]; chosen: StoredSplit; swapped: boolean }
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
      /**
       * M21.7: the kickoff record's stored odds (`custom` / `unrolled`) when its teams are exactly
       * the ten who played, else `null`. Preferred over `preGameOdds`: it is the number Tonight
       * and the `Game on` post showed while the game was on, and a later rebuild cannot move it.
       */
      kickoffBlueWinProb: number | null;
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

/**
 * How the sided players stand against a split, roles ignored (M21.4; M21.1 audit note a):
 * `same` is {@link teamsMatchSplit}; `swapped` is the split's two teams on each other's sides (the
 * room played the roll, the host just sat on the other side); `different` is anything else.
 *
 * The kickoff record calls a `swapped` game `rolled` (with `swapped: true`): the teams are the
 * bot's, only the side line and the odds' direction change. M21.7 gives history the same rule:
 * {@link gameReceiptOf}, {@link playedOddsOf} and {@link calibrationGameOf} read a `swapped` game
 * as rolled, with the odds flipped (`1 − p`). {@link teamsMatchSplit} keeps meaning `same`.
 */
export function splitSidesOf(
  split: { blue: readonly { puuid: string }[]; red: readonly { puuid: string }[] },
  seats: readonly Pick<ReceiptSeat, 'puuid' | 'side'>[],
): 'same' | 'swapped' | 'different' {
  const blue = seats.filter((seat) => seat.side === 100).map((seat) => seat.puuid);
  const red = seats.filter((seat) => seat.side === 200).map((seat) => seat.puuid);
  const splitBlue = split.blue.map((a) => a.puuid);
  const splitRed = split.red.map((a) => a.puuid);
  if (sameMembers(splitBlue, blue) && sameMembers(splitRed, red)) return 'same';
  if (sameMembers(splitBlue, red) && sameMembers(splitRed, blue)) return 'swapped';
  return 'different';
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

/**
 * A run as the real sides see it (M21.5 Tonight in game, M21.7 history): with `swapped`, each
 * split's teams change sides and blue's chance becomes the old red's. Nothing else moves (the gap
 * is unsigned, the roles and the off-role count belong to the players). Without, the run itself.
 */
export function orientRun<T extends Pick<StoredSplit, 'blue' | 'red' | 'blueWinProb'>>(
  run: readonly T[],
  swapped: boolean,
): T[] {
  if (!swapped) return [...run];
  return run.map((split) => ({
    ...split,
    blue: split.red,
    red: split.blue,
    blueWinProb: 1 - split.blueWinProb,
  }));
}

function kickoffSides(kickoff: LobbyKickoff): { blue: { puuid: string }[]; red: { puuid: string }[] } {
  return {
    blue: kickoff.blue.map((puuid) => ({ puuid })),
    red: kickoff.red.map((puuid) => ({ puuid })),
  };
}

/**
 * The kickoff record's stored odds for the game that was played, or `null` (M21.7): only a
 * `custom` / `unrolled` record (a rolled one reads the split), and only when its two teams are
 * exactly the eog's, side for side. The end of game wins (M21 rules): a record that disagrees
 * with the scoreboard is ignored here, and {@link kickoffDisagrees} lets the loader log it.
 */
export function kickoffOddsFor(
  kickoff: LobbyKickoff | null | undefined,
  seats: readonly Pick<ReceiptSeat, 'puuid' | 'side'>[],
): number | null {
  if (kickoff === null || kickoff === undefined || kickoff.kind === 'rolled') return null;
  return splitSidesOf(kickoffSides(kickoff), seats) === 'same' ? kickoff.blueWinProb : null;
}

/** Whether a kickoff record names other teams than the ones on the scoreboard (the loader logs it). */
export function kickoffDisagrees(
  kickoff: LobbyKickoff | null | undefined,
  seats: readonly Pick<ReceiptSeat, 'puuid' | 'side'>[],
): boolean {
  if (kickoff === null || kickoff === undefined || seats.length === 0) return false;
  return splitSidesOf(kickoffSides(kickoff), seats) !== 'same';
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
  /** The lobby's kickoff record (M21.4), when the loader read it: its odds win over `preGameOdds`. */
  kickoff?: LobbyKickoff | null | undefined;
}): GameReceipt {
  const chosen = chosenOf(input.splits);
  const sides = chosen === null ? null : splitSidesOf(chosen, input.seats);
  if (chosen !== null && (sides === 'same' || sides === 'swapped')) {
    const swapped = sides === 'swapped';
    const splits = orientRun(input.splits, swapped);
    return { kind: 'rolled', splits, chosen: chosenOf(splits) ?? chosen, swapped };
  }
  // ARAM is unrated: odds from ratings would be a rating claim the mode does not make. A game
  // played not rated makes none either (decision 2026-10-04, M15.18).
  if (input.aram || !input.rated) return { kind: 'none' };
  return {
    kind: 'pre-game',
    reason: chosen === null ? 'no-split' : 'teams-changed',
    ratingsBefore: ratingsBeforeOf(input.seats),
    rolled: chosen === null ? null : input.splits,
    kickoffBlueWinProb: kickoffOddsFor(input.kickoff, input.seats),
  };
}

/**
 * The one number a receipt prints for blue (M21.7), or `null` for none: a rolled game's (oriented)
 * split odds; a pre-game receipt's kickoff odds, else `fallback` (the fold's stored `fold_p`, where
 * the surface has it, M14.59), else core's `preGameOdds` over the `r_before`s; nothing for `none`.
 */
export function receiptBlueWinProb(receipt: GameReceipt, fallback: number | null = null): number | null {
  if (receipt.kind === 'rolled') return receipt.chosen.blueWinProb;
  if (receipt.kind === 'none') return null;
  return (
    receipt.kickoffBlueWinProb ??
    fallback ??
    preGameOdds(receipt.ratingsBefore.blue, receipt.ratingsBefore.red)
  );
}

/**
 * The bot's odds for the teams that played, for blue as they sat (M21.7): the split's stored
 * `blue_win_prob` when they are its teams on its sides, `1 − p` on swapped sides, and `null` when
 * the teams were not the split's (the bot made no claim about them). For the readers that keep the
 * bot's claim apart from the rating's (M14.59's breakdown line).
 */
export function rolledOddsOf(
  chosen: { blue: readonly { puuid: string }[]; red: readonly { puuid: string }[]; blueWinProb: number },
  seats: readonly Pick<ReceiptSeat, 'puuid' | 'side'>[],
): number | null {
  const sides = splitSidesOf(chosen, seats);
  if (sides === 'different') return null;
  return sides === 'swapped' ? 1 - chosen.blueWinProb : chosen.blueWinProb;
}

/** The chosen split as {@link playedOddsOf} needs it: its two sides, its odds and its rank. */
export interface PlayedSplit {
  blue: readonly { puuid: string; role?: Role }[];
  red: readonly { puuid: string; role?: Role }[];
  blueWinProb: number;
  rank: number;
}

/** What a compact after-game surface prints: the odds of the teams that played and the pick number. */
export interface PlayedOdds {
  /** As {@link GameReceipt}'s kinds: the bot's teams, pre-game odds, or nothing honest to show. */
  kind: GameReceipt['kind'];
  /** Blue's chance for the real sides, or `null` for none (or a `preGameOdds` that said no). */
  blueWinProb: number | null;
  /** The chosen split's rank for `rolled` (`pick #2`), else `null`. */
  rank: number | null;
  swapped: boolean;
}

/**
 * {@link gameReceiptOf}'s answer for a surface that prints only the odds (the result post, the
 * tape, the poster card, a player's recent games, `/fun`), from the chosen split alone. The same
 * rule, so a compact line and the full receipt never disagree.
 */
export function playedOddsOf(input: {
  aram: boolean;
  rated: boolean;
  seats: readonly ReceiptSeat[];
  chosen: PlayedSplit | null;
  kickoff?: LobbyKickoff | null | undefined;
}): PlayedOdds {
  const sides = input.chosen === null ? null : splitSidesOf(input.chosen, input.seats);
  if (input.chosen !== null && (sides === 'same' || sides === 'swapped')) {
    const swapped = sides === 'swapped';
    const p = input.chosen.blueWinProb;
    return { kind: 'rolled', blueWinProb: swapped ? 1 - p : p, rank: input.chosen.rank, swapped };
  }
  if (input.aram || !input.rated) return { kind: 'none', blueWinProb: null, rank: null, swapped: false };
  const before = ratingsBeforeOf(input.seats);
  return {
    kind: 'pre-game',
    blueWinProb: kickoffOddsFor(input.kickoff, input.seats) ?? preGameOdds(before.blue, before.red),
    rank: null,
    swapped: false,
  };
}

/**
 * {@link playedOddsOf}'s number on the surfaces that printed odds only for a rolled game before
 * M21.7 (the result post, the night tape, the poster's link picture, `/fun`): the bot's teams keep
 * their (oriented) odds, teams changed after a roll get their pre-game odds, and a game nobody
 * rolled stays without, as before (milestone acceptance 1, "the unrolled game as today"; whether
 * an unrolled game's kickoff odds should print there is product's call, filed as OPEN).
 */
export function postedOdds(played: PlayedOdds, chosen: object | null): number | null {
  if (played.kind === 'rolled') return played.blueWinProb;
  if (played.kind === 'pre-game' && chosen !== null) return played.blueWinProb;
  return null;
}

/**
 * The split's roles for the players whose side is one of the split's two teams, whichever side it
 * sat on (M21.7, the result post's and the poster's role fallback). A player on a changed side
 * gets none: the split never gave them a lane on that team (M21.5 and M21.6 use the same rule).
 */
export function splitRolesFor(
  chosen: { blue: readonly { puuid: string; role: Role }[]; red: readonly { puuid: string; role: Role }[] } | null,
  seats: readonly Pick<ReceiptSeat, 'puuid' | 'side'>[],
): Map<string, Role> {
  const roles = new Map<string, Role>();
  if (chosen === null) return roles;
  const splitSides = [chosen.blue, chosen.red];
  for (const side of [100, 200] as const) {
    const puuids = seats.filter((seat) => seat.side === side).map((seat) => seat.puuid);
    const match = splitSides.find((splitSide) =>
      sameMembers(
        splitSide.map((a) => a.puuid),
        puuids,
      ),
    );
    for (const assignment of match ?? []) roles.set(assignment.puuid, assignment.role);
  }
  return roles;
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
 * were the split's teams. Pre-game odds never count: the bot computed those afterwards. M21.7: the
 * split's teams on swapped sides count, with the odds flipped (`splitSidesOf`, the kickoff rule).
 * Every group game counts, whatever the page's filters say; a rating reset does not wipe them.
 * **Only Kustom rolls count** (M18.6): the line checks `winProbability`'s odds, so a split rolled
 * with OpenSkill is not one of its calls, and the line restarts at `0 of 20` at the switch.
 */
export function calibrationGameOf(game: CalibrationCandidate): CalibrationGame | null {
  if (game.aram || !game.rated || game.chosen === null) return null;
  if (game.chosen.oddsModel !== 'kustom') return null;
  const p = game.chosen.blueWinProb;
  if (!Number.isFinite(p) || p < 0 || p > 1 || p === 0.5) return null;
  const sides = splitSidesOf(game.chosen, game.seats);
  if (sides === 'different') return null;
  return { blueWinProb: sides === 'swapped' ? 1 - p : p, blueWon: game.winningSide === 100 };
}
