/**
 * The one-line explanation for a split. Spec: M1.4 brief, "Explanation string".
 * Clauses joined by a single space, each ending in a full stop, numerals throughout.
 */

import { ROLES } from '../types';
import { describeSwap } from './receipt';
import { isOffRole } from './roles';
import type { Assignment, BalancePlayer, Split } from './types';

type Named = Pick<BalancePlayer, 'puuid' | 'name' | 'mainRole' | 'secondaryRole' | 'roleOverride'>;

function inLaneOrder(side: readonly Assignment[]): Assignment[] {
  return [...side].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

function winClause(blueWinProb: number): string {
  const p = Math.round(blueWinProb * 100);
  if (p > 50) return `Blue favored ${p}%.`;
  if (p < 50) return `Red favored ${100 - p}%.`;
  return 'Even 50%.';
}

function rolesClause(split: Split, byPuuid: ReadonlyMap<string, Named>): string {
  const off: string[] = [];
  for (const side of [split.blue, split.red]) {
    for (const { puuid, role } of inLaneOrder(side)) {
      const player = byPuuid.get(puuid);
      if (player !== undefined && isOffRole(player, role)) off.push(`${player.name} at ${role}`);
    }
  }
  if (off.length === 0) return 'Everyone on a main role.';
  if (off.length === 1) return `${off[0]?.replace(' at ', ' off-role at ')}.`;
  return `${off.length} off-role: ${off.join(', ')}.`;
}

function nextBestClause(split: Split, next: Split, byPuuid: ReadonlyMap<string, Named>): string {
  const name = (a: Assignment): string => byPuuid.get(a.puuid)?.name ?? a.puuid;
  const swap = describeSwap(split, next);
  // `moved` counts players; the sentence has always counted swaps, two players each.
  const change =
    swap.kind === 'one-for-one'
      ? `swap ${name(swap.a)} and ${name(swap.b)}`
      : `${swap.kind === 'reshuffle' ? swap.moved / 2 : 0} swaps`;
  const offRole = next.offRoleCount === split.offRoleCount ? '' : ` with ${next.offRoleCount} off-role`;
  return `Next best: ${change}, gap ${next.gap}${offRole}.`;
}

/**
 * The sentence for `split`, given the split that follows it in the stored list (or `null` when
 * it is the last). `players` supplies names and role settings; only those ten are looked up.
 */
export function explain(split: Split, next: Split | null, players: readonly Named[]): string {
  const byPuuid = new Map(players.map((p) => [p.puuid, p]));
  const clauses = [winClause(split.blueWinProb), rolesClause(split, byPuuid), `Gap ${split.gap}.`];
  if (next !== null) clauses.push(nextBestClause(split, next, byPuuid));
  return clauses.join(' ');
}
