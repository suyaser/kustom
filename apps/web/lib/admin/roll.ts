import { BalanceError, type Rng } from '@customs/core';
import type { LobbyStatusValue } from '@customs/db';
import { type BalanceOutcome, balanceLobby } from '../ingest/balance';
import { emitLobbyBalanced } from '../ingest/hooks';
import { lobbyRosterKey, selectMemberPuuids } from '../ingest/lobby';
import { SelectionError } from '../ingest/selection';
import { moveLobby, PLAYERS_PER_GAME } from '../lobbyState';
import { lockLobbyAtRoll } from '../mode/lock';
import { serverRng } from '../mode/rng';
import { shortPairRedrawnNotice } from '../mode/ruleNotices';
import type { ServiceClient } from '../supabase';
import { idSchema } from './formValues';
import { NO_SUCH_LOBBY } from './reroll';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * The roll (2026-10-03, `04-decisions.md`): an admin's press is the only way a lobby goes from
 * `open` to `balanced`.
 *
 * Until that date ingest balanced by itself once ten people had been still for ten seconds.
 * People join, leave and step into the spectator slot in the middle of that, so it balanced the
 * wrong ten. Now somebody looks at the lobby, sees the right people, and presses.
 *
 * **The press names the roster it saw.** `rosterKey` is {@link lobbyRosterKey} over every
 * member the page was showing, spectators included, and the roll refuses (409) unless it is the
 * roster stored right now. The claim is then a compare-and-set on the status *and* the row's
 * `updated_at`, which every roster change moves (`restartClock`), so a friend leaving between
 * the check and the claim makes the claim lose instead of balancing a roster nobody saw.
 *
 * **A repeat press is a no-op.** A `balanced` lobby with a chosen split and the same roster
 * answers that split, `already_rolled`: nothing is balanced again, nothing is posted again.
 * This is not a reroll — promoting split 2 or 3 is `reroll.ts`, by split id.
 *
 * The maths is `@customs/core` through `balanceLobby`, and Discord (M3.1) and the
 * `switch_side` queue (M4.1) hear about it through `emitLobbyBalanced`, exactly as they did
 * when ingest fired it. The route registers those listeners.
 */

/**
 * How long a `balanced` lobby with no chosen split is treated as a roll still in flight.
 *
 * `balanceLobby` claims the status first and writes the splits after, so for a moment a lobby
 * is `balanced` with nothing chosen. A second press in that moment must not balance again (two
 * embeds, and a unique-index fight over `is_chosen`), so it is told to wait. Past this, the
 * roll that claimed it has died between its claim and its splits, and a press re-makes them.
 */
export const ROLL_IN_FLIGHT_MS = 30_000;

/** The sentence for a press against a roster that has moved since the page drew it. */
export const STALE_ROSTER =
  'the lobby changed since you looked: somebody joined or left, so nothing was rolled. Check the roster and press again';

/** The sentence for a second press while the first is still making the teams. */
export const ROLL_IN_FLIGHT = 'the teams are being made right now; they will be up in a moment';

/** What a press did. A union, not a flag: the two answers mean different things to the page. */
export type RollOutcome =
  /**
   * This press balanced the lobby; the listeners were told. `balance` is what they were told.
   * `modeNotice` (M20.7, M20 D11): Roll redrew a region pair the bans had made short, else null.
   */
  | { outcome: 'rolled'; splitId: string; balance: BalanceOutcome; modeNotice: string | null }
  /** The lobby already had teams for this roster; nothing moved and nothing was posted. */
  | { outcome: 'already_rolled'; splitId: string };

export interface RollInput {
  lobbyId: string;
  /** {@link lobbyRosterKey} over the members the presser saw. */
  rosterKey: string;
  now: Date;
  /** IANA name for "tonight": the rotation reads it (M2.5). */
  timeZone: string;
  /** Carried to the `balanced` hook for the embed's `url` (M3.1). Nothing is written from it. */
  requestOrigin: string | null;
  /** Region wars' draw at Roll (M15.3). Tests pin it; production uses the server's RNG. */
  rng?: Rng;
}

interface RollLobbyRow {
  id: string;
  groupId: string;
  status: LobbyStatusValue;
  lobbyName: string | null;
  lobbyPassword: string | null;
  updatedAt: string;
}

/**
 * Roll a lobby, or say why not. The refusals, in the order they are checked:
 *
 * 1. a lobby id that names nothing: 404;
 * 2. a lobby that is neither `open` nor `balanced`: 409, one sentence per status;
 * 3. fewer than ten around (an `open` lobby): 409;
 * 4. a roster that is not the one the presser saw: 409 {@link STALE_ROSTER};
 * 5. a `balanced` lobby whose roll is still writing its splits: 409 {@link ROLL_IN_FLIGHT};
 * 6. ten who cannot be split (`SelectionError`, core's `BalanceError`): 409, and the lobby is
 *    back at `open` with nothing written, so a later press can try again.
 */
export async function rollLobby(
  client: ServiceClient,
  input: RollInput,
): Promise<AdminWriteResult<RollOutcome>> {
  // A path segment, so unvalidated: a malformed uuid is a 404, not Postgres's 22P02 as a 500.
  if (!idSchema.safeParse(input.lobbyId).success) return writeFailed(404, NO_SUCH_LOBBY);
  return attempt(client, input, 0);
}

/** One read-check-claim pass. A lost claim re-reads once: a rename also moves `updated_at`. */
async function attempt(
  client: ServiceClient,
  input: RollInput,
  retries: number,
): Promise<AdminWriteResult<RollOutcome>> {
  const lobby = await readLobby(client, input.lobbyId);
  if (lobby === null) return writeFailed(404, NO_SUCH_LOBBY);

  if (lobby.status !== 'open' && lobby.status !== 'balanced') {
    return writeFailed(409, notRollableMessage(lobby.status));
  }

  const puuids = await selectMemberPuuids(client, lobby.id);
  const around = new Set(puuids).size;
  const sameRoster = lobbyRosterKey(puuids) === input.rosterKey;

  if (lobby.status === 'balanced') {
    if (!sameRoster) return writeFailed(409, STALE_ROSTER);
    const chosen = await selectChosenSplitId(client, lobby.id);
    if (chosen !== null) return writeOk({ outcome: 'already_rolled', splitId: chosen });

    // No chosen split: a roll in flight, or one that died after its claim (see ROLL_IN_FLIGHT_MS).
    if (input.now.getTime() - Date.parse(lobby.updatedAt) < ROLL_IN_FLIGHT_MS) {
      return writeFailed(409, ROLL_IN_FLIGHT);
    }
    // `balanced` -> `balanced` claims the repair: it moves `updated_at`, so of two presses
    // repairing at once exactly one wins and the other is in flight on its re-read.
    const claimed = await moveLobby(client, {
      lobbyId: lobby.id,
      from: ['balanced'],
      to: 'balanced',
      unchangedSince: lobby.updatedAt,
    });
    if (!claimed) return retries === 0 ? attempt(client, input, 1) : writeFailed(409, ROLL_IN_FLIGHT);
    console.warn(`lobby ${lobby.id}: balanced with no chosen split; an admin's roll is making them again`);
    return balanceClaimed(client, lobby, input);
  }

  if (around < PLAYERS_PER_GAME) return writeFailed(409, notEnoughMessage(around));
  if (!sameRoster) return writeFailed(409, STALE_ROSTER);

  const claimed = await moveLobby(client, {
    lobbyId: lobby.id,
    from: ['open'],
    to: 'balanced',
    unchangedSince: lobby.updatedAt,
  });
  // Lost: another press claimed it (the re-read answers `already_rolled` or in flight), the
  // roster changed (the re-read answers stale), or the lobby was renamed (the re-read rolls).
  if (!claimed) return retries === 0 ? attempt(client, input, 1) : writeFailed(409, STALE_ROSTER);

  return balanceClaimed(client, lobby, input);
}

/**
 * The lobby is ours at `balanced`: make the teams and tell the listeners. A balance that cannot
 * happen puts the lobby back at `open` and writes nothing — a wrong ten is worse than no teams.
 */
async function balanceClaimed(
  client: ServiceClient,
  lobby: RollLobbyRow,
  input: RollInput,
): Promise<AdminWriteResult<RollOutcome>> {
  try {
    // The mode locks onto the lobby before the teams are made (M15.3, R1/R2), so the teams post
    // (the `balanced` hook) and the game recorded from this lobby both read the copy. A repair
    // roll keeps the copy it finds. If the balance fails below, the lobby goes back to `open`,
    // which drops the copy in the database (`lobbies_drop_mode_lock`).
    const taken = await lockLobbyAtRoll(client, {
      lobbyId: lobby.id,
      groupId: lobby.groupId,
      now: input.now,
      rng: input.rng ?? serverRng,
    });
    const locked = taken.stored?.lock.mode;
    const modeNotice =
      taken.regions?.outcome === 'redrawn' && locked?.id === 'region'
        ? shortPairRedrawnNotice(taken.regions.from, locked)
        : null;
    const outcome = await balanceLobby(client, lobby, input.now, input.timeZone);
    console.info(`lobby ${lobby.id} rolled: ${outcome.explanation} (${outcome.sitters.length} sitting out)`);
    // Discord (M3.1) and the switch_side queue (M4.1). Each listener's failure is its own line
    // in `hooks.ts`; the teams stand whatever they answer.
    await emitLobbyBalanced({ ...outcome, requestOrigin: input.requestOrigin });
    return writeOk({ outcome: 'rolled', splitId: outcome.splitId, balance: outcome, modeNotice });
  } catch (error) {
    const expected = error instanceof SelectionError || error instanceof BalanceError;
    console.error(`lobby ${lobby.id}: rolling failed`, expected ? error.message : error);
    await moveLobby(client, { lobbyId: lobby.id, from: ['balanced'], to: 'open' });
    if (expected) {
      return writeFailed(
        409,
        `those ten could not be made into two teams, so nothing was posted: ${error.message}`,
      );
    }
    throw error;
  }
}

async function readLobby(client: ServiceClient, lobbyId: string): Promise<RollLobbyRow | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('id, group_id, status, lobby_name, lobby_password, updated_at')
    .eq('id', lobbyId)
    .maybeSingle();
  if (error) throw new Error(`rollLobby: lobby lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    groupId: data.group_id,
    status: data.status,
    lobbyName: data.lobby_name,
    lobbyPassword: data.lobby_password,
    updatedAt: data.updated_at,
  };
}

async function selectChosenSplitId(client: ServiceClient, lobbyId: string): Promise<string | null> {
  const { data, error } = await client
    .from('splits')
    .select('id')
    .eq('lobby_id', lobbyId)
    .eq('is_chosen', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`rollLobby: chosen split lookup failed: ${error.message}`);
  return data?.id ?? null;
}

function notEnoughMessage(around: number): string {
  return `${around} of ${PLAYERS_PER_GAME} are in the lobby; it takes ${PLAYERS_PER_GAME} to roll teams`;
}

/** Why a lobby that is neither `open` nor `balanced` cannot be rolled. One sentence per status. */
function notRollableMessage(status: LobbyStatusValue): string {
  switch (status) {
    case 'in_game':
    case 'dropped':
      return 'the game has started, so the teams on the rift are the teams';
    case 'finished':
      return 'that game is over';
    default:
      return 'that lobby was abandoned';
  }
}
