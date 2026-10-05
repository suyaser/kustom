import { displayKustom, KUSTOM_START } from '@customs/core';
import { type KickoffRow, kickoffFromRow, type LobbyKickoff } from '@customs/db/schemas';
import type { StoredSplit } from '@/components/receipt/types';
import { orientRun } from '../games/receipt';
import { inLaneOrder } from '../laneOrder';
import { renderWebName } from './copy';
import type { KickoffSeatView, KickoffView, MemberView, SeatView, TeamsView } from './types';

/**
 * The in-game block's teams (M21.5): the kickoff record (M21.4, `lobbies.kickoff_*`) turned into
 * the seats Tonight draws. Pure, so the three kinds are unit tests.
 *
 * - **Who is where** comes from the record, never the split: the swapped pair sits on its real side.
 * - **Roles**: a side whose players are exactly one of the split's sides keeps that side's roles
 *   (and off-role marks), in lane order. Any other side has no roles (the lane is not known until
 *   the end of game) and is in rating order, highest first (milestone OPEN item 4; lead's call,
 *   pending the designer's confirmation).
 * - **Odds**: `rolled` reads the chosen split's stored odds, flipped when the teams sat on swapped
 *   sides; `custom` and `unrolled` read the stored kickoff odds. Never recomputed here.
 */
export function kickoffView(
  record: LobbyKickoff,
  teams: TeamsView | null,
  members: readonly MemberView[],
): KickoffView {
  const byPuuid = new Map(members.map((member) => [member.puuid, member]));
  const splitSides = teams === null ? [] : [teams.blue, teams.red];
  const side = (puuids: readonly string[]): KickoffSeatView[] => {
    const split = splitSides.find((seats) => samePlayers(seats, puuids));
    if (split !== undefined) return inLaneOrder(split).map(fromSplitSeat);
    return puuids.map((puuid) => fromMember(puuid, byPuuid.get(puuid))).sort(byRating);
  };
  const blue = side(record.blue);
  const red = side(record.red);
  const playing = new Set([...record.blue, ...record.red]);
  return {
    kind: record.kind,
    swapped: record.kind === 'rolled' && record.swapped,
    blue,
    red,
    sitters: members.filter((member) => !playing.has(member.puuid)),
    blueWinProb:
      record.kind === 'rolled'
        ? teams === null
          ? null
          : record.swapped
            ? 1 - teams.blueWinProb
            : teams.blueWinProb
        : record.blueWinProb,
  };
}

/**
 * The lobby's kickoff record from its columns, or `null`. A row with a kind that does not parse is
 * logged (the reviewer's ask, M21.5) and read as no record: the page then behaves as before M21.
 */
export function readKickoff(row: KickoffRow, lobbyId: string): LobbyKickoff | null {
  return kickoffFromRow(row, (reason) =>
    console.warn(`tonight: lobby ${lobbyId} has a kickoff record this build cannot read (${reason})`),
  );
}

/**
 * The split's run as the real sides see it (M21.5, `rolled` on swapped sides): each split's teams
 * change sides and blue's chance becomes the old red's. Nothing else moves (the gap is unsigned,
 * the roles and the off-role count belong to the players), so the in-game receipt's bar and
 * sentence name the side each team is really on.
 */
export function swappedRun(stored: readonly StoredSplit[]): StoredSplit[] {
  return orientRun(stored, true);
}

/** Where the viewer plays at kickoff, or `null` (not on a team, or not known). */
export function viewerKickoffSeat(
  game: KickoffView | null,
  puuid: string | null,
): { side: 'blue' | 'red'; role: KickoffSeatView['role'] } | null {
  if (game === null || puuid === null) return null;
  const blue = game.blue.find((seat) => seat.puuid === puuid);
  if (blue !== undefined) return { side: 'blue', role: blue.role };
  const red = game.red.find((seat) => seat.puuid === puuid);
  return red === undefined ? null : { side: 'red', role: red.role };
}

function samePlayers(seats: readonly { puuid: string }[], puuids: readonly string[]): boolean {
  if (seats.length !== puuids.length) return false;
  const set = new Set(puuids);
  return seats.every((seat) => set.has(seat.puuid));
}

function fromSplitSeat(seat: SeatView): KickoffSeatView {
  return {
    puuid: seat.puuid,
    name: seat.name,
    nameSuffix: seat.nameSuffix ?? null,
    role: seat.role,
    rating: seat.rating,
    offRole: seat.offRole,
  };
}

function fromMember(puuid: string, member: MemberView | undefined): KickoffSeatView {
  return {
    puuid,
    name: member?.name ?? null,
    nameSuffix: member?.nameSuffix ?? null,
    role: null,
    // A kickoff player always has a member row (the record is read from them); 1200 if not, as
    // the kickoff odds rated them.
    rating: member?.rating ?? displayKustom(KUSTOM_START),
    offRole: false,
  };
}

function byRating(a: KickoffSeatView, b: KickoffSeatView): number {
  return (
    b.rating - a.rating ||
    renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
    (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0)
  );
}
