import type { ClassTag, RuleOption, StandingModeId } from '@customs/core';
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

/** `Next game: Class wars, tanks only. Not rated.` and the region and mirror versions. */
export function ruleChosenNotice(rule: RuleOption, rated: boolean): string {
  switch (rule.id) {
    case 'class':
      return `Next game: Class wars, ${CLASS_PLURAL[rule.tag]} only. ${ratedWord(rated)}`;
    case 'region':
      return `Next game: Region wars. Sides are drawn when teams are rolled. ${ratedWord(rated)}`;
    case 'mirror':
      return `Next game: Mirror match. ${ratedWord(rated)}`;
  }
}

/** `Spin says: Tanks only.` */
export function spinNotice(rule: RuleOption): string {
  return `Spin says: ${ruleLabel(rule)}.`;
}

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
