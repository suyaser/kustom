import type { LobbyStatusValue } from '@customs/db';

/**
 * The lobby state machine (M2.5): which moves are legal and the two-hour idle sweep.
 *
 * Since 2026-10-03 nothing here balances a lobby by itself: `open` -> `balanced` is an admin's
 * press (`lib/admin/roll.ts`, `POST /api/admin/lobbies/[lobbyId]/roll`), not ten seconds of a
 * still roster. `04-decisions.md` has the row and the reason.
 *
 * The numbers live here and nowhere else.
 */

/*
 * M14.44: this file has no runtime imports, so the browser can have it. The tonight page's
 * client components ask it for `PLAYERS_PER_GAME` and `isActiveLobbyStatus`; when they asked
 * `lib/lobbyState.ts`, its command-queue import put zod and every `@customs/db` schema on every
 * route (`redesign/quality/REPORT.md` P2). `lib/lobbyState.ts` re-exports all of it.
 */

/**
 * How long a lobby may go unmentioned before the sweep gives up on it: two hours for an
 * `open` or `balanced` lobby (`abandoned`) and the same two hours for an `in_game` one
 * (`dropped`, M5.11) — no game of League runs two hours, so an `in_game` row that has not
 * moved in that long has lost its end-of-game block.
 */
export const IDLE_ABANDON_MS = 7_200_000;

/** A game shorter than this is a remake or a four-minute surrender, and is never rated. */
export const MIN_RATED_DURATION_S = 300;

/**
 * A Rift game shorter than this is not rated (M23.1, owner bug 2026-10-05): the rating gate's
 * `early-end`. A Rift game cannot be surrendered before 15:00, and a 5v5 that destroys a nexus
 * sooner is not a thing between friends, so a Rift game that ended earlier ended because people
 * left (game 717217f9: everyone quit at 632 s and the client still sent a winner). The block's own
 * `leaver` flag is no help: it stayed false on the one recorded quit (`packages/lcu/fixtures/16.17/
 * ws-events.ndjson`, a 100 s game the only human left). ARAM is never rated, so this is Rift only.
 */
export const MIN_RIFT_RATED_DURATION_S = 900;

/**
 * Ten play; everyone else around sits out (M2.5, "Choosing the ten"). Also the floor on a
 * roll: an admin cannot roll a lobby with fewer than this many around.
 */
export const PLAYERS_PER_GAME = 10;

/**
 * Every legal move, and nothing else.
 *
 * | From | To | Signal |
 * |---|---|---|
 * | — | `open` | the first lobby post for a party with no live row (M2.14) |
 * | `open` | `open` | a post whose roster differs: members replaced, `updated_at` moves |
 * | `open` | `balanced` | an admin's roll: ten or more around, and the roster the admin saw is the one stored |
 * | `balanced` | `open` | a post whose roster differs: the next teams need another roll |
 * | `balanced` | `balanced` | a roll that re-makes the splits of a lobby whose earlier roll died before writing them |
 * | `open`/`balanced` | `in_game` | a game post with `phase: 'in_progress'` for this lobby |
 * | `in_game` | `finished` | the `eog` post for this lobby |
 * | `open`/`balanced` | `finished` | the same eog, when the `in_progress` post never arrived |
 * | `open`/`balanced` | `abandoned` | the idle sweep |
 * | `in_game` | `dropped` | the idle sweep: two hours and no result (M5.11) |
 * | `dropped` | `finished` | an eog block that arrives days late still closes its own lobby |
 *
 * `finished` and `abandoned` are terminal. **`dropped` is terminal in every way that matters**
 * — its roster is frozen for good and it is outside the live set, so the party's next post
 * starts a clean cycle — but it keeps the one door to `finished`, because a companion whose
 * queue file drains a week later is still telling the truth about that game, and the row then
 * leaves M5.5's missed list by itself.
 *
 * **`in_game` does age out, and only into `dropped`** (M5.11). It must never become
 * `abandoned`: `abandoned` keeps the M2.9 replace semantics, so it would unfreeze the record
 * of who played, and it means "dissolved before it ever started", which is the opposite of
 * what happened. Before M5.11 `in_game` was swept nowhere at all, and because
 * `lobbies_active_party_idx` allows one live row per party and the client keeps one party id
 * all night (M2.14), one missed end-of-game block cost the group every later game of that
 * night.
 */
export const LOBBY_TRANSITIONS: Readonly<Record<LobbyStatusValue, readonly LobbyStatusValue[]>> = {
  open: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  balanced: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  in_game: ['finished', 'dropped'],
  dropped: ['finished'],
  finished: [],
  abandoned: [],
};

/** Thrown when code asks for a move the table does not have. Never answered to a companion. */
export class IllegalLobbyTransitionError extends Error {
  override name = 'IllegalLobbyTransitionError';

  constructor(
    readonly from: LobbyStatusValue,
    readonly to: LobbyStatusValue,
  ) {
    super(`lobby cannot go from ${from} to ${to}`);
  }
}

export function isLegalTransition(from: LobbyStatusValue, to: LobbyStatusValue): boolean {
  return LOBBY_TRANSITIONS[from].includes(to);
}

export function assertLegalTransition(from: LobbyStatusValue, to: LobbyStatusValue): void {
  if (!isLegalTransition(from, to)) throw new IllegalLobbyTransitionError(from, to);
}

/**
 * The statuses a lobby row can still be posted to, and still be **acted on** (M2.14). A party
 * has at most one row in one of these — `lobbies_active_party_idx` enforces it — and
 * `dropped`, `finished` and `abandoned` are outside the set, so the next post for that party
 * starts the night's next cycle.
 *
 * It lives here rather than in `lib/ingest/lobby.ts` (which re-exports it, unchanged, for the
 * callers that always had it) because the tonight page's role control asks the same question
 * in the browser, and importing the ingest module for a predicate would pull the whole ingest
 * — and the service-role client with it — into the client bundle.
 */
export const ACTIVE_LOBBY_STATUSES: readonly LobbyStatusValue[] = ['open', 'balanced', 'in_game'];

/** Is this row still the party's live lobby, or is its cycle over? */
export function isActiveLobbyStatus(status: LobbyStatusValue): boolean {
  return ACTIVE_LOBBY_STATUSES.includes(status);
}

/** `finished` and `abandoned`: a row here never moves again, whoever asks. */
export function isTerminalLobbyStatus(status: LobbyStatusValue): boolean {
  return LOBBY_TRANSITIONS[status].length === 0;
}
