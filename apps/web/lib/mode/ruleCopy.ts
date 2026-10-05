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

/** What the card or the panel is about: a standing mode or a rule (region wars always with its pair, M20 D9). */
export type ShownMode = Mode;

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

/** Region wars' two regions (before Roll the row's pair, after Roll the lock's), else null. */
export function drawnRegions(mode: ShownMode): { blue: RegionId; red: RegionId } | null {
  if (mode.id !== 'region') return null;
  return { blue: mode.blue as RegionId, red: mode.red as RegionId };
}

/** `Tanks only`; under Fearless `Tanks only · 12 open`. */
export function classStatus(tag: ClassTag, open: number | null): string {
  const label = ruleLabel({ id: 'class', tag });
  return open === null ? label : `${label} · ${open} open`;
}

export const REGION_VS = 'vs';
export const MIRROR_STATUS = 'Same champion as your lane opponent';

/** M15.14: on a Fearless night, `Same champion as your lane opponent · 138 open`. */
export function mirrorStatus(open: number | null): string {
  return open === null ? MIRROR_STATUS : `${MIRROR_STATUS} · ${open} open`;
}

/**
 * The filling host line (M15.16, back since the 2026-10-04 QA fix): while a lobby fills and the next
 * game's rule is mirror, the lobby may already be a Draft Pick one (made before mirror was picked,
 * or by hand), and Start a lobby only asks for Blind Pick when it makes the lobby (M17.17).
 */
export const MIRROR_HOST_LEAD = 'Mirror match next.';
export const MIRROR_HOST_FILLING_REST =
  'It needs a Blind Pick lobby. If this one is Draft Pick, the host opens a Blind Pick custom in League and everyone moves to it.';
export const MIRROR_HOST_FILLING_LINE = `${MIRROR_HOST_LEAD} ${MIRROR_HOST_FILLING_REST}`;

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

/** Region wars had no pair to draw at Roll: the card says so (M15.5 design round 1). */
export const REGION_DIDNT_APPLY =
  "Region wars didn't apply to this game: too few open champions for two regions. It's still set for the next game.";

/* ---------------------------------------------------------------------------
 * The admin foot.
 * ------------------------------------------------------------------------- */

export const OPTGROUP_CLASS = 'Class wars (one game)';
export const OPTGROUP_REGION = 'Region wars (one game)';
export const OPTGROUP_MIRROR = 'Mirror match (one game)';
export const TOO_FEW_OPEN = ' (too few open)';

/** A select option's label: the rule's short name (region wars' regions are drawn when it is chosen, M20 D9). */
export function optionLabel(rule: RuleOption): string {
  return ruleLabel(rule);
}

/** Under the select while a rule is chosen. */
export function ruleSentence(standing: StandingModeId): string {
  return `For the next game only. Then back to ${STANDING_NAME[standing]}.`;
}

export const SPIN = 'Spin';
export const SPINNING = 'Spinning…';

/**
 * Region wars' pair on the admin foot (M20.1 as amended for M20 D9; M20.10): a new random pair,
 * and one select per side showing its region, a region under 8 open reading `Targon (too few open)`
 * and disabled. No `Random` option: Redraw is the random.
 */
export const REDRAW_REGIONS = 'Redraw regions';
export const REGION_SELECT_LABELS: Record<'blue' | 'red', string> = {
  blue: "Blue's region",
  red: "Red's region",
};
/**
 * [NEW COPY, M20.10] A side select's submit, shown once its region differs (always without JS),
 * as `Set mode` is for the mode select: a select never posts on change (arrowing a closed select
 * on Windows fires `change` per option). M20.1 names no button; the designer/product to confirm.
 */
export const SET_REGION = 'Set region';
/** After Roll, this game's pair's legend (05-design 8.3.1); the next game's pair has none. */
export const THIS_GAME_HEADING = 'This game';
/** M20 D11: the shown next-game pair went short (bans grew after it was drawn); everyone, under the status. */
export const REGION_PAIR_SHORT =
  'Too few champions are open for this pair now. Roll will draw new regions unless an admin changes them.';

/**
 * M20.16 (product's copy): the next game's pair while a lobby is balanced or in game, for everyone,
 * under this game's status: `Next game: Region wars, Ixtal vs Ionia.`
 */
export function nextRegionLine(pair: { blue: string; red: string }): string {
  return `Next game: Region wars, ${regionName(pair.blue as RegionId)} vs ${regionName(pair.red as RegionId)}.`;
}

/**
 * `Next game: Mages only.` (a standing pick after Roll: `Next game: Normal.`). With `rated` it says
 * Rated too (QA fix 2026-10-04): `Next game: Tanks only. Rated.`; with no mode (the next game plays
 * the same mode as this one) only Rated: `Next game: not rated.`
 */
export function nextGameLine(next: RuleOption | StandingModeId | null, rated: boolean | null = null): string {
  const mode = next === null ? null : `${typeof next === 'string' ? STANDING_NAME[next] : ruleLabel(next)}.`;
  if (rated === null) return `Next game: ${mode ?? ''}`.trimEnd();
  const ratedWords = rated ? 'rated.' : 'not rated.';
  if (mode === null) return `Next game: ${ratedWords}`;
  return `Next game: ${mode} ${ratedWords.charAt(0).toUpperCase()}${ratedWords.slice(1)}`;
}

export const RATED_LABEL = 'Rated';
/** Design round 2: the switch is about the next game; pairs with the off sentence (the announcer's line). */
export const RATED_ON = 'Next game is rated.';
/** Lead ruling (M15.5 design round 1): the switch is about the next game, as the announcer says. */
export const RATED_OFF = 'Next game is recorded, not rated.';
/**
 * [NEW COPY, M20.18] The switch while the lobby is balanced acts on this game (decision row
 * 2026-10-05, "until the game starts, mode changes are for this game"): RATED_ON / RATED_OFF with
 * `This game`, as the route's own notice says it (`ratedNotice(…, 'this')`).
 */
export const RATED_ON_THIS = 'This game is rated.';
export const RATED_OFF_THIS = 'This game is recorded, not rated.';

/* ---------------------------------------------------------------------------
 * The announcer.
 * ------------------------------------------------------------------------- */

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

/** A lane where none of a side's region usually plays: `No champion from Ionia usually plays here. Any of them will do.` */
export function regionEmptyLane(region: RegionId): string {
  return `No champion from ${regionName(region)} usually plays here. Any of them will do.`;
}

export function regionSentence(blue: RegionId, red: RegionId, rated: boolean): string {
  return `Blue picks only from ${regionName(blue)}, Red only from ${regionName(red)}. ${NOBODY_STOPPED_SIDES} ${ratedTail(rated)}`;
}

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
