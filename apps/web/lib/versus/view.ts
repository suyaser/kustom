import { windowRangeLabel } from '../board/window';
import type { StatsInput } from '../stats/view';
import {
  headToHead,
  laneBoards,
  laneHeats,
  laneTyrants,
  noRoleGames,
  playersWhoPlayed,
  versusGames,
  versusRoster,
} from './fold';
import type { VersusPick, VersusView } from './types';

/**
 * The whole of `/1v1`, assembled from the same window read `/stats` makes (M8.5).
 *
 * Pure. `loadVersus` reads the rows and calls this; the component renders what comes back.
 * `leftPuuid` / `rightPuuid` are the two picks, keyed the way every other page keys a person.
 * The list that actually folds is {@link versusGames}: played customs on Summoner's Rift.
 */

export interface VersusInput extends StatsInput {
  leftPuuid?: string | undefined;
  rightPuuid?: string | undefined;
}

function pickOf(input: VersusInput, counted: ReturnType<typeof versusGames>): VersusPick {
  const left = input.leftPuuid;
  const right = input.rightPuuid;
  if (left === undefined && right === undefined) return { kind: 'idle' };
  if (left === undefined || right === undefined) return { kind: 'one' };
  if (left === right) return { kind: 'same' };

  const roster = new Map(input.players.map((player) => [player.puuid, player]));
  const a = roster.get(left);
  const b = roster.get(right);
  if (a === undefined || b === undefined) return { kind: 'idle' };

  const series = headToHead(counted, input.players, a.playerId, b.playerId);
  if (series === null) return { kind: 'idle' };
  return { kind: 'ready', series };
}

export function versusView(input: VersusInput): VersusView {
  const counted = versusGames(input.games);
  const first = counted[0];

  return {
    window: input.window,
    range:
      counted.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            first === undefined ? null : new Date(first.startedAt),
            input.timeZone,
          ),
    games: counted.length,
    players: playersWhoPlayed(counted),
    capped: input.capped,
    cap: input.cap,
    noRoleGames: noRoleGames(counted),
    ...(input.leftPuuid === undefined ? {} : { leftPuuid: input.leftPuuid }),
    ...(input.rightPuuid === undefined ? {} : { rightPuuid: input.rightPuuid }),
    roster: versusRoster(counted, input.players),
    pick: pickOf(input, counted),
    lanes: laneBoards(counted, input.players),
    tyrants: laneTyrants(counted, input.players),
    heats: laneHeats(counted, input.players),
  };
}

/** Stable href extras so a window tap keeps the two picks. */
export function versusQuery(left?: string, right?: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (left !== undefined) query.a = left;
  if (right !== undefined) query.b = right;
  return query;
}
