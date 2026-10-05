import { isSettling, resolveRoles } from '@customs/core';
import type { RoleValue } from '@customs/db';
import type { OffRoleSeat, RatingsBefore, ReceiptNames, StoredSplit } from '@/components/receipt/types';
import { barSentence } from '@/lib/receipt/copy';
import { type GameReceipt, gameReceiptOf } from '../games/receipt';
import { isRemake } from '../games/remake';
import { LANE_ORDER } from '../laneOrder';
import { PLAYERS_PER_GAME } from '../lobbyRules';
import { isNameless } from './copy';
import { viewerKickoffSeat } from './kickoff';
import { announceGameStarted, announceTeams, announceWinner, REMAKE_ANNOUNCEMENT } from './screenCopy';
import type { HeaderView } from './state';
import type {
  LobbyView,
  MemberView,
  PlayerName,
  ResultView,
  TeamsView,
  TonightSnapshot,
  TonightState,
} from './types';

/**
 * The 2.0 tonight page's derived facts (M14.9), pure, so each is a unit test and the page is a
 * function of the snapshot. No number here is computed that core or the receipt helpers own.
 */

/**
 * puuid -> the full name, for the receipt (its reason line names who swaps). **Not** cut at
 * 32 characters the way `renderWebName` cuts a seat: the receipt wraps names, it never clips them.
 * Nameless players are left out, and the receipt prints the shared fallback word.
 */
export function receiptNames(lobby: LobbyView | null, result: ResultView | null = null): ReceiptNames {
  const names: Record<string, string> = {};
  const add = (puuid: string, name: PlayerName): void => {
    if (!isNameless(name) && name !== null) names[puuid] = name.trim();
  };
  for (const member of lobby?.members ?? []) add(member.puuid, member.name);
  for (const seat of [...(result?.blue ?? []), ...(result?.red ?? [])]) {
    if (names[seat.puuid] === undefined) add(seat.puuid, seat.name);
  }
  return names;
}

/** Who is off their main role tonight, from the seats' `offRole` (core's `isOffRole`, in the loader). */
export function offRoleSeats(teams: TeamsView): OffRoleSeat[] {
  return [...teams.blue, ...teams.red]
    .filter((seat) => seat.offRole)
    .map((seat) => ({ puuid: seat.puuid, role: seat.role }));
}

/**
 * How many of the ten have no main role on record (M14.41, scene-walk gap 6): core's
 * `resolveRoles(...).main === null` (flexible: never off-role), read off the lobby's member rows.
 * A seat with no member row is not counted (nothing known about it).
 */
export function noMainCount(teams: TeamsView, members: ReadonlyMap<string, MemberView>): number {
  return [...teams.blue, ...teams.red].filter((seat) => {
    const member = members.get(seat.puuid);
    return member !== undefined && resolveRoles(member).main === null;
  }).length;
}

/** The split in play, or `null` with none stored. */
export function chosenSplit(stored: readonly StoredSplit[]): StoredSplit | null {
  return stored.find((split) => split.isChosen) ?? [...stored].sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/**
 * Did the ten who played sit where the split put them (STRATEGY §4.10)? `false` when the lobby
 * changed after the roll, and the page then shows pre-game odds instead of the split's.
 */
export function playedAsRolled(result: ResultView, chosen: StoredSplit): boolean {
  const same = (played: readonly { puuid: string }[], rolled: readonly { puuid: string }[]): boolean => {
    const set = new Set(played.map((seat) => seat.puuid));
    return set.size === rolled.length && rolled.every((seat) => set.has(seat.puuid));
  };
  return same(result.blue, chosen.blue) && same(result.red, chosen.red);
}

/**
 * The finished game's receipt on Tonight (M21.7): `gameReceiptOf` (the one rule the game page and
 * history use) over the scoreboard's sides and the lobby's run, so a game played on swapped sides
 * keeps the bot's receipt turned round and a game whose teams changed after the roll gets pre-game
 * odds. The loader already decided what `playedOddsOf` decides with the mode and `games.rated` in
 * hand (`oddsKind`), and read the kickoff record (`kickoffBlueWinProb`); both are carried over.
 */
export function resultReceipt(result: ResultView, teams: TeamsView | null): GameReceipt {
  const seats = [...result.blue, ...result.red].map((seat) => ({
    puuid: seat.puuid,
    side: seat.side,
    rBefore: seat.rBefore,
  }));
  const receipt = gameReceiptOf({
    // An ARAM's `none` is the loader's (`oddsKind`): the page's result carries no mode.
    aram: false,
    rated: result.oddsKind !== 'none' && (result.stamp?.rated ?? true),
    seats,
    splits: teams?.stored ?? [],
  });
  return receipt.kind === 'pre-game'
    ? { ...receipt, kickoffBlueWinProb: result.kickoffBlueWinProb ?? null }
    : receipt;
}

/** Everyone's all-time Kustom Rating going in (`r_before`, M18.5), for core's `preGameOdds` (§4.10). */
export function ratingsBefore(result: ResultView): RatingsBefore {
  const of = (seats: ResultView['blue']) => seats.map((seat) => ({ r: seat.rBefore }));
  return { blue: of(result.blue), red: of(result.red) };
}

/**
 * Which game of the night the drawn lobby is: tonight's earlier games that finished with a result,
 * plus this one. `null` when no lobby is drawn (idle), so the strip prints the date alone.
 */
export function gameNumber(snapshot: TonightSnapshot, state: TonightState): number | null {
  if (state.kind === 'idle') return null;
  return snapshot.tape.filter((entry) => entry.result !== null).length + 1;
}

/** Where the viewer plays in the drawn split, or `null` (not seated, or not known). */
export function viewerSeat(
  teams: TeamsView | null,
  puuid: string | null,
): { side: 'blue' | 'red'; role: RoleValue } | null {
  if (teams === null || puuid === null) return null;
  const blue = teams.blue.find((seat) => seat.puuid === puuid);
  if (blue !== undefined) return { side: 'blue', role: blue.role };
  const red = teams.red.find((seat) => seat.puuid === puuid);
  return red === undefined ? null : { side: 'red', role: red.role };
}

/**
 * M21.9: the side whose region pool is the viewer's while the lobby is `balanced`: where the client
 * has them (`liveSide`) when known, else the side the split gave them. The side line keeps asking
 * them to move to the split's side; when they do, this follows. `null`: not seated in the split.
 */
export function viewerRegionSide(teams: TeamsView | null, puuid: string | null): 'blue' | 'red' | null {
  if (teams === null || puuid === null) return null;
  const seat = [...teams.blue, ...teams.red].find((one) => one.puuid === puuid);
  if (seat === undefined) return null;
  if (seat.liveSide === 100) return 'blue';
  if (seat.liveSide === 200) return 'red';
  return teams.blue.includes(seat) ? 'blue' : 'red';
}

/**
 * M21.13: while the lobby is `balanced`, the side the viewer should move to: the split's side when
 * the client has them (`liveSide`) on the other one. `null` when they already sit on the split's
 * side, when their live side is unknown (`null`: a spectator slot, or no member row), or when they
 * are not in the split; the answer band then keeps `YOU on BLUE, playing top`.
 */
export function viewerMoveTo(teams: TeamsView | null, puuid: string | null): 'blue' | 'red' | null {
  if (teams === null || puuid === null) return null;
  const blue = teams.blue.find((seat) => seat.puuid === puuid);
  if (blue !== undefined) return blue.liveSide === 200 ? 'blue' : null;
  const red = teams.red.find((seat) => seat.puuid === puuid);
  if (red !== undefined) return red.liveSide === 100 ? 'red' : null;
  return null;
}

/**
 * `Still needed: jungle, support` (STRATEGY §6(a)): the lanes nobody in the lobby mains, in lane
 * order, while the lobby is short of ten. Empty when nobody has a main role to read (the bot can
 * put anyone anywhere, and naming every lane would be noise) or when the lobby is full.
 */
export function stillNeeded(members: readonly MemberView[]): RoleValue[] {
  if (members.length >= PLAYERS_PER_GAME) return [];
  const mains = new Set<RoleValue>();
  for (const member of members) {
    const { main } = resolveRoles(member);
    if (main !== null) mains.add(main);
  }
  if (mains.size === 0) return [];
  return LANE_ORDER.filter((role) => !mains.has(role));
}

/** The roster's `New` (0 rated games here) and the seat's settling chip (core's `isSettling`). */
export function seatStanding(ratedGames: number | null): 'new' | 'settling' | 'settled' | 'unknown' {
  if (ratedGames === null) return 'unknown';
  if (ratedGames === 0) return 'new';
  return isSettling(ratedGames) ? 'settling' : 'settled';
}

function spokenSeat(
  seat: { side: 'blue' | 'red'; role: RoleValue | null } | null,
): { side: 'Blue' | 'Red'; role: RoleValue | null } | null {
  return seat === null ? null : { side: seat.side === 'blue' ? 'Blue' : 'Red', role: seat.role };
}

/**
 * The one polite announcement for this snapshot (05-design.md 6.4): one meaningful sentence per
 * change, never a bare number, never the timer. The page renders it in a single visually hidden
 * status region; React replaces its text in place when the next render differs, which is what a
 * screen reader announces.
 */
export function announcement(state: TonightState, header: HeaderView, viewerPuuid: string | null): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'filling':
      return header.sentence;
    // M21.5: the same one sentence as a game with no kickoff record, so the move from the teams
    // to the teams that started is announced once.
    // The viewer's side is named (6.4: `You're on Red, mid.`): in game it is the side the game
    // started on (M21.5's kickoff seat), which may not be the split's, so the change is said.
    case 'in-game':
      return announceGameStarted(spokenSeat(viewerKickoffSeat(state.game, viewerPuuid)));
    case 'teams': {
      if (state.lobby.status === 'in_game') {
        return announceGameStarted(spokenSeat(viewerSeat(state.teams, viewerPuuid)));
      }
      if (state.lobby.status !== 'balanced') return '';
      const chosen = chosenSplit(state.teams.stored);
      const odds = chosen === null ? '' : barSentence(chosen.blueWinProb);
      return announceTeams(odds, spokenSeat(viewerSeat(state.teams, viewerPuuid)));
    }
    default:
      // A remake has no winner to say (05-design.md 15.1): it says so, once.
      return isRemake(state.result.durationS)
        ? REMAKE_ANNOUNCEMENT
        : announceWinner(state.result.winningSide);
  }
}
