import type { RoleValue } from '@customs/db';
import type { WindowKind } from '../night';
import type { PlayerRef } from '../stats/types';

/**
 * What `/1v1` is made of (M8.5): lane series and one optional head-to-head, computed
 * on the server from the same window `/stats` reads.
 */

/** One pair who played the same role on opposite sides. */
export interface LaneMatchup {
  role: RoleValue;
  /** The leader — more wins — or the name-first player when the series is tied. */
  a: PlayerRef;
  b: PlayerRef;
  games: number;
  aWins: number;
  bWins: number;
  /** `a`'s win rate. `null` under five meetings, same bar `/stats` uses. */
  winRate: number | null;
  tied: boolean;
}

export interface LaneBoard {
  role: RoleValue;
  entries: LaneMatchup[];
}

/** Mean KDA across the games they played on opposite sides. */
export interface VersusKda {
  kills: number;
  deaths: number;
  assists: number;
}

export interface VersusChamp {
  champion: string;
  count: number;
}

export interface VersusMeeting {
  startedAt: string;
  durationS: number;
  winner: PlayerRef;
}

export interface VersusStreak {
  holder: PlayerRef;
  length: number;
}

/**
 * The two people named in `?a=` and `?b=`, in that order: left is `a`, right is `b`.
 * Wins, KDA and form are from `a`'s side of the ball.
 */
export interface HeadToHead {
  a: PlayerRef;
  b: PlayerRef;
  enemies: number;
  aWins: number;
  bWins: number;
  allies: number;
  allyWins: number;
  allyLosses: number;
  allyWinRate: number | null;
  lanes: LaneMatchup[];
  aKda: VersusKda | null;
  bKda: VersusKda | null;
  aChamp: VersusChamp | null;
  bChamp: VersusChamp | null;
  lastMeeting: VersusMeeting | null;
  streak: VersusStreak | null;
  /** Last five enemy results from `a`'s view, oldest first, so the right-most mark is the latest. */
  form: boolean[];
  verdict: string;
}

export type VersusPick =
  | { kind: 'idle' }
  | { kind: 'one' }
  | { kind: 'same' }
  | { kind: 'ready'; series: HeadToHead };

export interface VersusView {
  window: WindowKind;
  range: string | null;
  games: number;
  players: number;
  capped: boolean;
  cap: number;
  noRoleGames: number;
  leftPuuid?: string;
  rightPuuid?: string;
  /** Everyone with a counted row, name then puuid: the two `<select>`s. */
  roster: PlayerRef[];
  pick: VersusPick;
  lanes: LaneBoard[];
  tyrants: LaneMatchup[];
  heats: LaneMatchup[];
}
