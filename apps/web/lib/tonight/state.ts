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
import type { LobbyView, PlayerName, SplitChoice, TeamsView, TonightSnapshot, TonightState } from './types';

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
    case 'balanced':
    case 'in_game':
      // Reachable only when a balanced lobby has **no split rows at all** — the split insert
      // failed, and the next companion post rebalances it (`hasChosenSplit`). The narrower
      // case, rows with none flagged `is_chosen`, is handled in `loadTeams`: it falls back to
      // the newest run's rank 1 rather than dropping the teams for the instant that
      // `balanceLobby` and `promoteSplit` spend between their two statements.
      return lobby.teams === null ? { kind: 'filling', lobby } : { kind: 'teams', lobby, teams: lobby.teams };
    case 'finished':
      if (lobby.result?.rated) {
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
 */
export function tonightHeader(state: TonightState): HeaderView {
  switch (state.kind) {
    case 'idle':
      return { headline: HEADLINE_IDLE, count: null, sentence: IDLE_SENTENCE, live: false };
    case 'filling': {
      const around = state.lobby.members.length;
      return {
        headline: HEADLINE_FILLING,
        count: around,
        sentence: fillingSentence(around),
        live: true,
      };
    }
    case 'teams':
      if (state.lobby.status === 'in_game') {
        return { headline: HEADLINE_IN_GAME, count: null, sentence: IN_GAME_SENTENCE, live: true };
      }
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
        sentence: state.result.rated ? FINISHED_SENTENCE : '',
        live: false,
      };
  }
}

/**
 * Does anything on screen read `Someone`? That is the one condition under which the page
 * re-reads the name map on a timer: `players` is service-role only and is in no Realtime
 * publication, so a name arriving is the one change that will never turn up as an event
 * (M3.4, "`Someone`, and names that arrive late").
 */
export function hasNamelessRow(state: TonightState): boolean {
  return namesOnScreen(state).some(isNameless);
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
    default:
      return [
        ...state.result.blue.map((seat) => seat.name),
        ...state.result.red.map((seat) => seat.name),
        ...(state.teams?.sitters ?? []).map((member) => member.name),
      ];
  }
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
