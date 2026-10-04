/**
 * The post-game rule check (M15.2, brief D6, R7). Kustom never stops a pick; after the game it
 * says which side (mirror: which lane) kept the rule.
 *
 * - **broke**: a champion **known** to the mode's table and outside its side's pool.
 * - **unknown** (`couldn't check`), never broke: a champion missing from the table, a seat with no
 *   champion, and in mirror a lane missing a seat's position or with two seats of one side on it.
 * - A side **keeps** the rule with no broken seat; unknown seats are named but do not stop it. A
 *   side where not one seat could be checked is `unknown`.
 *
 * The input carries no player, and the output names champion keys and sides only: the line names
 * champions, never players. The words are the web's (`Red: Jinx isn't a tank.`).
 */

import { ROLES, type Role, type Side } from '../types';
import { type ChampionTable, inRegion, type Mode } from './model';

/** One seat of the recorded game: what `game_players` holds, minus who sat there. */
export interface CheckSeat {
  side: Side;
  /** `game_players.champion_id`; `null` if the block had none. */
  championId: number | null;
  /** The client's `detectedTeamPosition`; `null` when it detected none. */
  position: Role | null;
}

export type CheckVerdict = 'kept' | 'broke' | 'unknown';

export interface SideCheck {
  side: Side;
  verdict: CheckVerdict;
  /** Champions outside the side's pool, in lane order (no position last), then by key. */
  broke: number[];
  /** Champions that could not be checked, same order. */
  unknown: number[];
}

export interface LaneCheck {
  lane: Role;
  verdict: CheckVerdict;
  /** The lane's blue and red champions; `null` when the lane has no single seat for that side. */
  blue: number | null;
  red: number | null;
}

export type ModeCheck =
  | { kind: 'none' }
  | { kind: 'sides'; blue: SideCheck; red: SideCheck }
  | { kind: 'lanes'; lanes: LaneCheck[]; kept: number };

type SeatStatus = 'in' | 'out' | 'unknown';

const laneIndex = (position: Role | null) => (position === null ? ROLES.length : ROLES.indexOf(position));

export function checkMode(mode: Mode, seats: readonly CheckSeat[], table: ChampionTable): ModeCheck {
  switch (mode.id) {
    case 'normal':
    case 'fearless':
      return { kind: 'none' };
    case 'mirror':
      return checkMirror(seats);
    case 'class':
      return checkSides(seats, (championId) => {
        const tags = table.get(championId)?.tags ?? null;
        if (tags === null) return 'unknown';
        return tags.includes(mode.tag) ? 'in' : 'out';
      });
    case 'region':
      // Membership (M20 D1): a shared champion is `kept` for either of its regions; an empty set
      // (unaffiliated) is `broke` on any side; no row is `unknown`.
      return checkSides(seats, (championId, side) => {
        const facts = table.get(championId);
        if ((facts?.region ?? null) === null) return 'unknown';
        return inRegion(facts, side === 100 ? mode.blue : mode.red) ? 'in' : 'out';
      });
  }
}

function checkSides(
  seats: readonly CheckSeat[],
  status: (championId: number, side: Side) => SeatStatus,
): ModeCheck {
  return { kind: 'sides', blue: checkSide(seats, 100, status), red: checkSide(seats, 200, status) };
}

function checkSide(
  seats: readonly CheckSeat[],
  side: Side,
  status: (championId: number, side: Side) => SeatStatus,
): SideCheck {
  const ordered = seats
    .filter((seat) => seat.side === side)
    .map((seat) => ({ championId: seat.championId, lane: laneIndex(seat.position) }))
    .sort((a, b) => a.lane - b.lane || (a.championId ?? -1) - (b.championId ?? -1));
  const broke: number[] = [];
  const unknown: number[] = [];
  let checked = 0;
  for (const { championId } of ordered) {
    if (championId === null) continue;
    const s = status(championId, side);
    if (s === 'unknown') {
      unknown.push(championId);
      continue;
    }
    checked += 1;
    if (s === 'out') broke.push(championId);
  }
  const verdict: CheckVerdict = broke.length > 0 ? 'broke' : checked > 0 ? 'kept' : 'unknown';
  return { side, verdict, broke, unknown };
}

function checkMirror(seats: readonly CheckSeat[]): ModeCheck {
  const lanes = ROLES.map((lane): LaneCheck => {
    const one = (side: Side) => {
      const here = seats.filter((seat) => seat.side === side && seat.position === lane);
      return here.length === 1 ? (here[0]?.championId ?? null) : null;
    };
    const blue = one(100);
    const red = one(200);
    const verdict: CheckVerdict = blue === null || red === null ? 'unknown' : blue === red ? 'kept' : 'broke';
    return { lane, verdict, blue, red };
  });
  return { kind: 'lanes', lanes, kept: lanes.filter((lane) => lane.verdict === 'kept').length };
}
