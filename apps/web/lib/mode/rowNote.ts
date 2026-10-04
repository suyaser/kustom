import type { Mode } from '@customs/core';
import { REGION_NAMES, type RegionId } from '../champs/regions';
import { ruleLabel } from './ruleNotices';

/**
 * The rule's name on a tape tile and a `/games` row (M15.19; decision 2026-10-04): `Tanks only ·
 * not rated`, `Ionia vs Noxus · not rated`, `Mirror match` (rated), in the shape of ARAM's `ARAM ·
 * not rated`, so the night stays legible ("which one was the tanks game?"). The kept/broke check
 * line stays off these rows (brief D6): it lives on the poster, the game page and Discord.
 *
 * Plain strings and no zod, so a client island could read it.
 */

/** The rows' `not rated`, as the tape already prints it. */
export const ROW_NOT_RATED = 'not rated';

const SEPARATOR = '·';

/** `Tanks only`, `Ionia vs Noxus`, `Mirror match`; null for a standing mode (no rule to name). */
export function ruleRowName(rule: Mode | null): string | null {
  if (rule === null) return null;
  switch (rule.id) {
    case 'class':
      return ruleLabel(rule);
    case 'region':
      return `${regionLabel(rule.blue)} vs ${regionLabel(rule.red)}`;
    case 'mirror':
      return ruleLabel(rule);
    default:
      return null;
  }
}

/**
 * A rule game's row note: its name, then ` · not rated` when no Rating moved. Null for a game with
 * no rule, which keeps whatever the row said before.
 */
export function ruleRowNote(rule: Mode | null, rated: boolean): string | null {
  const name = ruleRowName(rule);
  if (name === null) return null;
  return rated ? name : `${name} ${SEPARATOR} ${ROW_NOT_RATED}`;
}

/** A region id the pinned table may not know (a newer seed): its words, capitalised, never blank. */
function regionLabel(id: string): string {
  return (
    REGION_NAMES[id as RegionId] ??
    id
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}
