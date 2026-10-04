import type { ClassTag, Mode, RegionId, StandingModeId } from '@customs/core';
import type { RuleCheck } from '@customs/db/schemas';
import { championName } from '../champs/names';
import { REGION_NAMES, type RegionId as TableRegionId } from '../champs/regions';

/**
 * The mode's lines on the two Discord posts (M15.6; brief `m15.1-mode-of-the-night.md` §4).
 * Pure: plain data in, strings out. Never a separate message, never a new message type: the
 * teams post carries one line at the top of its description, the result post one or two lines
 * in its description, under the odds line and above the two columns.
 *
 * **Champions, never players** (R7, D6): the check line is built from the stored `rule_check`
 * verdict, which holds champion keys and sides only. No function here takes a name of a person.
 *
 * Every friend-facing string is the brief's §4 table; the few cases the table does not spell out
 * (both sides broke, a mirror lane that could not be checked) are marked where they are built.
 */

/** `Not rated, so no Rating change.`: the result post's line for any game played not rated. */
export { NOT_RATED_RESULT_LINE } from '../mode/notRated';

import { NOT_RATED_RESULT_LINE } from '../mode/notRated';

/** The teams post's line for a Normal or Fearless game switched to not rated. No link. */
export const NOT_RATED_TEAMS_LINE = 'This game: not rated.';

/** One class, every way the lines say it. */
interface ClassWords {
  /** `Tanks only`: the rule's name, which opens the check line. */
  rule: string;
  /** `tanks`: the plural in `This game: tanks only.`, `See the tanks` and `aren't tanks`. */
  plural: string;
  /** `a tank`: the singular with its article, `Jinx isn't a tank.` */
  one: string;
}

export const CLASS_WORDS: Readonly<Record<ClassTag, ClassWords>> = {
  Tank: { rule: 'Tanks only', plural: 'tanks', one: 'a tank' },
  Marksman: { rule: 'Marksmen only', plural: 'marksmen', one: 'a marksman' },
  Mage: { rule: 'Mages only', plural: 'mages', one: 'a mage' },
  Assassin: { rule: 'Assassins only', plural: 'assassins', one: 'an assassin' },
  Support: { rule: 'Supports only', plural: 'supports', one: 'a support' },
};

/** A region slug as the plain word (`Shadow Isles`); the slug itself if the table has no name. */
export function regionWord(region: RegionId): string {
  return REGION_NAMES[region as TableRegionId] ?? region;
}

/** What the teams post knows about the lobby's lock (`lobbies.lock_*`, taken at Roll). */
export interface TeamsModeInput {
  /** The locked mode: the rule when there is one, else the standing mode. */
  mode: Mode;
  rated: boolean;
  /**
   * The standing mode at Roll (M14.61): `fearless` puts `· Fearless` after the group's name in
   * the post's author line, also under a rule. Absent reads as no suffix.
   */
  standing?: StandingModeId | undefined;
  /**
   * M15.17 (`lobbies.lock_no_draw`): region wars was picked and could not be drawn at Roll, so
   * the game is the standing mode. Absent reads as false.
   */
  noDraw?: boolean | undefined;
}

/** M15.17: the teams line's rule half for a region wars that could not be drawn. */
export const REGION_NO_DRAW_TEAMS_LINE = "This game: region wars couldn't be drawn, too few open champions.";

const ratedWord = (rated: boolean): string => (rated ? 'Rated.' : 'Not rated.');

/**
 * The teams line's words in three parts (M15.6's words, laid out by M14.61): the rule half
 * (bold on the post), the rest, and the panel action the link is masked under (`null` for the
 * not-rated line, which links nothing). `null` for a plain rated Normal or Fearless game.
 */
export interface TeamsModeWords {
  rule: string;
  rest: string;
  action: string | null;
}

export function teamsModeWords(input: TeamsModeInput): TeamsModeWords | null {
  const { mode, rated } = input;
  switch (mode.id) {
    case 'normal':
    case 'fearless':
      // No link: the panel shows the standing mode, which would contradict the line.
      if (input.noDraw === true)
        return { rule: REGION_NO_DRAW_TEAMS_LINE, rest: ratedWord(rated), action: null };
      return rated ? null : { rule: NOT_RATED_TEAMS_LINE, rest: '', action: null };
    case 'class': {
      const words = CLASS_WORDS[mode.tag];
      return {
        rule: `This game: ${words.plural} only.`,
        rest: ratedWord(rated),
        action: `See the ${words.plural}`,
      };
    }
    case 'region':
      return {
        rule: 'This game: region wars.',
        rest: `Blue picks from ${regionWord(mode.blue)}, Red from ${regionWord(mode.red)}. ${ratedWord(rated)}`,
        action: 'See both pools',
      };
    case 'mirror':
      return {
        rule: 'This game: mirror match, same champion as your lane opponent.',
        rest: `Blind Pick lobby. ${ratedWord(rated)}`,
        action: 'How it works',
      };
  }
}

/**
 * The teams post's line, or `null` for a plain rated Normal or Fearless game (whose post carries
 * none). `url` is the group's mode panel, `/g/<slug>/mode`. Restyled by M14.61 (05-design 10.9):
 * the rule half is bold and the panel link is masked under its action; the words are M15.6's.
 *
 * - class: `**This game: tanks only.** Not rated. [See the tanks](<url>)`
 * - region: `**This game: region wars.** Blue picks from Ionia, Red from Noxus. Not rated. [See both pools](<url>)`
 * - mirror: `**This game: mirror match, same champion as your lane opponent.** Blind Pick lobby. Rated. [How it works](<url>)`
 * - Normal or Fearless switched to not rated: `**This game: not rated.**`, with no link: the Normal
 *   panel says games are rated as usual, so it would contradict the line.
 * - no URL: the same, without the link.
 */
export function teamsModeLine(input: TeamsModeInput, url: string | undefined): string | null {
  const words = teamsModeWords(input);
  if (words === null) return null;
  const parts = [`**${words.rule}**`];
  if (words.rest.length > 0) parts.push(words.rest);
  if (words.action !== null && url !== undefined) parts.push(`[${words.action}](${url})`);
  return parts.join(' ');
}

/** `Jinx`, `Jinx and Ashe`, `Jinx, Ashe and Lux`. */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Champion names are text, not markup: the same escape every name on these posts gets. */
// Champion names get the same escape set as player names (M14.61 r2: link, mention and heading syntax too).
const escapeMarkdown = (value: string): string => value.replace(/([`*_~|\\[\]()<>#])/g, '\\$1');

/** A stored champion key as its printed name (`Champion 950` for one newer than the pin). */
export type ChampionNamer = (key: number) => string;

const defaultNamer: ChampionNamer = (key) => championName(key);

/**
 * The pinned table first, then the client's own name for a champion newer than the pin (M15.10),
 * then `Champion <id>`: the order the Fearless pool and the scoreboard already name champions in.
 */
export function clientNamer(names: Readonly<Record<number, string>>): ChampionNamer {
  return (key) => championName(key, names[key] ?? null);
}

const SIDE_WORD = { 100: 'Blue', 200: 'Red' } as const;

const LANE_WORD = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' } as const;

/**
 * The result post's check line, from `games.rule_check`, or `null` when the game had no rule or
 * its verdict says nothing (`kind: 'none'`, or a stored shape that does not match its rule).
 *
 * - `Tanks only: both sides kept the rule.`
 * - `Tanks only: Blue kept the rule. Red: Jinx isn't a tank.` (`Jinx and Ashe aren't tanks.`)
 * - `Ionia vs Noxus: Blue kept the rule. Red: Garen isn't from Noxus.`
 * - `Mirror match: kept in 4 lanes. Mid: Ahri vs Syndra.` / `Mirror match: kept in every lane.`
 * - a side's champions that could not be checked: `Red: couldn't check Ambessa.`, after that
 *   side's part.
 */
export function ruleCheckLine(
  mode: Mode,
  check: RuleCheck,
  name: ChampionNamer = defaultNamer,
): string | null {
  const named = (key: number) => escapeMarkdown(name(key));
  if (mode.id === 'mirror') return check.kind === 'lanes' ? mirrorLine(check, named) : null;
  if (check.kind !== 'sides') return null;

  let head: string;
  let broke: (side: 100 | 200, champions: string[]) => string;
  if (mode.id === 'class') {
    const words = CLASS_WORDS[mode.tag];
    head = words.rule;
    broke = (_side, champions) =>
      champions.length === 1
        ? `${champions[0]} isn't ${words.one}.`
        : `${joinWords(champions)} aren't ${words.plural}.`;
  } else if (mode.id === 'region') {
    const own = { 100: regionWord(mode.blue), 200: regionWord(mode.red) } as const;
    head = `${own[100]} vs ${own[200]}`;
    broke = (side, champions) =>
      `${joinWords(champions)} ${champions.length === 1 ? "isn't" : "aren't"} from ${own[side]}.`;
  } else {
    return null;
  }

  const sides = [check.blue, check.red];
  const kept = sides.filter((side) => side.verdict === 'kept');
  // The opening sentence. The brief spells the first two; the last two are the cases it leaves
  // open (both broke, or no side kept with one that could not be checked at all) [NEW COPY].
  const opening =
    kept.length === 2
      ? 'both sides kept the rule.'
      : kept.length === 1
        ? `${SIDE_WORD[kept[0]?.side ?? 100]} kept the rule.`
        : sides.every((side) => side.verdict === 'broke')
          ? 'neither side kept the rule.'
          : 'not every pick could be checked.';

  const parts = [opening];
  for (const side of sides) {
    const word = SIDE_WORD[side.side];
    if (side.broke.length > 0) parts.push(`${word}: ${broke(side.side, side.broke.map(named))}`);
    if (side.unknown.length > 0) parts.push(`${word}: couldn't check ${joinWords(side.unknown.map(named))}.`);
  }
  return `${head}: ${parts.join(' ')}`;
}

/**
 * Mirror match, lane by lane: `kept in every lane`, `kept in 4 lanes`, `kept in 1 lane`, and
 * `kept in no lane` [NEW COPY]; then each broken lane (`Mid: Ahri vs Syndra.`, blue first) and
 * each lane that could not be checked (`Top: couldn't check.` [NEW COPY]: a missing position or
 * two seats on one lane has no single pair of champions to name).
 */
function mirrorLine(check: Extract<RuleCheck, { kind: 'lanes' }>, named: (key: number) => string): string {
  const kept = check.lanes.filter((lane) => lane.verdict === 'kept').length;
  const count =
    kept === check.lanes.length && kept > 0
      ? 'kept in every lane.'
      : kept === 0
        ? 'kept in no lane.'
        : `kept in ${kept} ${kept === 1 ? 'lane' : 'lanes'}.`;
  const parts = [count];
  for (const lane of check.lanes) {
    if (lane.verdict === 'broke' && lane.blue !== null && lane.red !== null) {
      parts.push(`${LANE_WORD[lane.lane]}: ${named(lane.blue)} vs ${named(lane.red)}.`);
    } else if (lane.verdict === 'unknown') {
      parts.push(`${LANE_WORD[lane.lane]}: couldn't check.`);
    }
  }
  return `Mirror match: ${parts.join(' ')}`;
}

/** What the result post knows about the game's mode (`games.rated`, `games.rule*`, `rule_check`). */
export interface ResultModeInput {
  rated: boolean;
  /**
   * The rule played and its stored verdict, or `null` for a standing-mode game. `names` (M15.10):
   * the client's own names for checked champions newer than the pinned table, by key.
   */
  rule: { mode: Mode; check: RuleCheck; names?: Readonly<Record<number, string>> } | null;
}

/**
 * The result post's mode lines, in order: the check line (when the game had a rule), then
 * `Not rated, so no Rating change.` (when it was not rated). Empty for a plain rated game, whose
 * post is unchanged.
 */
export function resultModeLines(input: ResultModeInput, name?: ChampionNamer): string[] {
  const names = input.rule?.names;
  const namer = name ?? (names === undefined ? defaultNamer : clientNamer(names));
  const check = input.rule === null ? null : ruleCheckLine(input.rule.mode, input.rule.check, namer);
  return [...(check === null ? [] : [check]), ...(input.rated ? [] : [NOT_RATED_RESULT_LINE])];
}
