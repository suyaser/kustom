import type { Route } from 'next';
import type { PageGroup } from '../groups/pageGroup';
import { groupBase } from '../nav';
import type { LaneChoice } from './view';

/**
 * The mode panel's address (M14.30; 05-design.md 8.5.1): `/g/<slug>/mode`, with `?lane=<role>` to
 * open it on one lane. Not a nav destination (no tab, no More card): only the Mode card, the answer
 * band and Discord link here.
 */
export function modePanelHref(group: Pick<PageGroup, 'slug'>, lane: LaneChoice = 'all'): Route {
  const base = `${groupBase(group)}/mode`;
  return (lane === 'all' ? base : `${base}?lane=${lane}`) as Route;
}

/** The Mode card on Tonight, where the controls are: `/g/<slug>#mode`. */
export function modeCardHref(group: Pick<PageGroup, 'slug'>): Route {
  return `${groupBase(group)}#mode` as Route;
}

/** Reset fearless without JS: the confirm page (M14.30), admins only. */
export function modeResetConfirmHref(group: Pick<PageGroup, 'slug'>): Route {
  return `${groupBase(group)}/mode/reset` as Route;
}

/** The element ids the panel returns focus to on close (05-design.md 8.6 rule 4). */
export const MODE_CARD_LINK_ID = 'mode-card-link';
export const MODE_ANSWER_LINK_ID = 'mode-answer-link';
