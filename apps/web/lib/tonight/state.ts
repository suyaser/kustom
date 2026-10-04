import { rosterKey } from '@customs/db/constants';
import { PLAYERS_PER_GAME } from '../lobbyRules';
import { NOT_RATED_RESULT_LINE } from '../mode/notRated';
import {
  BALANCED_SENTENCE,
  FINISHED_SENTENCE,
  fillingSentence,
  HEADLINE_BALANCED,
  HEADLINE_FILLING,
  HEADLINE_FINISHED,
  HEADLINE_IDLE,
  HEADLINE_IN_GAME,
  IDLE_SENTENCE,
  IN_GAME_SENTENCE,
  isNameless,
} from './copy';
import type {
  LobbyView,
  MemberView,
  PlayerName,
  SplitChoice,
  TapeEntry,
  TeamsView,
  TonightSnapshot,
  TonightState,
} from './types';

/**
 * Snapshot in, one primary block out (05-design.md, "The tonight page's three states — one
 * rule"). Pure, so the state table is a unit test and not a walk through the page.
 *
 * The page renders exactly one of these and the header strip. A status the page has no block
 * for — `abandoned`, which the loader already filters out — is idle.
 */
export function tonightState(snapshot: TonightSnapshot): TonightState {
  const lobby = snapshot.lobby;
  if (lobby === null) return { kind: 'idle' };

  switch (lobby.status) {
    case 'open':
      return { kind: 'filling', lobby };
    case 'in_game':
      // M21.5: a game with a kickoff record is the in-game block of the teams that started it,
      // rolled or not (an unrolled game is never a filling lobby). With no record (a game before
      // M21.4, unequal sides) it is exactly the case below, as before M21.
      if (lobby.kickoff != null) {
        return { kind: 'in-game', lobby, game: lobby.kickoff, teams: lobby.teams };
      }
      return lobby.teams === null ? { kind: 'filling', lobby } : { kind: 'teams', lobby, teams: lobby.teams };
    case 'balanced':
      // Reachable only when a balanced lobby has **no split rows at all** — a roll claimed the
      // lobby and its split insert failed or has not landed yet. Nothing repairs it by itself:
      // the next admin press after `ROLL_IN_FLIGHT_MS` (30s, `lib/admin/roll.ts`) makes the
      // splits again, which is why `rollStage` offers the button here (`repair`). The narrower
      // case, rows with none flagged `is_chosen`, is handled in `loadTeams`: it falls back to
      // the newest run's rank 1 rather than dropping the teams for the instant that
      // `balanceLobby` and `promoteSplit` spend between their two statements.
      return lobby.teams === null ? { kind: 'filling', lobby } : { kind: 'teams', lobby, teams: lobby.teams };
    case 'finished':
      // M15.5 (R4): a Rift game played not rated (a rule's default or the Rated switch) is still
      // a result: the poster, with its rule line and `Not rated, so no Rating change.`.
      if (lobby.result?.rated || (lobby.result?.stamp?.rift === true && !lobby.result.stamp.rated)) {
        return { kind: 'result', lobby, result: lobby.result, teams: lobby.teams };
      }
      // A game the fold did not rate — a remake, a four-minute surrender — has no result card
      // to draw: the teams they played and the explanation stay up under the header `Final`,
      // with no deltas and no banner apologising for it (M3.4).
      if (lobby.teams !== null) return { kind: 'teams', lobby, teams: lobby.teams };
      return lobby.result === null
        ? { kind: 'filling', lobby }
        : { kind: 'result', lobby, result: lobby.result, teams: null };
    default:
      return { kind: 'idle' };
  }
}

export interface HeaderView {
  /** The word or phrase, upper case, in the display cut. `9 IN THE LOBBY` when `count` is set. */
  headline: string;
  count: number | null;
  /**
   * The line under the headline, and the page's one polite live region. It **never repeats the
   * headline**, and it is `''` on an unrated finish — the slot keeps its reserved height and
   * says nothing, because there is no apology to make (M3.4).
   */
  sentence: string;
  /** The live pill. It means the lobby is open, not that a socket is up. Gone at `finished`. */
  live: boolean;
}

/**
 * The status strip, which is always mounted and is the only element that survives every
 * transition: a phone reopened mid-night answers "where are we" in one glance.
 *
 * Every string is product's, from the final copy table (05-design.md, 2026-09-09), and
 * `state.test.ts` pins one per state.
 *
 * `admins` is the group's admins by display name (`lib/tonight/admins.ts`), only read by the
 * filling sentence at ten or more. Optional so the share card keeps the generic sentence.
 */
export function tonightHeader(state: TonightState, admins: readonly PlayerName[] = []): HeaderView {
  switch (state.kind) {
    case 'idle':
      return { headline: HEADLINE_IDLE, count: null, sentence: IDLE_SENTENCE, live: false };
    case 'filling': {
      const around = lobbyAround(state.lobby.members);
      return {
        headline: HEADLINE_FILLING,
        count: around,
        // At ten or more the sentence names who can roll (2026-10-03); `admins` is read once
        // with the page, and an empty list is today's generic `an admin`.
        sentence: fillingSentence(around, admins),
        live: true,
      };
    }
    case 'in-game':
      return inGameHeader(state.lobby);
    case 'teams':
      if (state.lobby.status === 'in_game') return inGameHeader(state.lobby);
      // A finished lobby that reaches the teams block is a game the fold did not rate: the
      // teams they played stay up under `GAME OVER`, with no deltas and no sentence.
      if (state.lobby.status === 'finished') {
        return { headline: HEADLINE_FINISHED, count: null, sentence: '', live: false };
      }
      return { headline: HEADLINE_BALANCED, count: null, sentence: BALANCED_SENTENCE, live: true };
    default:
      return {
        headline: HEADLINE_FINISHED,
        count: null,
        // M15.5: a Rift game played not rated is a result too; its sentence says why nothing moved.
        sentence: state.result.rated
          ? FINISHED_SENTENCE
          : state.result.stamp?.rift === true && !state.result.stamp.rated
            ? NOT_RATED_RESULT_LINE
            : '',
        live: false,
      };
  }
}

function inGameHeader(lobby: LobbyView): HeaderView {
  // M15.5: a game locked not rated says so in the strip, so it never contradicts the card.
  const sentence = lobby.lock?.rated === false ? NOT_RATED_RESULT_LINE : IN_GAME_SENTENCE;
  return { headline: HEADLINE_IN_GAME, count: null, sentence, live: true };
}

/**
 * Does anything on screen read `Someone`? That is the one condition under which the page
 * re-reads the name map on a timer: `players` is service-role only and is in no Realtime
 * publication, so a name arriving is the one change that will never turn up as an event
 * (M3.4, "`Someone`, and names that arrive late").
 *
 * The tape is on screen in every state, the idle page included, so its sitters count too
 * (M11.2): a newest dropped lobby is an idle primary block with names only on the tape.
 */
export function hasNamelessRow(state: TonightState, tape: readonly TapeEntry[]): boolean {
  return [...namesOnScreen(state), ...tape.flatMap((entry) => entry.sitters)].some(isNameless);
}

function namesOnScreen(state: TonightState): PlayerName[] {
  switch (state.kind) {
    case 'idle':
      return [];
    case 'filling':
      return state.lobby.members.map((member) => member.name);
    case 'teams':
      return [
        ...state.teams.blue.map((seat) => seat.name),
        ...state.teams.red.map((seat) => seat.name),
        ...state.teams.sitters.map((member) => member.name),
      ];
    case 'in-game':
      return [
        ...state.game.blue.map((seat) => seat.name),
        ...state.game.red.map((seat) => seat.name),
        ...state.game.sitters.map((member) => member.name),
      ];
    default:
      return [
        ...state.result.blue.map((seat) => seat.name),
        ...state.result.red.map((seat) => seat.name),
        ...(state.teams?.sitters ?? []).map((member) => member.name),
      ];
  }
}

/**
 * Where the roll stands for a lobby on screen (2026-10-03):
 *
 * - `waiting`: `open` with fewer than ten around — nothing to press yet;
 * - `ready`: `open` with ten or more — an admin's press makes the teams;
 * - `repair`: `balanced` with no teams to draw — a roll that died between its claim and its
 *   splits, which the next press after the in-flight window re-makes (`lib/admin/roll.ts`);
 * - `none`: every other lobby, where the roll route would only refuse.
 *
 * The count is distinct puuids, the same count the route checks.
 */
export type RollStage = 'waiting' | 'ready' | 'repair' | 'none';

export function rollStage(lobby: LobbyView): RollStage {
  if (lobby.status === 'balanced') return lobby.teams === null ? 'repair' : 'none';
  if (lobby.status !== 'open') return 'none';
  return lobbyAround(lobby.members) >= PLAYERS_PER_GAME ? 'ready' : 'waiting';
}

/**
 * How many are around in a lobby: distinct puuids, the count the roll route checks and
 * {@link rollStage} reads (M14.45). The header count, the meter, the roller's sub-line and hint
 * all read this one, so `10/10` never shows beside a stage that says fewer.
 */
export function lobbyAround(members: readonly Pick<MemberView, 'puuid'>[]): number {
  return new Set(members.map((member) => member.puuid)).size;
}

/**
 * The `rosterKey` a roll press sends: `rosterKey()` from `@customs/db` over the puuid of every
 * member on screen, spectators included, duplicates dropped — `lobbyRosterKey` in
 * `lib/ingest/lobby.ts`, which the route recomputes from `lobby_members`. Any difference
 * between the two is a 409 on every press, so `state.test.ts` pins them against each other.
 * `''` for an empty lobby (the route's schema refuses it; the button is not drawn then).
 */
export function rollRosterKey(members: readonly Pick<MemberView, 'puuid'>[]): string {
  const unique = [...new Set(members.map((member) => member.puuid))];
  return unique.length === 0 ? '' : rosterKey(unique);
}

/**
 * Which split the one `Reroll` button promotes: the next one down the list.
 *
 * `null` means the control is disabled and the strip says `No more splits. …` — the chosen
 * split is the last one the lobby stored, so the group has seen the whole list. The route
 * refuses that press for the same reason (M3.2); this is the page agreeing with it in advance
 * rather than finding out by posting.
 */
export function nextRerollSplit(splits: readonly SplitChoice[]): SplitChoice | null {
  const chosen = splits.find((split) => split.isChosen);
  if (chosen === undefined) return null;
  return splits.find((split) => split.rank === chosen.rank + 1) ?? null;
}

/**
 * Is anybody in the promoted split sitting on the wrong side of the client's lobby? That is the
 * one question the side line exists to answer (M4.11, M4.3's acceptance 7).
 *
 * The rule is the server's own, `lib/commands/switchSide.ts`'s `switchSideMoves`, read the way a
 * page has to read it rather than the way a queue does:
 *
 * - a seat whose `liveSide` is the side the split gave them **matches**;
 * - a seat whose `liveSide` is the other side does not, and the line stays up;
 * - a seat whose `liveSide` is **`null`** does not either. The queue skips those — a spectator
 *   cannot be toggled onto a team, and `switchSide.ts` says in as many words that "the line on
 *   the page is what tells them to move". `null` is *not knowing*, and a line that vanished on
 *   not knowing would be a page claiming the room is sorted because nobody told it otherwise.
 *
 * Which means the line's absence is a positive statement: all ten reported, all ten in place.
 * The seconds between the last person moving and the companion's next lobby post are seconds the
 * line is still up — the page cannot be more current than the client that reports it, and being
 * a poll behind is the honest failure here.
 */
export function anySeatOnTheWrongSide(teams: TeamsView): boolean {
  return teams.blue.some((seat) => seat.liveSide !== 100) || teams.red.some((seat) => seat.liveSide !== 200);
}

/** Everyone around, in join order: the ten and the sitters, for the "you" marker. */
export function isViewer(puuid: string, viewerPuuid: string | null): boolean {
  return viewerPuuid !== null && puuid === viewerPuuid;
}

/** The lobby's members, keyed by puuid, for the blocks that render seats rather than rows. */
export function membersByPuuid(lobby: LobbyView): Map<string, LobbyView['members'][number]> {
  return new Map(lobby.members.map((member) => [member.puuid, member]));
}
