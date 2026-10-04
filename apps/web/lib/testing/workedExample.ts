import { type BalancePlayer, balance, type Role } from '@customs/core';
import type { PoolMember } from '../ingest/selection';

/**
 * The worked example, as the API sees it (`docs/00-product.md`, "Worked example"; the mu and
 * sigma columns are the M1.4 table in `docs/02-milestones.md`).
 *
 * It is the pinned case for the balancer and it is the pinned case for the Discord embeds,
 * deliberately the same ten friends: a snapshot here is comparable line for line with the
 * layout in `docs/05-design.md`. Nothing is hand-computed — the split and the explanation
 * come from `balance()`, and the result fixture's deltas come from `rateGame()`.
 */

export interface WorkedPlayer {
  name: string;
  /**
   * The all-time Kustom Rating the balancer reads since M18.2 (M18.5): `mu × 60`, the numbers
   * core's own worked-example test uses, so the balance picks the same split it did on mu.
   */
  r: number;
  mu: number;
  sigma: number;
  mainRole: Role;
  secondaryRole: Role;
}

export const WORKED_ROSTER: readonly WorkedPlayer[] = [
  { name: 'Bilal', r: 1713, mu: 28.55, sigma: 4.8, mainRole: 'adc', secondaryRole: 'mid' },
  { name: 'Hana', r: 1434, mu: 23.9, sigma: 4.6, mainRole: 'top', secondaryRole: 'mid' },
  { name: 'Iris', r: 1578, mu: 26.3, sigma: 4.9, mainRole: 'jungle', secondaryRole: 'top' },
  { name: 'Karim', r: 1551, mu: 25.85, sigma: 4.7, mainRole: 'mid', secondaryRole: 'adc' },
  { name: 'Lena', r: 2088, mu: 34.8, sigma: 4.5, mainRole: 'adc', secondaryRole: 'jungle' },
  { name: 'Nadia', r: 1266, mu: 21.1, sigma: 5.1, mainRole: 'mid', secondaryRole: 'support' },
  { name: 'Omar', r: 1469.4, mu: 24.49, sigma: 4.6, mainRole: 'top', secondaryRole: 'support' },
  { name: 'Rami', r: 1638, mu: 27.3, sigma: 4.8, mainRole: 'jungle', secondaryRole: 'mid' },
  { name: 'Theo', r: 1419, mu: 23.65, sigma: 4.9, mainRole: 'support', secondaryRole: 'adc' },
  { name: 'Yuki', r: 1134, mu: 18.9, sigma: 5.0, mainRole: 'support', secondaryRole: 'top' },
];

/** Everyone in the worked example is settled (core's test uses the same 20). */
export const WORKED_GAMES = 20;

/** `puuid-bilal`. The same ids core's own test uses, so the sort order is alphabetical. */
export function workedPuuid(name: string): string {
  return `puuid-${name.toLowerCase()}`;
}

export function workedBalancePlayers(): BalancePlayer[] {
  return WORKED_ROSTER.map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    r: player.r,
    n: WORKED_GAMES,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
  }));
}

/** The ten as `lobby_members` rows would arrive, ready for `buildTeamsInput`. */
export function workedPool(overrides: Partial<PoolMember> = {}): PoolMember[] {
  return WORKED_ROSTER.map((player, index) => ({
    playerId: `player-${index}`,
    puuid: workedPuuid(player.name),
    name: player.name,
    side: index < 5 ? 100 : 200,
    isSpectator: false,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
    r: player.r,
    n: WORKED_GAMES,
    gamesTonight: 0,
    lastSitOutAt: null,
    ...overrides,
  }));
}

/** puuid to display name, the way `loadNames` returns it. */
export function workedNames(): Map<string, string | null> {
  return new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.name]));
}

/** `balance()` on the ten, with no previous split. Splits 1, 2, 3 and their sentences. */
export function workedBalance(): ReturnType<typeof balance> {
  return balance({ players: workedBalancePlayers(), duos: [], lastSplit: null });
}
