import type { RoleValue } from '@customs/db';
import { championLane } from '../champs/lanes';
import { listChampions } from '../champs/names';
import { LANE_ORDER } from '../laneOrder';
import type { FearlessPick } from './fold';
import type { FearlessChampion } from './types';

/**
 * How the fearless pool is shown (M10.2): lane of first lock, then A–Z inside the lane.
 *
 * {@link foldFearless} still answers uniqueness in first-appearance order. This is display
 * only — a five-game list is unreadable as a lock-order dump, and the role is the one the
 * scoreboard already stored, never guessed from the champion.
 */

export interface FearlessLaneGroup<T extends { role: RoleValue | null } = FearlessChampion> {
  role: RoleValue | null;
  champions: readonly T[];
}

/** One lane on the tonight card: bans first, then who is still open in that lane (M10.3). */
export interface FearlessLaneDisplay {
  role: RoleValue | null;
  banned: readonly FearlessChampion[];
  open: readonly FearlessChampion[];
}

export function presentFearless(
  picks: readonly FearlessPick[],
  nameOf: (id: number) => string,
): FearlessChampion[] {
  return [...picks]
    .map((pick) => ({ id: pick.id, name: nameOf(pick.id), role: pick.role }))
    .sort(compareFearless);
}

export function groupFearless<T extends { role: RoleValue | null; name: string }>(
  champions: readonly T[],
): FearlessLaneGroup<T>[] {
  const groups: FearlessLaneGroup<T>[] = [];
  for (const role of LANE_ORDER) {
    const inLane = sortByName(champions.filter((champion) => champion.role === role));
    if (inLane.length === 0) continue;
    groups.push({ role, champions: inLane });
  }
  const other = sortByName(champions.filter((champion) => champion.role === null));
  if (other.length > 0) groups.push({ role: null, champions: other });
  return groups;
}

/**
 * Roster champions not in the pool, filed under {@link championLane}. A locked id is gone
 * from every lane, including when the seat that locked it was a different role.
 */
export function availableFearless(banned: readonly { id: number }[]): FearlessChampion[] {
  const taken = new Set(banned.map((champion) => champion.id));
  const open: FearlessChampion[] = [];
  for (const champion of listChampions()) {
    if (taken.has(champion.id)) continue;
    const role = championLane(champion.id);
    if (role === null) continue;
    open.push({ id: champion.id, name: champion.name, role });
  }
  return open.sort(compareFearless);
}

/** Lanes that still have a ban or someone open. `other` is bans only — the roster has a lane. */
export function fearlessLanes(
  banned: readonly FearlessChampion[],
  open: readonly FearlessChampion[],
): FearlessLaneDisplay[] {
  const lanes: FearlessLaneDisplay[] = [];
  for (const role of LANE_ORDER) {
    const inLane = sortByName(banned.filter((champion) => champion.role === role));
    const stillOpen = sortByName(open.filter((champion) => champion.role === role));
    if (inLane.length === 0 && stillOpen.length === 0) continue;
    lanes.push({ role, banned: inLane, open: stillOpen });
  }
  const other = sortByName(banned.filter((champion) => champion.role === null));
  if (other.length > 0) lanes.push({ role: null, banned: other, open: [] });
  return lanes;
}

function sortByName<T extends { name: string }>(champions: readonly T[]): T[] {
  return [...champions].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function fearlessMatches(name: string, query: string): boolean {
  const needle = normalizeFearlessQuery(query);
  if (needle.length === 0) return true;
  return normalizeFearlessQuery(name).includes(needle);
}

export function fearlessExact(name: string, query: string): boolean {
  const needle = normalizeFearlessQuery(query);
  return needle.length > 0 && normalizeFearlessQuery(name) === needle;
}

export function normalizeFearlessQuery(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function compareFearless(a: FearlessChampion, b: FearlessChampion): number {
  const lane = laneRank(a.role) - laneRank(b.role);
  if (lane !== 0) return lane;
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

function laneRank(role: RoleValue | null): number {
  if (role === null) return LANE_ORDER.length;
  const index = LANE_ORDER.indexOf(role);
  return index === -1 ? LANE_ORDER.length : index;
}
