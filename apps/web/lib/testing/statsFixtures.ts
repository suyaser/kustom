import type { RoleValue, SideValue } from '@customs/db';
import type { RawGameFacts } from '../stats/rawFacts';
import type { StatsGame, StatsPlayer, StatsRow } from '../stats/types';

/**
 * Hand-built games for `/stats` (M5.4).
 *
 * The brief's acceptance is explicit that these numbers are arithmetic and *should not need the
 * database*, so this is the whole test corpus: a compact way to write "ten people played, this
 * side won, these two were on jungle" and get the two input types `lib/stats/fold.ts` reads.
 *
 * A seat is a key (`lena`), optionally with the role that player played (`lena:jungle`) — and
 * for the climb tests, the pair of `mu` values the fold stored on the row.
 */

/** `lena`, `lena:jungle`, or the long form when the row needs its ratings. */
export type Seat =
  | string
  | {
      key: string;
      role?: RoleValue | null | undefined;
      mu?: [number, number] | undefined;
      kills?: number | undefined;
      deaths?: number | undefined;
      assists?: number | undefined;
      gold?: number | undefined;
      damageToChamps?: number | undefined;
      cs?: number | undefined;
      championId?: number | null | undefined;
    };

export interface GameSpec {
  id?: string;
  /** Anything `Date.parse` reads. Two games may share one; `lcuGameId` breaks the tie. */
  at: string;
  lcuGameId?: string | null;
  durationS?: number;
  /** Which side won. Blue by default, because a fixture should not be surprising. */
  winner?: SideValue;
  blue: Seat[];
  red: Seat[];
  /**
   * A game the fold has not rated — every backfilled game until `rebuild-ratings` runs. It
   * still counts everywhere `gateGame` counts it; it just carries no climb.
   */
  unrated?: boolean;
  /** The client's `gameMode`. Absent is Rift (`/games` treats a missing mode as CLASSIC). */
  gameMode?: string | null;
  /** Parsed `games.raw` extras. Absent is a game whose blob named none of them. */
  rawFacts?: RawGameFacts | null;
  /**
   * The chosen split's stored chance for blue (M8.2). Absent is a game with no lobby and no
   * split — a backfilled custom, which is most of the history and is in none of that section.
   */
  blueWinProb?: number | null;
}

/** The rating every seat carries unless the spec names one: the middle of the seed range. */
const DEFAULT_MU = 25;

function seatOf(seat: Seat): {
  key: string;
  role: RoleValue | null;
  mu: [number, number] | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damageToChamps: number;
  cs: number;
  championId: number | null;
} {
  if (typeof seat !== 'string') {
    return {
      key: seat.key,
      role: seat.role ?? null,
      mu: seat.mu ?? null,
      kills: seat.kills ?? 0,
      deaths: seat.deaths ?? 0,
      assists: seat.assists ?? 0,
      gold: seat.gold ?? 0,
      damageToChamps: seat.damageToChamps ?? 0,
      cs: seat.cs ?? 0,
      championId: seat.championId ?? null,
    };
  }
  const [key, role] = seat.split(':');
  return {
    key: key as string,
    role: (role ?? null) as RoleValue | null,
    mu: null,
    kills: 0,
    deaths: 0,
    assists: 0,
    gold: 0,
    damageToChamps: 0,
    cs: 0,
    championId: null,
  };
}

function rowOf(seat: Seat, side: SideValue, unrated: boolean): StatsRow {
  const parsed = seatOf(seat);
  const mu = parsed.mu ?? [DEFAULT_MU, DEFAULT_MU];
  return {
    playerId: playerIdOf(parsed.key),
    puuid: puuidOf(parsed.key),
    side,
    role: parsed.role,
    muBefore: unrated ? null : mu[0],
    muAfter: unrated ? null : mu[1],
    championId: parsed.championId,
    kills: parsed.kills,
    deaths: parsed.deaths,
    assists: parsed.assists,
    gold: parsed.gold,
    damageToChamps: parsed.damageToChamps,
    cs: parsed.cs,
  };
}

export function playerIdOf(key: string): string {
  return `p-${key}`;
}

export function puuidOf(key: string): string {
  return `u-${key}`;
}

let counter = 0;

/** One game, from five keys a side. Over 300 seconds and ten rows unless the spec says otherwise. */
export function statsGame(spec: GameSpec): StatsGame {
  counter += 1;
  const unrated = spec.unrated === true;
  return {
    id: spec.id ?? `g-${counter}`,
    startedAt: new Date(spec.at).toISOString(),
    lcuGameId: spec.lcuGameId === undefined ? `lcu-${counter}` : spec.lcuGameId,
    durationS: spec.durationS ?? 1_800,
    winningSide: spec.winner ?? 100,
    gameMode: spec.gameMode ?? null,
    rawFacts: spec.rawFacts ?? null,
    blueWinProb: spec.blueWinProb ?? null,
    rows: [
      ...spec.blue.map((seat) => rowOf(seat, 100, unrated)),
      ...spec.red.map((seat) => rowOf(seat, 200, unrated)),
    ],
  };
}

/** The ten who are only there to make a game ten people long. */
export const FILLER = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'];

/**
 * A game with `blue` and `red` filled out to five a side from {@link FILLER}, so a test that is
 * about two people does not have to name ten.
 */
export function tenPlayerGame(spec: Omit<GameSpec, 'blue' | 'red'> & Partial<GameSpec>): StatsGame {
  const named = [...(spec.blue ?? []), ...(spec.red ?? [])];
  const used = new Set(named.map((seat) => seatOf(seat).key));
  const spare = FILLER.filter((key) => !used.has(key));
  const blue = [...(spec.blue ?? [])];
  const red = [...(spec.red ?? [])];
  while (blue.length < 5) blue.push(nextSpare(spare));
  while (red.length < 5) red.push(nextSpare(spare));
  return statsGame({ ...spec, blue, red });
}

/** A loud failure beats a game with nine seats in it and a test that says nothing. */
function nextSpare(spare: string[]): string {
  const key = spare.shift();
  if (key === undefined) throw new Error('statsFixtures: not enough filler players for ten seats');
  return key;
}

/** `lena` → Lena, with no main role; `lena:top` → Lena, whose main is top. */
export function statsPlayer(spec: string): StatsPlayer {
  const [key, mainRole] = spec.split(':');
  const name = key as string;
  return {
    playerId: playerIdOf(name),
    puuid: puuidOf(name),
    name: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    mainRole: (mainRole ?? null) as RoleValue | null,
  };
}

/**
 * Everybody named in a list of games, plus any extra spec (`lena:top` to give somebody a main).
 * A roster is never the point of a test, so it is derived rather than written out.
 */
export function rosterFor(games: readonly StatsGame[], mains: readonly string[] = []): StatsPlayer[] {
  const byMain = new Map(mains.map((spec) => [spec.split(':')[0] as string, spec]));
  const keys = new Set<string>();
  for (const game of games) {
    for (const row of game.rows) keys.add(row.playerId.replace(/^p-/, ''));
  }
  for (const spec of mains) keys.add(spec.split(':')[0] as string);
  return [...keys].map((key) => statsPlayer(byMain.get(key) ?? key));
}
