import type {
  AwardCategory,
  ChallengeCategory,
  MysteryClueType,
  MysteryKind,
  MysteryPercentileBucket,
} from './types';

/**
 * Every sentence the daily game says, in Floodlit's voice: plain nouns, real numbers, no
 * emoji, no "EPIC", no named leaderboard. The visitor is anonymous. The League player is
 * the one we are exposing.
 *
 * **Two games** (M8.4). Nothing here names the rotation, says "today is award day" or
 * explains the parity: the card is whatever it is. `MYSTERY_TITLE` is untouched and
 * `AWARD_TITLE` sits beside it.
 */

export const MYSTERY_LABEL = 'Mystery';

export const MYSTERY_TITLE = 'Daily Mystery';

export const AWARD_TITLE = 'Guess the Award';

export function challengeTitle(kind: MysteryKind): string {
  return kind === 'award' ? AWARD_TITLE : MYSTERY_TITLE;
}

export const MYSTERY_CRIME = 'The crime';

export const MYSTERY_WHO = 'Who was it?';

export const MYSTERY_GUESS = 'Guess now';

export const MYSTERY_REVEAL = 'Reveal another clue';

export const MYSTERY_REVEAL_FIRST = 'Reveal a clue';

export const MYSTERY_NEED_HELP = 'Need help?';

export const MYSTERY_LOCKED = 'Locked in';

export const MYSTERY_CASE_CLOSED = 'Case closed';

export const MYSTERY_TODAY_CLOSED = "Today's case is closed";

export const MYSTERY_NEXT = 'Next mystery';

export const MYSTERY_CORRECT = 'Correct';

export const MYSTERY_WRONG = 'Wrong';

export const MYSTERY_FIRST = 'First detective';

export const MYSTERY_FIRST_TAKEN = "Someone has already claimed today's First Detective.";

export const MYSTERY_BLAME = 'Who did everyone blame?';

export const MYSTERY_YOUR_RESULT = 'Your result';

export const MYSTERY_COMMUNITY = "Today's community";

export const MYSTERY_EMPTY = 'No customs to expose yet. Play a few and the first mystery writes itself.';

export const MYSTERY_SHARE = 'Copy result';

export const MYSTERY_SHARE_DONE = 'Copied';

/**
 * Guess the Award's five divergent words (M8.4). Each one is the award day's reading of a
 * sentence above it that names *the thing*: a crime, a case, a mystery, a blame. Nothing an
 * award day shares with a mystery day is duplicated here — `Who was it?`, `Guess now`,
 * `Reveal a clue`, `Locked in`, `Correct` / `Wrong`, `Your result`, `Today's community` and
 * the empty state are true of both games and stay one constant each.
 */
export const AWARD_CRIME = 'The award';

export const AWARD_CASE_CLOSED = 'Award settled';

export const AWARD_TODAY_CLOSED = "Today's award is settled";

export const AWARD_NEXT = 'Next award';

export const AWARD_BLAME = 'Who did everyone pick?';

/** The words that differ between the two games, for one day's card. */
export interface GameCopy {
  /** `Daily Mystery` / `Guess the Award`. */
  title: string;
  /** Above the stat line on the play card: `The crime` / `The award`. */
  kicker: string;
  /** Above the answer on the closed card: `Case closed` / `Award settled`. */
  closedKicker: string;
  /** The result row's label: `Today's case is closed` / `Today's award is settled`. */
  todayClosed: string;
  /** The countdown's label: `Next mystery` / `Next award`. */
  next: string;
  /** The distribution heading: `Who did everyone blame?` / `Who did everyone pick?`. */
  blame: string;
}

const MYSTERY_COPY: GameCopy = {
  title: MYSTERY_TITLE,
  kicker: MYSTERY_CRIME,
  closedKicker: MYSTERY_CASE_CLOSED,
  todayClosed: MYSTERY_TODAY_CLOSED,
  next: MYSTERY_NEXT,
  blame: MYSTERY_BLAME,
};

const AWARD_COPY: GameCopy = {
  title: AWARD_TITLE,
  kicker: AWARD_CRIME,
  closedKicker: AWARD_CASE_CLOSED,
  todayClosed: AWARD_TODAY_CLOSED,
  next: AWARD_NEXT,
  blame: AWARD_BLAME,
};

/**
 * Today's vocabulary, in one lookup, so the view reads `copy.kicker` once instead of carrying
 * a ternary per sentence. The empty card has no kind and does not call this: nothing was
 * built, so it keeps the neutral Daily Mystery wording rather than guessing a game.
 */
export function gameCopy(kind: MysteryKind): GameCopy {
  return kind === 'award' ? AWARD_COPY : MYSTERY_COPY;
}

/**
 * `Daily Mystery #41` or `Guess the Award #7`. Each game counts its own cases, which is why
 * migration 0016 moved the unique to `(kind, challenge_number)`.
 */
export function challengeHeading(kind: MysteryKind, challengeNumber: number): string {
  return `${challengeTitle(kind)} #${challengeNumber}`;
}

export function mysterySomeoneLine(): string {
  return 'Someone in our customs went';
}

export function kdaLine(kills: number, deaths: number, assists: number): string {
  return `${kills} / ${deaths} / ${assists}`;
}

export function lockInLine(name: string): string {
  return `Lock in ${name}`;
}

export function itWasLine(name: string): string {
  return `It was ${name}`;
}

export function youGuessedLine(name: string): string {
  return `You guessed ${name}.`;
}

export function categoryLabel(category: ChallengeCategory): string {
  switch (category) {
    case 'disaster':
      return 'Disaster class';
    case 'monster':
      return 'Monster game';
    case 'farming':
      return 'Farming simulator';
    case 'raid_boss':
      return 'Raid boss';
    case 'ghost':
      return 'Where were you?';
    case 'kda':
      return 'Widest KDA';
    case 'damage':
      return 'Most damage';
    case 'gold':
      return 'Most gold';
    case 'vision':
      return 'Most vision';
    case 'mitigation':
      return 'Most damage mitigated';
    case 'cs':
      return 'Most CS';
    case 'objectives':
      return 'Most damage to objectives';
  }
}

/** The label the award's own number is printed under, in the hook and on the reveal. */
export function awardStatLabel(category: AwardCategory): string {
  switch (category) {
    case 'kda':
      return 'KDA';
    case 'damage':
      return HOOK_DAMAGE;
    case 'gold':
      return 'Gold';
    case 'vision':
      return 'Vision score';
    case 'mitigation':
      return 'Damage mitigated';
    case 'cs':
      return HOOK_CS;
    case 'objectives':
      return 'Objective damage';
  }
}

export function clueTypeLabel(type: MysteryClueType): string {
  switch (type) {
    case 'champion':
      return 'Champion';
    case 'role':
      return 'Role';
    case 'damage':
      return 'Damage';
    case 'cs':
      return 'CS';
    case 'gold':
      return 'Gold';
    case 'damage_taken':
      return 'Damage taken';
    case 'longest_life':
      return 'Longest life';
    case 'historical':
      return 'History';
  }
}

export function roleWord(role: string): string {
  return role.toUpperCase();
}

export function historicalChampLine(champion: string, times: number): string {
  return times === 1
    ? `This player has picked ${champion} once in our customs.`
    : `This player has picked ${champion} ${times} times in our customs.`;
}

export function historicalGamesLine(games: number): string {
  return games === 1
    ? 'This player has one custom on the board.'
    : `This player has ${games} customs on the board.`;
}

export function percentileLabel(bucket: MysteryPercentileBucket): string {
  switch (bucket) {
    case 'top-5':
      return 'Top 5%';
    case 'top-10':
      return 'Top 10%';
    case 'top-15':
      return 'Top 15%';
    case 'top-25':
      return 'Top 25%';
    case 'top-50':
      return 'Top 50%';
  }
}

export function cluesUsedLine(count: number): string {
  if (count === 0) return 'You solved it with zero clues.';
  if (count === 1) return 'You solved it with 1 clue.';
  return `You solved it with ${count} clues.`;
}

export function cluesUsedShort(count: number): string {
  return count === 1 ? '1 clue' : `${count} clues`;
}

/**
 * `First detective` stays the badge's name on both days — it is what this site calls whoever
 * gets the day right first, and the column behind it (`first_correct_at`) is one column. Only
 * the sentence under it changes, because "solve the mystery" is not what an award day was.
 */
export function firstDetectiveYou(kind: MysteryKind): string {
  return kind === 'award'
    ? 'You are the first person today to name the right player.'
    : 'You are the first person today to solve the mystery correctly.';
}

export function notAloneWrong(others: number): string {
  if (others <= 0) return 'You were the first wrong guess today.';
  if (others === 1) return 'You were not alone. 1 other guess was wrong today.';
  return `You were not alone. ${others} other guesses were wrong today.`;
}

export function fooledLine(wrongPercent: number): string {
  return `${wrongPercent.toFixed(1)}% of today's detectives were fooled.`;
}

/** Nobody is accused of winning an award, so the award day names them instead of blaming them. */
export function mostAccusedLine(kind: MysteryKind, name: string): string {
  return kind === 'award' ? `Most wrongly named: ${name}` : `Most falsely accused: ${name}`;
}

export function yourGuessLine(name: string): string {
  return `Your guess: ${name}`;
}

export function actualPlayerLine(name: string): string {
  return `Actual player: ${name}`;
}

export function communityAccuracyLine(percent: number): string {
  return `Current community accuracy: ${percent.toFixed(0)}%`;
}

export function attemptsSoFarLine(count: number): string {
  return count === 1 ? '1 attempt so far' : `${count} attempts so far`;
}

export function solvedInLine(ms: number): string {
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  return `${Math.round(seconds)} seconds`;
}

export function shareSolved(
  kind: MysteryKind,
  challengeNumber: number,
  cluesUsed: number,
  bucket: MysteryPercentileBucket | null,
): string {
  const clues = cluesUsed === 0 ? 'zero clues' : cluesUsed === 1 ? '1 clue' : `${cluesUsed} clues`;
  const rank = bucket === null ? '' : ` ${percentileLabel(bucket)}.`;
  return `${challengeHeading(kind, challengeNumber)} — solved with ${clues}.${rank}`;
}

/**
 * The missed line ends `There's another one tomorrow.` for **both** games (product, M8.4).
 * It used to promise another case, which alternation made untrue: tomorrow is the other game.
 */
export function shareMissed(kind: MysteryKind, challengeNumber: number): string {
  return `${challengeHeading(kind, challengeNumber)} — missed it. There's another one tomorrow.`;
}

export const HOOK_DEATHS = 'Deaths';
export const HOOK_KP = 'Kill participation';
export const HOOK_CS = 'CS';
export const HOOK_DURATION = 'Game';
export const HOOK_DAMAGE_TAKEN = 'Damage taken';
export const HOOK_DAMAGE = 'Damage';
