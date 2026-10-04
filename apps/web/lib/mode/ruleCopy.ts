import type { ClassTag, Mode, RuleOption, StandingModeId } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { type RegionId, regionName } from '../champs/regions';
import { CLASS_PLURAL, ruleLabel } from './ruleNotices';

/**
 * The rules' words on Tonight (M15.5): the Mode card, its admin foot, the announcer, the panel and
 * the poster. Every string is the M15.1 brief's §4 (`redesign/briefs/m15.1-mode-of-the-night.md`),
 * except the ones marked [NEW COPY] in a comment, which the report lists. Plain data and string
 * functions, no zod, so client islands (the controls, the reveal, the announcer) may read it.
 */

/** What the card or the panel is about: a standing mode, a rule picked (region not drawn yet) or locked. */
export type ShownMode = Mode | RuleOption;

const STANDING_NAME: Record<StandingModeId, string> = { normal: 'Normal', fearless: 'Fearless' };

/** `tank` for `Tank`: the singular the check line and the empty-lane sentence use. */
export const CLASS_SINGULAR: Record<ClassTag, string> = {
  Tank: 'tank',
  Marksman: 'marksman',
  Mage: 'mage',
  Assassin: 'assassin',
  Support: 'support',
};

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** The card title and the panel heading. */
export function modeName(mode: ShownMode): string {
  switch (mode.id) {
    case 'normal':
    case 'fearless':
      return STANDING_NAME[mode.id];
    case 'class':
      return 'Class wars';
    case 'region':
      return 'Region wars';
    case 'mirror':
      return 'Mirror match';
  }
}

/** True for a rule (class, region, mirror), false for a standing mode. */
export function isRule(mode: ShownMode): mode is Exclude<ShownMode, { id: 'normal' } | { id: 'fearless' }> {
  return mode.id !== 'normal' && mode.id !== 'fearless';
}

/** The two drawn regions, when the shown region wars has them (after Roll). */
export function drawnRegions(mode: ShownMode): { blue: RegionId; red: RegionId } | null {
  if (mode.id !== 'region' || !('blue' in mode)) return null;
  return { blue: mode.blue as RegionId, red: mode.red as RegionId };
}

/** `Tanks only`; under Fearless `Tanks only · 12 open`. */
export function classStatus(tag: ClassTag, open: number | null): string {
  const label = ruleLabel({ id: 'class', tag });
  return open === null ? label : `${label} · ${open} open`;
}

export const REGION_STATUS_BEFORE_ROLL = 'Sides drawn when teams are rolled.';
export const REGION_VS = 'vs';
export const MIRROR_STATUS = 'Same champion as your lane opponent';

/** M15.14: on a Fearless night, `Same champion as your lane opponent · 138 open`. */
export function mirrorStatus(open: number | null): string {
  return open === null ? MIRROR_STATUS : `${MIRROR_STATUS} · ${open} open`;
}

/** Under the status: `This game only. Then back to Fearless.` */
export function oneGameLine(standing: StandingModeId): string {
  return `This game only. Then back to ${STANDING_NAME[standing]}.`;
}

/** The card's action for a rule. */
export function ruleAction(mode: ShownMode): string | null {
  switch (mode.id) {
    case 'class':
      return `See the ${CLASS_PLURAL[mode.tag]}`;
    case 'region':
      return 'See both pools';
    case 'mirror':
      return 'How it works';
    default:
      return null;
  }
}

/** `11 tanks` beside `Your lane support ·` (one champion: `1 tank`). */
export function classLaneCount(tag: ClassTag, count: number): string {
  return `${count} ${count === 1 ? CLASS_SINGULAR[tag] : CLASS_PLURAL[tag]}`;
}

/** The answer band's jump: `Tanks for support` / `Ionia for support`; mirror has none. */
export function ruleLaneLabel(mode: ShownMode, role: RoleValue, side: 'blue' | 'red' | null): string | null {
  if (mode.id === 'class') return `${capital(CLASS_PLURAL[mode.tag])} for ${role}`;
  const regions = drawnRegions(mode);
  if (regions !== null && side !== null) return `${regionName(regions[side])} for ${role}`;
  return null;
}

/** In game: `This game: tanks only.` / `This game: Ionia vs Noxus.`; mirror none. */
export function inGameRuleLine(mode: ShownMode): string | null {
  if (mode.id === 'class') return `This game: ${CLASS_PLURAL[mode.tag]} only.`;
  const regions = drawnRegions(mode);
  if (regions !== null) return `This game: ${regionName(regions.blue)} vs ${regionName(regions.red)}.`;
  return null;
}

/**
 * [NEW COPY] Region wars could not be drawn at Roll (fewer than two regions with 8 open): the game
 * was locked on the standing mode and the rule waits (decision row 2026-10-04).
 */
export const REGION_DIDNT_APPLY =
  "Region wars didn't apply to this game: too few open champions for two regions. It's still set for the next game.";

/* ---------------------------------------------------------------------------
 * The admin foot.
 * ------------------------------------------------------------------------- */

export const OPTGROUP_CLASS = 'Class wars (one game)';
export const OPTGROUP_REGION = 'Region wars (one game)';
export const OPTGROUP_MIRROR = 'Mirror match (one game)';
export const TOO_FEW_OPEN = ' (too few open)';

/** A select option's label. */
export function optionLabel(rule: RuleOption): string {
  if (rule.id === 'region') return 'Region wars, sides drawn at roll';
  return ruleLabel(rule);
}

/** Under the select while a rule is chosen. */
export function ruleSentence(standing: StandingModeId): string {
  return `For the next game only. Then back to ${STANDING_NAME[standing]}.`;
}

export const SPIN = 'Spin';
export const SPINNING = 'Spinning…';

/** `Next game: Mages only.` (a standing pick after Roll: `Next game: Normal.`). */
export function nextGameLine(next: RuleOption | StandingModeId): string {
  return `Next game: ${typeof next === 'string' ? STANDING_NAME[next] : ruleLabel(next)}.`;
}

export const RATED_LABEL = 'Rated';
/** Design round 2: the switch is about the next game; pairs with the off sentence (the announcer's line). */
export const RATED_ON = 'Next game is rated.';
/** Lead ruling (M15.5 design round 1): the switch is about the next game, as the announcer says. */
export const RATED_OFF = 'Next game is recorded, not rated.';

/* ---------------------------------------------------------------------------
 * The announcer.
 * ------------------------------------------------------------------------- */

/** `Spin says: Tanks only.`; region wars says when its sides are drawn. */
export function spinAnnouncement(rule: RuleOption): string {
  return rule.id === 'region'
    ? 'Spin says: Region wars. Sides are drawn when teams are rolled.'
    : `Spin says: ${ruleLabel(rule)}.`;
}

/** The rule game was recorded and the card is back on the standing mode. */
export function ruleDoneLine(standing: StandingModeId): string {
  return `This game's rule is done. Back to ${STANDING_NAME[standing]}.`;
}

/* ---------------------------------------------------------------------------
 * The panel.
 * ------------------------------------------------------------------------- */

const NOBODY_STOPPED_SIDES =
  'Nobody is stopped in champ select; the result post says which side kept the rule.';

function ratedTail(rated: boolean): string {
  return rated ? 'Rated: Ratings move as usual.' : "Not rated: Ratings don't move.";
}

/** `a`, or `an` before a vowel: `a tank`, `an assassin`, `an Assassin`. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * M15.19: `Everyone picks a tank this game: any champion Riot lists as a Tank.`, one shape per class
 * (`an assassin`, `as an Assassin`), then the shared sentences.
 */
export function classSentence(tag: ClassTag, rated: boolean): string {
  const one = CLASS_SINGULAR[tag];
  return `Everyone picks ${article(one)} ${one} this game: any champion Riot lists as ${article(tag)} ${tag}. ${NOBODY_STOPPED_SIDES} ${ratedTail(rated)}`;
}

/** `46 tanks of 172 champions` */
export function classCounts(tag: ClassTag, count: number, total: number): string {
  return `${count} ${CLASS_PLURAL[tag]} of ${total} champions`;
}

/** A lane with no champion of the class: `No tank is usually played here. Any tank on this list may go adc.` */
export function classEmptyLane(tag: ClassTag, role: RoleValue): string {
  const one = CLASS_SINGULAR[tag];
  return `No ${one} is usually played here. Any ${one} on this list may go ${role}.`;
}

export function regionSentence(blue: RegionId, red: RegionId, rated: boolean): string {
  return `Blue picks only from ${regionName(blue)}, Red only from ${regionName(red)}. ${NOBODY_STOPPED_SIDES} ${ratedTail(rated)}`;
}

export const REGION_PANEL_BEFORE_ROLL = 'The two regions are drawn when teams are rolled.';

export function mirrorSentence(rated: boolean): string {
  const base =
    'You and your lane opponent play the same champion. It needs a Blind Pick lobby. Nobody is stopped in champ select; the result post says which lanes kept it.';
  return `${base} ${rated ? 'Rated as usual.' : "Not rated: Ratings don't move."}`;
}

/** Normal's panel: the rules, one sentence each (05-design 8.5.3). */
export const NORMAL_RULE_LIST = [
  'Class wars: everyone picks from one class, for one game.',
  'Region wars: each side picks from its own region, for one game.',
  'Mirror match: same champion as your lane opponent, for one game.',
  'Spin lets the bot choose one.',
] as const;
