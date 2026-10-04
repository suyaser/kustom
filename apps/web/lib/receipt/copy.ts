import {
  type Assignment,
  describeSwap,
  favoredSide,
  oddsBand,
  type ScoreParts,
  type SwapDescription,
  type WhyLowerScored,
  whyLower,
} from '@customs/core';

/**
 * Every word of the fairness receipt (M14.9 page, M14.10 Discord; redesign/STRATEGY.md §4.2 to
 * §4.10), in one module with no React, no Next and no DOM in front of it, so the tonight page, the
 * game page and the Discord teams / result embeds print the same sentences about the same split.
 *
 * **Numbers in, words out, and the numbers are the stored `splits` columns** (`blue`, `red`,
 * `gap`, `off_role_count`, `blue_win_prob`, `rank`) read through core's M14.4 helpers. Nothing
 * here parses `splits.explanation` (STRATEGY §4.2 rule 5): core's sentence is quoted verbatim by
 * the surfaces, never mined for facts.
 *
 * Names arrive through a `name(puuid)` callback because the surfaces spell them differently:
 * Discord escapes markdown and truncates at 32 (`renderName`), the page wraps the raw name.
 *
 * **Plain and rich come from one template.** A sentence the page emphasises (bold names, mono
 * numbers) is written once as `…Parts`, an array of text and marked parts; the plain export
 * Discord uses is `plain(…Parts(…))`. So the two surfaces can never word a split differently.
 */

/** A sentence in parts: text, a name (`strong`, bold on the page) or a number (`num`, mono). */
export type RichPart = string | { strong: string } | { num: string };
export type Rich = readonly RichPart[];

/** The sentence with its marks dropped: what Discord and every plain-string caller print. */
export function plain(rich: Rich): string {
  return rich
    .map((part) => (typeof part === 'string' ? part : 'strong' in part ? part.strong : part.num))
    .join('');
}

/** One stored split, as the receipt reads it: the `splits` row's numeric columns, camel-cased. */
export interface ReceiptSplit {
  /** `splits.rank`, 1 to 3. */
  rank: number;
  blue: readonly Assignment[];
  red: readonly Assignment[];
  /** `splits.gap`, display points, unsigned. */
  gap: number;
  /** `splits.off_role_count`. */
  offRoleCount: number;
  /** `splits.blue_win_prob`, in [0, 1]. */
  blueWinProb: number;
  /**
   * `splits.score_parts` (M18.13, 0045) read through `storedScoreParts`: the terms of the split's
   * score. `null` or absent for a row stored before the column; the reason then says what it said
   * before (`role-costs`).
   */
  scoreParts?: ScoreParts | null;
}

export type SideWord = 'Blue' | 'Red';

function sideWord(side: 'blue' | 'red'): SideWord {
  return side === 'blue' ? 'Blue' : 'Red';
}

/** `50–50`, with an en dash (STRATEGY §4.7). The word for a rounded 50 wherever a side would go. */
export const EVEN_ODDS = '50–50';

/**
 * The two labelled ends of the bar: `{ blue: 54, red: 46 }`, both from core's `favoredSide`
 * (its rounding and its range check): the favored side's `pct` and the rest of 100 for the
 * other; a rounded 50 is 50 / 50.
 */
export function barPercents(blueWinProb: number): { blue: number; red: number } {
  const { side, pct } = favoredSide(blueWinProb);
  if (side === null) return { blue: 50, red: 50 };
  return side === 'blue' ? { blue: pct, red: 100 - pct } : { blue: 100 - pct, red: pct };
}

/** `Blue 57%`, or `50–50` at a rounded 50: a split's odds named by its favored side. */
export function sideOdds(blueWinProb: number): string {
  return plain(sideOddsParts(blueWinProb));
}

export function sideOddsParts(blueWinProb: number): Rich {
  const { side, pct } = favoredSide(blueWinProb);
  return side === null ? [{ num: EVEN_ODDS }] : [`${sideWord(side)} `, { num: `${pct}%` }];
}

/**
 * The banded sentence (STRATEGY §4.3), from `oddsBand` on the favored side's rounded percentage.
 * `This was the fairest split these ten allow.` only on the bot's own pick (rank 1): a reroll is
 * by definition not the best-scoring split.
 */
export function oddsSentence(blueWinProb: number, rank: number): string {
  const band = oddsBand(blueWinProb);
  const { side } = favoredSide(blueWinProb);
  const name = side === null ? '' : sideWord(side);
  switch (band) {
    case 'even':
      return 'Dead even.';
    case 'coin-flip':
      return 'Basically a coin flip.';
    case 'slight':
      return `Close. ${name} has a slight edge.`;
    case 'favored':
      return `${name} is favored.`;
    case 'clear':
      return rank <= 1
        ? `${name} is clearly favored. This was the fairest split these ten allow.`
        : `${name} is clearly favored.`;
  }
}

/** `Rating gap 45 pts`: the gap always carries its unit and its label (STRATEGY §4.2 rule 3). */
export function ratingGapChip(gap: number): string {
  return plain(ratingGapChipParts(gap));
}

export function ratingGapChipParts(gap: number): Rich {
  return ['Rating gap ', { num: gapPoints(gap) }];
}

/** `45 pts`: a gap with its unit, wherever one is printed. */
export function gapPoints(gap: number): string {
  return `${gap} pts`;
}

/** How many play in a game: the `10` in `Main roles 10/10`. */
const SEATS = 10;

/**
 * `Main roles 10/10`, or `2 off main role` (STRATEGY §4.5).
 *
 * M14.41 (scene-walk gap 6, [NEW COPY]): on the **live** receipt, `noMain` is how many of the ten
 * have no main role on record (core's `resolveRoles(...).main === null`: flexible, so core never
 * calls them off-role). They are not counted as on-main: `Main roles 6/6 · 4 new`,
 * `2 off main role · 4 new`, and with all ten `No main roles yet`. History passes nothing and
 * reads as before (only `off_role_count` is stored).
 */
export function mainRolesChip(offRoleCount: number, noMain = 0): string {
  return plain(mainRolesChipParts(offRoleCount, noMain));
}

export function mainRolesChipParts(offRoleCount: number, noMain = 0): Rich {
  const fresh = Math.max(0, Math.min(SEATS, Math.round(noMain)));
  if (fresh >= SEATS) return [NO_MAIN_ROLES_CHIP];
  const counted: Rich =
    offRoleCount === 0
      ? ['Main roles ', { num: `${SEATS - fresh}/${SEATS - fresh}` }]
      : [{ num: `${offRoleCount}` }, ' off main role'];
  return fresh === 0 ? counted : [...counted, ' · ', { num: `${fresh}` }, ' new'];
}

/** The chip when none of the ten has a main role yet (M14.41 [NEW COPY]). */
export const NO_MAIN_ROLES_CHIP = 'No main roles yet';

/**
 * How many rerolls a lobby has: one fewer than the splits it stored, and never fewer than the
 * rank in play implies (the same rule as the Discord title, `teamsTitle`).
 */
function rerollsOf(rank: number, splitCount: number): number {
  return Math.max(splitCount - 1, rank - 1);
}

/** `Bot's pick #1 of 3`, or `Reroll 1 of 2 · pick #2` once an admin has rerolled. */
export function pickChip(rank: number, splitCount: number): string {
  return plain(pickChipParts(rank, splitCount));
}

export function pickChipParts(rank: number, splitCount: number): Rich {
  if (rank <= 1) return ["Bot's pick ", { num: `#1 of ${Math.max(1, splitCount)}` }];
  return [
    'Reroll ',
    { num: `${rank - 1} of ${rerollsOf(rank, splitCount)}` },
    ' · pick ',
    { num: `#${rank}` },
  ];
}

/** The three chips, in their order (STRATEGY §4.5). No win-chance chip: the bar says it. */
export function receiptChips(chosen: ReceiptSplit, splitCount: number, noMain = 0): string[] {
  return receiptChipParts(chosen, splitCount, noMain).map(plain);
}

/** `noMain`: live receipts only, see {@link mainRolesChipParts}. */
export function receiptChipParts(chosen: ReceiptSplit, splitCount: number, noMain = 0): Rich[] {
  return [
    ratingGapChipParts(chosen.gap),
    mainRolesChipParts(chosen.offRoleCount, noMain),
    pickChipParts(chosen.rank, splitCount),
  ];
}

/** `Reroll 1 of 2. `: the reroll post's first-line prefix (STRATEGY §4.9). Empty on rank 1. */
export function rerollPrefix(rank: number, splitCount: number): string {
  return rank <= 1 ? '' : `Reroll ${rank - 1} of ${rerollsOf(rank, splitCount)}. `;
}

/**
 * `<why-lower>` (STRATEGY §4.4), from `whyLower`'s answer. `repeat`, `variety` and `recent-fills`
 * (M18.13) come only from rows with stored score parts; older rows still get `role-costs`.
 */
export function whyLowerClause(why: WhyLowerScored): string {
  return plain(whyLowerClauseParts(why));
}

export function whyLowerClauseParts(why: WhyLowerScored): Rich {
  switch (why.kind) {
    case 'off-role':
      return ['with ', { num: `${why.k}` }, ' more off their main role'];
    case 'gap':
      return [
        'with a bigger rating gap (',
        { num: `${why.nextGap}` },
        ' vs ',
        { num: `${why.chosenGap}` },
        ' pts)',
      ];
    case 'repeat':
      return [`and it's ${LAST_GAMES_TEAMS} again`];
    case 'variety':
      return ['and it keeps more of ', ...varietyParts(why)];
    case 'recent-fills':
      return [`and it fills ${FILLED_RECENTLY}`];
    case 'role-costs':
      return ['and it scored a hair worse overall (repeated teams, recent fills or rounding)'];
  }
}

/** M18.13's reasons share their words between the reason line and the split rows. */
const LAST_GAMES_TEAMS = "last game's teams";
const FILLED_RECENTLY = 'someone who was filled more recently';

/** `last game's teammates together (4 vs 2 pairs)`, `(4 vs 1 pair)`: the variety reason's tail, both pair counts. */
function varietyParts(why: { chosenPairs: number; nextPairs: number }): Rich {
  return [
    "last game's teammates together (",
    { num: `${why.nextPairs}` },
    ' vs ',
    { num: `${why.chosenPairs}` },
    // The unit agrees with the number beside it: `(4 vs 1 pair)`, `(4 vs 2 pairs)`.
    why.chosenPairs === 1 ? ' pair)' : ' pairs)',
  ];
}

/** The one sentence for a split that had no runner-up to compare against (duo locks). */
export const ONLY_SPLIT = 'This was the only split that fit.';

/**
 * The reason line (STRATEGY §4.4): who differs between the split in play and the next one down
 * the stored list, and why that one ranked lower.
 *
 * `next` is the split ranked directly below `chosen` (the same pairing core's sentence uses).
 * With no `next`, a lobby that stored a single split says {@link ONLY_SPLIT}; a reroll that has
 * reached the last split has nobody below it and says nothing (`null`), because "the only split
 * that fit" would be false there. `null` also when the two are the same teams, or are not the
 * same ten (`describeSwap` throws): there is no honest swap to name.
 */
export function reasonLine(
  chosen: ReceiptSplit,
  next: ReceiptSplit | null,
  splitCount: number,
  name: (puuid: string) => string,
): string | null {
  const parts = reasonLineParts(chosen, next, splitCount, name);
  return parts === null ? null : plain(parts);
}

/** {@link reasonLine} in parts: names `strong`, numbers `num`. The one template for both. */
export function reasonLineParts(
  chosen: ReceiptSplit,
  next: ReceiptSplit | null,
  splitCount: number,
  name: (puuid: string) => string,
  /** ARAM (M14.16 design round 1): no lane words, the swap names the two people only. */
  laneless = false,
): Rich | null {
  if (next === null) return chosen.rank <= 1 && splitCount <= 1 ? [ONLY_SPLIT] : null;

  let swap: SwapDescription;
  try {
    swap = describeSwap(chosen, next);
  } catch {
    return null;
  }
  const tail: Rich = [
    ...sideOddsParts(next.blueWinProb),
    ', ',
    ...whyLowerClauseParts(whyLower(chosen, next)),
    '.',
  ];

  switch (swap.kind) {
    case 'identical':
      return null;
    case 'reshuffle':
      return ['Next best reshuffles ', { num: `${swap.moved}` }, ' players. ', ...tail];
    case 'one-for-one': {
      const a = { strong: name(swap.a.puuid) };
      const b = { strong: name(swap.b.puuid) };
      if (laneless) return ['Next best: swap ', a, ' and ', b, ". That's ", ...tail];
      return swap.sameLane
        ? [`Next best: swap the ${swap.a.role} players, `, a, ' and ', b, ". That's ", ...tail]
        : ['Next best: swap ', a, ` (${swap.a.role}) and `, b, ` (${swap.b.role}). `, ...tail];
    }
  }
}

/** `Upset!`: the full receipt's and Discord's word, after the result line. */
export const UPSET_SENTENCE = 'Upset!';
/** `Upset`: the compact row's tag (STRATEGY §4.7), beside the same result line. */
export const UPSET_TAG = 'Upset';

/**
 * The finished game's odds line (STRATEGY §4.5 item 3 and §4.9): `Blue was 54%. Blue won.`, the
 * winner's own rounded share, plus ` Upset!` when that share is under 50. A rounded 50 is
 * `50–50. Blue won.` (§4.7) and is never an upset.
 */
export function resultOddsLine(blueWinProb: number, winningSide: 100 | 200): string {
  const { line, upset } = resultOdds(blueWinProb, winningSide);
  return upset ? `${line} ${UPSET_SENTENCE}` : line;
}

/**
 * The result line without its `<Winner> won.`, for a poster whose headline already names the
 * winner (Tonight's `RED WINS`, M14.45): the games row's wording (05-design 5.5), `Red was 51%.`,
 * `Red was 46%. Upset!`, `50–50.`. Everywhere else prints {@link resultOddsLine}.
 */
export function resultOddsShort(blueWinProb: number, winningSide: 100 | 200): string {
  const { odds, upset } = resultOdds(blueWinProb, winningSide);
  return upset ? `${odds} ${UPSET_SENTENCE}` : odds;
}

/**
 * {@link resultOddsLine} in two: the line, and whether the winner was under 50. The full receipt
 * and Discord append `Upset!`; a compact row shows the `Upset` tag instead. `odds` is the line
 * without its `<Winner> won.` (`Blue was 54%.`, `50–50.`), for a row whose title already says who
 * won (M14.42, scene-walk gap 12: `Red won` once per games row).
 */
export function resultOdds(
  blueWinProb: number,
  winningSide: 100 | 200,
): { line: string; odds: string; upset: boolean } {
  const { side, pct } = favoredSide(blueWinProb);
  const winner: SideWord = winningSide === 100 ? 'Blue' : 'Red';
  const won = `${winner} won.`;
  if (side === null) return { line: `${EVEN_ODDS}. ${won}`, odds: `${EVEN_ODDS}.`, upset: false };
  const favoriteWon = (side === 'blue') === (winningSide === 100);
  const share = favoriteWon ? pct : 100 - pct;
  const odds = `${winner} was ${share}%.`;
  return { line: `${odds} ${won}`, odds, upset: !favoriteWon };
}

/**
 * The id of the receipt's `How the bot decided` disclosure on the tonight page. The Discord teams
 * embed's title links `/g/<slug>#how-the-bot-decided` (STRATEGY §4.9), so the receipt component
 * must put this id on its `<details>` (or the section holding it).
 */
export const RECEIPT_ANCHOR = 'how-the-bot-decided';

/* ---------------------------------------------------------------------------------------------
 * The page's receipt (M14.9): titles, the bar, the disclosure, calibration, split-less games,
 * the compact row. Discord does not print these today; they live here so it can.
 * ------------------------------------------------------------------------------------------- */

/** The receipt's title per state (STRATEGY §4.5, §4.10), sentence case as a card title (05-design 5.5). */
export const TITLE_BALANCED = 'Win chance';
export const TITLE_IN_GAME = 'Odds at kickoff';
export const TITLE_FINISHED = 'The odds were';
export const TITLE_PRE_GAME = 'Pre-game odds';

/** The corner label: `Game 4`. */
export const GAME_LABEL = 'Game';

/** The words inside the bar's two segments. */
export const SIDE_LABEL = { blue: 'BLUE', red: 'RED' } as const;

/** The visually hidden sentence the bar stands for (05-design.md 5.5). */
export function barSentence(blueWinProb: number): string {
  const { blue, red } = barPercents(blueWinProb);
  return `Blue ${blue} percent, Red ${red} percent.`;
}

export const BAR_CAPTION = 'The center line marks 50–50';

/** Both sides in words, for a split row with no big bar: `Blue 49% · 51% Red`. */
export function bothSidesOdds(blueWinProb: number): string {
  const { blue, red } = barPercents(blueWinProb);
  return `Blue ${blue}% · ${red}% Red`;
}

/**
 * The off-role line (STRATEGY §4.4), live only, where the seats are known. M14.41 (gap 6): with
 * nobody off-role, players with no main role on record are said as such rather than counted as
 * on-main: `4 people have no main role yet.`, `Nobody has a main role yet.` ([NEW COPY]).
 */
export function offRoleLineParts(
  seats: readonly { puuid: string; role: string }[],
  name: (puuid: string) => string,
  noMain = 0,
): Rich {
  const [only] = seats;
  if (only === undefined) {
    if (noMain >= SEATS) return [NOBODY_HAS_A_MAIN];
    if (noMain === 1) return [{ num: '1' }, ' person has no main role yet.'];
    if (noMain > 1) return [{ num: `${noMain}` }, ' people have no main role yet.'];
    return ["Everyone's on their main role."];
  }
  if (seats.length === 1) return [{ strong: name(only.puuid) }, ` is off their main role (${only.role}).`];
  return [{ num: `${seats.length}` }, ' people are off their main role.'];
}

/**
 * Core's stored sentence, as a **live** receipt prints it (M14.41 review). `explain()` in
 * `packages/core/src/balance/explain.ts` writes its roles clause as exactly `Everyone on a main
 * role.` when nobody is off-role, and core counts a player with no main role as on-main, so beside
 * `Main roles 6/6 · 4 new` it overclaims. With `noMain > 0` that one clause, matched whole in its
 * fixed place (right after the win clause), becomes `4 new, the rest on a main role.` or, all ten,
 * `No main roles yet.` ([NEW COPY]). Anything else, including a sentence that does not have the
 * clause there, is returned verbatim. The stored row is never changed; history passes 0.
 */
export function explanationShown(explanation: string, noMain = 0): string {
  const fresh = Math.max(0, Math.min(SEATS, Math.round(noMain)));
  if (fresh === 0) return explanation;
  const clause = fresh >= SEATS ? 'No main roles yet.' : `${fresh} new, the rest on a main role.`;
  return explanation.replace(CORE_EVERYONE_ON_MAIN, (_, win: string) => `${win} ${clause}`);
}

/** Core's win clause, then its exact all-on-main roles clause (`explain.ts`'s `rolesClause`). */
const CORE_EVERYONE_ON_MAIN = /^((?:Blue|Red) favored \d+%\.|Even 50%\.) Everyone on a main role\.(?= |$)/;

/** All ten without a main role on record (M14.41 [NEW COPY]). */
export const NOBODY_HAS_A_MAIN = 'Nobody has a main role yet.';

export const HOW_SUMMARY = 'How the bot decided';

/** The disclosure's intro (STRATEGY §4.6), closed by how many splits the run stored. */
export function howIntroParts(splitCount: number): Rich {
  const close =
    splitCount >= 3
      ? 'Here are its top three:'
      : splitCount === 2
        ? 'Here are its top two:'
        : 'Only one split fit:';
  return [
    'The bot tried all ',
    { num: '126' },
    ` ways to split these ten into two teams of five. For each one it put everyone in their best lane and scored it: the rating gap between the teams, plus a cost for every player off their main role (bigger if they were filled recently), plus a nudge against repeating last game's teams or putting last game's teammates back together. Lowest score wins. ${close}`,
  ];
}

export const IN_PLAY = 'In play';

export function splitRank(rank: number): string {
  return `#${rank}`;
}

export const SPLIT_GAP_LABEL = 'Rating gap';

/**
 * A split card's second term: `Main roles 10/10`, or `Off main role 2`. With all ten new it reads
 * `no main roles yet`, matching the chip (M14.45 [NEW COPY]; was `Main roles none yet`): the term
 * is then for screen readers only (`termHidden`).
 */
export function splitRolesTerm(
  offRoleCount: number,
  noMain = 0,
): { term: string; value: string; termHidden?: true } {
  // M14.41: the same ten in every split, so the same `noMain` (live only; history passes 0).
  const fresh = Math.max(0, Math.min(SEATS, Math.round(noMain)));
  if (offRoleCount !== 0) return { term: 'Off main role', value: `${offRoleCount}` };
  if (fresh >= SEATS) return { term: 'Main roles', value: 'no main roles yet', termHidden: true };
  return { term: 'Main roles', value: `${SEATS - fresh}/${SEATS - fresh}` };
}

export const THESE_TEAMS = 'These teams.';

/**
 * What a split row changes from the one in play (`describeSwap(inPlay, row)`), in the reason
 * line's words. `null` where the reason line also says nothing: the same teams, or no swap to name.
 */
export function changeFromChosenParts(
  swap: SwapDescription | null,
  name: (puuid: string) => string,
  laneless = false,
): Rich | null {
  if (swap === null) return null;
  switch (swap.kind) {
    case 'identical':
      return null;
    case 'reshuffle':
      return ['Reshuffles ', { num: `${swap.moved}` }, ' players.'];
    case 'one-for-one': {
      const a = { strong: name(swap.a.puuid) };
      const b = { strong: name(swap.b.puuid) };
      if (laneless) return ['Swap ', a, ' and ', b, '.'];
      return swap.sameLane
        ? [`Swap the ${swap.a.role} players, `, a, ' and ', b, '.']
        : ['Swap ', a, ` (${swap.a.role}) and `, b, ` (${swap.b.role}).`];
    }
  }
}

/** Why a row ranked below the one in play lost (`whyLower`); `closer` when its odds sat nearer 50/50. */
export function rankedLowerParts(why: WhyLowerScored, closer: boolean): Rich {
  const lead = closer ? 'Closer odds, but ranked lower: ' : 'Ranked lower: ';
  switch (why.kind) {
    case 'off-role':
      return [
        lead,
        { num: `${why.k}` },
        why.k === 1 ? ' more person off their main role.' : ' more people off their main role.',
      ];
    case 'gap':
      return [
        lead,
        'a bigger rating gap (',
        { num: `${why.nextGap}` },
        ' vs ',
        { num: `${why.chosenGap}` },
        ' pts).',
      ];
    case 'repeat':
      return [lead, `${LAST_GAMES_TEAMS} again.`];
    case 'variety':
      return [lead, 'more of ', ...varietyParts(why), '.'];
    case 'recent-fills':
      return [lead, `it fills ${FILLED_RECENTLY}.`];
    case 'role-costs':
      return [lead, 'it scored a hair worse overall (repeated teams, recent fills or rounding).'];
  }
}

/** A row ranked above the one in play: the reroll moved past it. */
export const REROLLED_PAST = 'Rerolled past this one.';

export const DISAGREE_TITLE = 'Why win chance and rating gap can disagree';
export const DISAGREE_BODY =
  "Win chance comes from everyone's Rating as it is. The rating gap is what the bot balances on, and it counts anyone off their main role as a bit weaker there, so the two can point slightly different ways.";

export const NOBODY_PICKED_TITLE = 'Nobody picked these teams.';
/**
 * The admin powers that sit before a roll (M14.68, flow audit; worded by design review): the mode
 * (M15) and the next game's Rated switch. Built into every fairness line that lists what admins can
 * do -- the receipt's Nobody picked these teams, `/how`'s What admins can't do, and the landing's
 * That's it -- so none of them leaves a power out.
 */
export const ADMIN_PRE_ROLL_POWERS = 'set the mode and whether a game is rated';

export const NOBODY_PICKED_BODY = `Admins can ${ADMIN_PRE_ROLL_POWERS}, but only before its teams are rolled. Then they can tap Roll teams and Reroll (which moves to the next pick on this list), and nothing else. Nobody can hand-edit a rating; ratings only move when a game ends.`;

export const BOT_NOTE_LABEL = "The bot's note:";

export const HOW_LINK = 'More on how it works';

/** Calibration shows its percentages only from this many games (STRATEGY §4.8). */
export const CALIBRATION_MIN_GAMES = 20;

/** From core's `calibration()` result; the percentages are its own rounding. */
export function calibrationLineParts(
  n: number,
  favoredWon: number,
  actualPct: number,
  expectedPct: number,
): Rich {
  return [
    'The side the bot favored won ',
    { num: `${favoredWon}` },
    ' of ',
    { num: `${n}` },
    ' games (',
    { num: `${actualPct}%` },
    '). It expected about ',
    { num: `${expectedPct}%` },
    '.',
  ];
}

export const CALIBRATION_FOLLOW_UP = 'The odds are honest when those two numbers are close.';

export function calibrationTooFewParts(n: number): Rich {
  return [
    "Not enough games yet to check the bot's odds (",
    { num: `${n}` },
    ' of ',
    { num: `${CALIBRATION_MIN_GAMES}` },
    ').',
  ];
}

export const CALIBRATION_WON = 'Won';
export const CALIBRATION_EXPECTED = 'Expected';

/** Games with no usable split (STRATEGY §4.10). */
export const PRE_GAME_NO_SPLIT = "Kustom didn't pick these teams. Odds from everyone's ratings going in.";
export const PRE_GAME_TEAMS_CHANGED =
  'Teams changed in the lobby after the roll, so these are the odds for the teams that actually played.';
export const NO_ODDS = 'No odds for this game.';

/** The compact row's reroll tag: `pick #2`. */
export function pickTag(rank: number): string {
  return `pick #${rank}`;
}

export const ARAM_LABEL = 'ARAM';

/**
 * The receipt's part of the page's one polite announcement on a reroll (05-design.md 6.4):
 * `Teams rerolled. Blue 51 percent, Red 49 percent.` The page owns the live region.
 */
export function rerollAnnouncement(blueWinProb: number): string {
  return `Teams rerolled. ${barSentence(blueWinProb)}`;
}
