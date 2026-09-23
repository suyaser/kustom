import { balance, displayRating, isOffRole, type Role, rateGame } from '@customs/core';
import { EMPTY_FEARLESS } from '../fearless/types';
import type {
  LobbyView,
  MemberView,
  ResultSeatView,
  ResultView,
  SeatView,
  SplitChoice,
  TapeEntry,
  TeamsView,
  TonightSnapshot,
} from '../tonight/types';
import { WORKED_ROSTER, workedBalance, workedPuuid } from './workedExample';

/**
 * The tonight page's states, built from the worked example (`docs/00-product.md`) — the same
 * ten friends the balancer tests and the Discord embeds use, so a component test here is
 * comparable line for line with the embed snapshot and with `docs/05-design.md`.
 *
 * Nothing is hand-computed: the split, the explanation and the off-role marker come from
 * `balance()` and core's `isOffRole`, the ratings from `displayRating`, and the result's after
 * ratings from `rateGame`.
 */

/**
 * 06:00 in Africa/Cairo on 2026-09-08, which is 03:00 UTC. Any fixed instant in the past
 * would do; it has to be in the past so that {@link JOINED_LONG_AGO}, which sits inside this
 * night, is older than the three-second "just joined" window whenever the suite runs.
 */
export const FIXTURE_NIGHT_START = '2026-09-08T03:00:00.000Z';

export function workedMembers(count = WORKED_ROSTER.length): MemberView[] {
  return WORKED_ROSTER.slice(0, count).map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
    isSpectator: false,
    // Long enough ago that the three-second "just joined" marker is off by default.
    joinedAt: JOINED_LONG_AGO,
    rating: displayRating(player.mu),
    // **Nobody has been placed by default** (M4.11). A lobby that has just been balanced is a
    // lobby nobody has moved in yet, so the fixture's honest value is `null` — which keeps the
    // side line on screen, the state every test written before M4.11 was written against.
    side: null,
  }));
}

/** Nobody in the fixtures is "new": this lobby filled up long before the suite ran. */
export const JOINED_LONG_AGO = '2026-09-08T20:00:00.000Z';

/** One more person than the lobby can seat: the eleventh is in the spectator slot. */
export function extraMember(overrides: Partial<MemberView> = {}): MemberView {
  return {
    puuid: 'puuid-deniz',
    name: 'Deniz',
    mainRole: 'jungle',
    secondaryRole: 'top',
    roleOverride: null,
    isSpectator: true,
    joinedAt: JOINED_LONG_AGO,
    rating: 1300,
    // A spectator has no side in the client at all: the one row `switch_side` can never move.
    side: null,
    ...overrides,
  };
}

export interface TeamsFixtureOptions {
  /** Which of the three stored splits is promoted. 0 is the balancer's own choice. */
  chosen?: number;
  /** Everyone around who is not one of the ten. */
  sitters?: MemberView[];
  members?: MemberView[];
}

/**
 * A balanced lobby: the promoted split's seats, its stored explanation, and the lobby's three
 * splits so the reroll control has something to promote.
 */
export function workedTeams(options: TeamsFixtureOptions = {}): TeamsView {
  const chosen = options.chosen ?? 0;
  const balanced = workedBalance();
  const split = balanced.splits[chosen];
  const explanation = balanced.explanations[chosen];
  if (split === undefined || explanation === undefined) throw new Error('workedTeams: no such split');

  const members = options.members ?? workedMembers();
  const byPuuid = new Map(members.map((member) => [member.puuid, member]));
  const seats = (side: readonly { puuid: string; role: Role }[]): SeatView[] =>
    side.map((assignment) => {
      const member = byPuuid.get(assignment.puuid);
      if (member === undefined) throw new Error(`workedTeams: ${assignment.puuid} is not in the lobby`);
      return {
        puuid: assignment.puuid,
        name: member.name,
        role: assignment.role,
        rating: member.rating,
        offRole: isOffRole(member, assignment.role),
        // The loader's own rule: the seat carries the member row's side, whatever it is.
        liveSide: member.side,
      };
    });

  const splits: SplitChoice[] = balanced.splits.map((_, index) => ({
    id: `split-${index + 1}`,
    rank: index + 1,
    isChosen: index === chosen,
  }));

  return {
    splitId: `split-${chosen + 1}`,
    explanation,
    blue: seats(split.blue),
    red: seats(split.red),
    sitters: options.sitters ?? [],
    blueWinProb: split.blueWinProb,
    splits,
  };
}

/**
 * The same split with the ten **seated where it put them** (M4.11): every blue seat's
 * `liveSide` is 100 and every red seat's is 200, which is the lobby the group has finished
 * moving in and the one state where the side line is not drawn.
 *
 * `moved` names the seats that are somewhere else — `{ [puuid]: 200 }` for a blue seat still
 * sitting on red, or `null` for somebody the client has not placed. Nothing else about the
 * split changes, which is what makes "the cards are byte-identical" a test of the cards and not
 * of the fixture.
 */
export function seatedOnTheirSides(
  teams: TeamsView,
  moved: Readonly<Record<string, 100 | 200 | null>> = {},
): TeamsView {
  const seat = (seats: readonly SeatView[], side: 100 | 200): SeatView[] =>
    seats.map((one) => ({ ...one, liveSide: one.puuid in moved ? (moved[one.puuid] ?? null) : side }));

  return { ...teams, blue: seat(teams.blue, 100), red: seat(teams.red, 200) };
}

/** The worked example played out: red wins, and every after rating is `rateGame`'s. */
export function workedResult(overrides: Partial<ResultView> = {}): ResultView {
  const teams = workedTeams();
  const byPuuid = new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player]));
  const ratingsOf = (seats: readonly SeatView[]) =>
    seats.map((seat) => {
      const player = byPuuid.get(seat.puuid);
      if (player === undefined) throw new Error(`workedResult: ${seat.puuid} is not in the roster`);
      return { mu: player.mu, sigma: player.sigma };
    });

  const before = { blue: ratingsOf(teams.blue), red: ratingsOf(teams.red) };
  const after = rateGame(before.blue, before.red, 200);

  const seatsOf = (seats: readonly SeatView[], side: 100 | 200): ResultSeatView[] =>
    seats.map((seat, index) => ({
      puuid: seat.puuid,
      name: seat.name,
      role: seat.role,
      side,
      muBefore: (side === 100 ? before.blue : before.red)[index]?.mu ?? null,
      muAfter: (side === 100 ? after.blue : after.red)[index]?.mu ?? null,
    }));

  return {
    winningSide: 200,
    durationS: 2_052,
    blueWinProb: teams.blueWinProb,
    topDamage: { name: 'Lena', damage: 47_300 },
    // No stat lines in this fixture, so no award: a test that wants one passes it.
    award: null,
    blue: seatsOf(teams.blue, 100),
    red: seatsOf(teams.red, 200),
    rated: true,
    ...overrides,
  };
}

/**
 * Ten friends who all main mid. Nine of them cannot have it, so `balance()` returns a split
 * whose stored explanation carries the off-role clause and whose rows carry the marker — the
 * end-to-end case M3.7 is about, with nothing hand-written.
 */
export function offRoleFixture(): { members: MemberView[]; teams: TeamsView } {
  const members: MemberView[] = WORKED_ROSTER.map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    mainRole: 'mid',
    secondaryRole: null,
    roleOverride: null,
    isSpectator: false,
    joinedAt: JOINED_LONG_AGO,
    rating: displayRating(player.mu),
    side: null,
  }));

  const balanced = balance({
    players: WORKED_ROSTER.map((player) => ({
      puuid: workedPuuid(player.name),
      name: player.name,
      mu: player.mu,
      sigma: player.sigma,
      mainRole: 'mid' as Role,
      secondaryRole: null,
      roleOverride: null,
    })),
    duos: [],
    lastSplit: null,
  });

  const split = balanced.splits[0];
  const explanation = balanced.explanations[0];
  if (split === undefined || explanation === undefined) throw new Error('offRoleFixture: no split');

  const byPuuid = new Map(members.map((member) => [member.puuid, member]));
  const seats = (side: readonly { puuid: string; role: Role }[]): SeatView[] =>
    side.map((assignment) => {
      const member = byPuuid.get(assignment.puuid);
      if (member === undefined) throw new Error(`offRoleFixture: ${assignment.puuid} is not in the lobby`);
      return {
        puuid: assignment.puuid,
        name: member.name,
        role: assignment.role,
        rating: member.rating,
        offRole: isOffRole(member, assignment.role),
        liveSide: member.side,
      };
    });

  return {
    members,
    teams: {
      splitId: 'split-1',
      explanation,
      blue: seats(split.blue),
      red: seats(split.red),
      sitters: [],
      blueWinProb: split.blueWinProb,
      splits: balanced.splits.map((_, index) => ({
        id: `split-${index + 1}`,
        rank: index + 1,
        isChosen: index === 0,
      })),
    },
  };
}

export function lobbyView(overrides: Partial<LobbyView> = {}): LobbyView {
  return {
    id: 'lobby-1',
    status: 'open',
    // What M4.2's press generated and the companion reported back (M4.10). A fixture lobby the
    // bot opened has both; `lobbyName: null` is the lobby somebody made by hand before M4.2.
    lobbyName: 'Customs 08 Sep #1',
    lobbyPassword: '4821',
    members: workedMembers(),
    teams: null,
    result: null,
    ...overrides,
  };
}

export function snapshot(lobby: LobbyView | null, overrides: Partial<TonightSnapshot> = {}): TonightSnapshot {
  return {
    lobby,
    nightStart: FIXTURE_NIGHT_START,
    // What `formatNightLabel` answers for {@link FIXTURE_NIGHT_START} in the group's own zone:
    // the slug is formatted on the server and travels in the snapshot (M3.18).
    nightLabel: 'Tuesday 8 September',
    seasonActive: true,
    fearless: EMPTY_FEARLESS,
    nightClock: FIXTURE_NIGHT_CLOCK,
    tape: [],
    ...overrides,
  };
}

/** Cairo in September: UTC+3 all night, no shift. What `nightClock` answers for the fixture night. */
export const FIXTURE_NIGHT_CLOCK = { offsetMs: 3 * 60 * 60 * 1000, shift: null };

/** One tape row: a rated Rift game red won as the favourite, nobody sat out. */
export function tapeEntry(overrides: Partial<TapeEntry> = {}): TapeEntry {
  return {
    lobbyId: 'tape-lobby-1',
    createdAt: '2026-09-08T19:41:00.000Z',
    clock: '22:41',
    status: 'finished',
    result: { gameId: 'tape-game-1', winningSide: 200, durationS: 1_864, aram: false, rated: true },
    blueWinProb: 0.46,
    sitters: [],
    ...overrides,
  };
}
