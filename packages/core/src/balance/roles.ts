/**
 * The role rules, in one place, so the scorer and the explanation cannot disagree about who
 * is off-role. Spec: M1.4 brief, "Role edge cases".
 */

import type { Role } from '../types';
import type { BalancePlayer } from './types';

export type RoleTier = 'main' | 'secondary' | 'fill';

/** The three role fields of a player, as `players` plus tonight's `lobby_members.role_override` hold them. */
export type RoleProfile = Pick<BalancePlayer, 'mainRole' | 'secondaryRole' | 'roleOverride'>;

/** Tonight's effective pair. The tonight page prints it as `<main> · <secondary>` (M3.6). */
export interface ResolvedRoles {
  main: Role | null;
  secondary: Role | null;
}

/**
 * Tonight's main and backup for a player:
 * - `roleOverride` becomes the main; the usual main becomes the secondary; the declared
 *   secondary drops to fill. An override equal to the usual main is a no-op.
 * - A `null` main (after the override rule) is flexible: every role is a main.
 */
export function resolveRoles(player: RoleProfile): ResolvedRoles {
  const override = player.roleOverride ?? null;
  if (override !== null && override !== player.mainRole) {
    return { main: override, secondary: player.mainRole };
  }
  return { main: player.mainRole, secondary: player.secondaryRole };
}

/** Which `roleDrop` tier a role earns for a player. `main` is never off-role; the others are. */
export function roleTier(player: RoleProfile, role: Role): RoleTier {
  const { main, secondary } = resolveRoles(player);
  if (main === null || role === main) return 'main';
  if (role === secondary) return 'secondary';
  return 'fill';
}

export function isOffRole(player: RoleProfile, role: Role): boolean {
  return roleTier(player, role) !== 'main';
}
