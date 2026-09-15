import type { RoleValue, SideValue } from '@customs/db';
import { PLAYERS_PER_GAME } from '../lobbyState';

/**
 * Who plays and who sits (M2.5, "Choosing the ten, and who sits").
 *
 * **Everyone around is a candidate, spectators included.** A custom lobby caps each side at
 * five, so the eleventh friend has nowhere to stand but the spectator slot; treating that as
 * "volunteered to sit forever" would mean the same person watches every game and the referee
 * never notices. Recorded in `04-decisions.md`.
 *
 * Everything in this file is pure. The queries that fill a `PoolMember` in are in
 * `balance.ts`; the ordering, the ten and the seat pairing are here so they can be tested
 * without a database and read by M3.1 and M2.15 without being reimplemented.
 */

/** One person who is around, with everything the rotation and the balancer need. */
export interface PoolMember {
  playerId: string;
  puuid: string;
  /** `players.display_name`, or the fallback M3.10 will replace. Only used for text. */
  name: string;
  /** Where the client currently has them: `null` for a spectator or someone not placed yet. */
  side: SideValue | null;
  isSpectator: boolean;
  mainRole: RoleValue | null;
  secondaryRole: RoleValue | null;
  roleOverride: RoleValue | null;
  mu: number;
  sigma: number;
  /** Games this player has finished since 06:00 (M2.5, `night.ts`). */
  gamesTonight: number;
  /** Epoch ms of the last game they were in the lobby for and did not play, or `null`. */
  lastSitOutAt: number | null;
  /**
   * Fill protection's input (M7.6), handed to `BalancePlayer` untouched: games since the
   * balancer last filled this player off their role, `0` when their last game was one. `null`
   * or absent is "no fill in the window we read", which is the flat off-role penalty. Nothing
   * in the sit-out ordering reads it; it is the balancer's number, not the rotation's.
   */
  gamesSinceLastFill?: number | null;
}

/**
 * Who sits first. In one sentence for a friend: *whoever has played the most sits, and
 * between equals, whoever has gone longest without sitting.*
 *
 * 1. most games tonight first;
 * 2. then least recent sit-out first — somebody who has never sat out sorts first of all;
 * 3. then `puuid` ascending, so the answer never depends on member order and a tie the
 *    comparator cannot break is impossible.
 */
export function compareForSitOut(a: PoolMember, b: PoolMember): number {
  if (a.gamesTonight !== b.gamesTonight) return b.gamesTonight - a.gamesTonight;

  const lastA = a.lastSitOutAt ?? Number.NEGATIVE_INFINITY;
  const lastB = b.lastSitOutAt ?? Number.NEGATIVE_INFINITY;
  if (lastA !== lastB) return lastA - lastB;

  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

export interface Selection {
  /** The ten who play, in sit-out order (the same comparator, from the other end). */
  playing: PoolMember[];
  /** Everyone around minus the ten, first to sit first. Empty when exactly ten are around. */
  sitters: PoolMember[];
  /** True when everyone around has played the same number of games tonight (M2.15's copy). */
  tiedOnGames: boolean;
}

/** Thrown when the pool cannot produce exactly ten. A wrong ten is worse than no teams. */
export class SelectionError extends Error {
  override name = 'SelectionError';
}

/**
 * The ten who play tonight's next game, and the people who sit.
 *
 * Fewer than ten around is not an error the companion ever sees: the caller only gets here
 * with ten or more, and this throw is the bug net.
 */
export function selectTen(pool: readonly PoolMember[]): Selection {
  if (pool.length < PLAYERS_PER_GAME) {
    throw new SelectionError(`needs ten around, got ${pool.length}`);
  }

  const ordered = [...pool].sort(compareForSitOut);
  const sitters = ordered.slice(0, pool.length - PLAYERS_PER_GAME);
  const playing = ordered.slice(pool.length - PLAYERS_PER_GAME);

  if (playing.length !== PLAYERS_PER_GAME) {
    throw new SelectionError(`selected ${playing.length} players, not ten`);
  }

  const first = pool[0]?.gamesTonight ?? 0;
  return { playing, sitters, tiedOnGames: pool.every((member) => member.gamesTonight === first) };
}

/**
 * One seat that has to change hands. `sitter` is `null` when somebody has to move into an
 * open slot and nobody is sitting for them — ten around with one of them watching.
 */
export interface SeatMove {
  /** The person leaving the ten, whose slot the mover takes. */
  sitter: PoolMember | null;
  /** Somebody in the chosen ten who is currently in the spectator slot. */
  mover: PoolMember;
}

/**
 * The seating that does not match the split, which is expected rather than a problem: the
 * balancer picks the ten and the sides, and the client's current seating is just where people
 * happen to be standing.
 *
 * If the chosen ten include `k` people in the spectator slot then exactly `k` of the people
 * sitting out are currently on a team, and the two lists pair off in the order above. The
 * companion never moves anybody — that is M4.3, and only for the local player.
 *
 * M2.15 owns the words; this owns the pairing.
 */
export function planSeats(selection: Selection): SeatMove[] {
  const movers = selection.playing.filter((member) => member.isSpectator);
  const vacating = selection.sitters.filter((member) => !member.isSpectator);

  return movers.map((mover, index) => ({ sitter: vacating[index] ?? null, mover }));
}
