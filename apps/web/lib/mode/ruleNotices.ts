import type { ClassTag, PendingRule, RegionPair, RuleOption, StandingModeId } from '@customs/core';
import { REGION_NAMES, type RegionId } from '../champs/regions';
import { MODE_ANNOUNCEMENTS } from './copy';

/**
 * The one-line notices `POST /api/admin/mode` answers a write with (M15.3): the `notice` a no-JS
 * form post is sent back with, worded as the brief's announcer lines (§4). The card's own copy
 * (titles, statuses, panels) is M15.5's, in `copy.ts`.
 */

/** `tanks` for `Tank`: the plural the brief's lines use. */
export const CLASS_PLURAL: Record<ClassTag, string> = {
  Tank: 'tanks',
  Marksman: 'marksmen',
  Mage: 'mages',
  Assassin: 'assassins',
  Support: 'supports',
};

/** `POST /api/admin/mode`'s 409 for a rule pick with too few champions open (QA fix 2026-10-04). */
export const RULE_TOO_FEW_OPEN = 'That rule has too few champions open tonight.';

const STANDING_NAME: Record<StandingModeId, string> = { normal: 'Normal', fearless: 'Fearless' };

/** `Tanks only`, `Region wars`, `Mirror match`: the rule's short name. */
export function ruleLabel(rule: RuleOption): string {
  switch (rule.id) {
    case 'class': {
      const plural = CLASS_PLURAL[rule.tag];
      return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} only`;
    }
    case 'region':
      return 'Region wars';
    case 'mirror':
      return 'Mirror match';
  }
}

const ratedWord = (rated: boolean) => (rated ? 'Rated.' : 'Not rated.');

/** A region slug as its name (`Shadow Isles`); the slug itself for one the table does not know. */
const regionName = (region: string): string => REGION_NAMES[region as RegionId] ?? region;

/** `Blue: Zaun · Red: Noxus` (M20.1, the card's status and the notices). */
export function pairLine(pair: RegionPair): string {
  return `Blue: ${regionName(pair.blue)} · Red: ${regionName(pair.red)}`;
}

/** `Shurima vs Zaun` (M20.1, the redraw and change notices). */
export function pairVs(pair: RegionPair): string {
  return `${regionName(pair.blue)} vs ${regionName(pair.red)}`;
}

/**
 * `Next game: Class wars, tanks only. Not rated.` and the region and mirror versions. Region wars
 * names its pair (M20.1: `Next game: Region wars. Blue: Zaun · Red: Noxus. Not rated.`).
 */
export function ruleChosenNotice(rule: PendingRule, rated: boolean): string {
  switch (rule.id) {
    case 'class':
      return `Next game: Class wars, ${CLASS_PLURAL[rule.tag]} only. ${ratedWord(rated)}`;
    case 'region':
      return `Next game: Region wars. ${pairLine(rule)}. ${ratedWord(rated)}`;
    case 'mirror':
      return `Next game: Mirror match. ${ratedWord(rated)}`;
  }
}

/** `Spin says: Tanks only.`; region wars names its pair (`Spin says: Region wars. Blue: Zaun · Red: Noxus.`). */
export function spinNotice(rule: RuleOption | PendingRule): string {
  if ('blue' in rule) return `Spin says: ${ruleLabel(rule)}. ${pairLine(rule)}.`;
  return `Spin says: ${ruleLabel(rule)}.`;
}

/** A redraw or change of the next game's pair (M20.1). */
export function nextPairNotice(pair: RegionPair): string {
  return `Next game: ${pairVs(pair)}.`;
}

/** A redraw or change of this game's pair, after Roll (M20.1). */
export function thisPairNotice(pair: RegionPair): string {
  return `New regions: ${pairVs(pair)}. Picks already made stay, and the check uses the new regions.`;
}

/** Roll drew a fresh pair because the shown one went short (M20 D11; the roll answer's notice). */
export function shortPairRedrawnNotice(from: RegionPair, to: RegionPair): string {
  return `${pairVs(from)} ran short after the bans, so Roll drew ${pairVs(to)}.`;
}

/** The region refusals (409), M20.1's words. */
export const REGION_SHORT = 'That region has too few champions open tonight.';
export const SAME_REGION = 'Pick two different regions.';
export const PAIR_SHORT = "Those two regions don't have enough champions between them.";
export const NO_OTHER_PAIR = "There's no other pair of regions to draw.";
export const REGIONS_STAY = 'The game has started, so the regions stay.';
/** A region action with no region wars on its target: the card never offers it (M20.9: no new copy). */
export const NO_REGION_RULE = 'Region wars is not on for that game.';

/** `Next game is rated.` / `Next game is not rated.` */
export function ratedNotice(rated: boolean): string {
  return rated ? 'Next game is rated.' : 'Next game is not rated.';
}

/** A standing pick: `Rule cleared. Back to Fearless.` when it cleared a rule, else M14's line. */
export function standingNotice(standing: StandingModeId, clearedRule: boolean): string {
  return clearedRule ? `Rule cleared. Back to ${STANDING_NAME[standing]}.` : MODE_ANNOUNCEMENTS[standing];
}

/** Spin with every option excluded (every class and region too small under Fearless). */
export const NOTHING_TO_SPIN = 'Nothing to spin right now: every rule is too small tonight.';
