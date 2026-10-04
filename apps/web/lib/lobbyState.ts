import type { LobbyStatusValue } from '@customs/db';
import { supersedeLobbyCommands } from './commands/queue';
import { assertLegalTransition, IDLE_ABANDON_MS, isTerminalLobbyStatus } from './lobbyRules';
import type { ServiceClient } from './supabase';

/**
 * The lobby state machine (M2.5): the rules and the numbers are in `./lobbyRules` (M14.44, so a
 * client component can import them without the command queue), re-exported here; the reads and
 * writes that apply them are below.
 */
export {
  ACTIVE_LOBBY_STATUSES,
  assertLegalTransition,
  IDLE_ABANDON_MS,
  IllegalLobbyTransitionError,
  isActiveLobbyStatus,
  isLegalTransition,
  isTerminalLobbyStatus,
  LOBBY_TRANSITIONS,
  MIN_RATED_DURATION_S,
  PLAYERS_PER_GAME,
} from './lobbyRules';

/** The status the row holds right now, or `null` when it is gone. */
export async function readLobbyStatus(
  client: ServiceClient,
  lobbyId: string,
): Promise<LobbyStatusValue | null> {
  const { data, error } = await client.from('lobbies').select('status').eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`readLobbyStatus: ${error.message}`);
  return data?.status ?? null;
}

export interface MoveLobbyInput {
  lobbyId: string;
  /** The statuses this move is allowed to start from. Every one is checked against the table. */
  from: readonly LobbyStatusValue[];
  to: LobbyStatusValue;
  /**
   * The row's `updated_at` as the caller read it. When set, the move also refuses if the row
   * has been written since — a roster change, a rename, another roll's claim. The roll uses it
   * so that "the roster I checked" and "the roster I claimed" are the same roster.
   */
  unchangedSince?: string;
}

/**
 * Move one lobby, if it is still where the caller thinks it is.
 *
 * This is a compare-and-set — `update lobbies set status = ? where id = ? and status in (?)` —
 * and it is how two companions posting the same lobby in the same second produce one
 * transition: only the request whose update returns a row owns what follows (M2.5, point 4).
 *
 * `false` means somebody else got there first, or the lobby has already moved on. That is a
 * normal answer, not an error: the caller writes nothing and answers 200.
 */
export async function moveLobby(client: ServiceClient, input: MoveLobbyInput): Promise<boolean> {
  for (const from of input.from) assertLegalTransition(from, input.to);

  let update = client
    .from('lobbies')
    .update({ status: input.to })
    .eq('id', input.lobbyId)
    .in('status', input.from);
  if (input.unchangedSince !== undefined) update = update.eq('updated_at', input.unchangedSince);
  const { data, error } = await update.select('id');
  if (error) throw new Error(`moveLobby: ${input.to} failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;

  await expireCommandsOnLeavingBalanced(client, input);
  return true;
}

/**
 * A lobby that leaves `balanced` takes its pending `switch_side` commands with it (M4.1).
 *
 * The rows were written for the split that was on the board; once the lobby is `in_game`,
 * `finished`, `dropped`, `abandoned` — or back at `open` because somebody joined — that split
 * is not the answer any more, and a command that lands afterwards moves a friend for no
 * reason. They are `failed` with `superseded` rather than left to their three-minute TTL,
 * because three minutes is long enough to be somebody's champion select.
 *
 * It lives inside `moveLobby` rather than in a hook because there is exactly one function that
 * moves a lobby, and this is part of the move: a caller cannot forget it. A reroll is the one
 * case this never sees — it promotes another split without the lobby leaving `balanced`, so
 * `promoteSplit` (`lib/admin/reroll.ts`) supersedes and re-queues in one write of its own.
 *
 * A failure here is logged and swallowed: a stale command is a nuisance, and a lobby that
 * cannot go `in_game` because of one is a night.
 */
async function expireCommandsOnLeavingBalanced(client: ServiceClient, input: MoveLobbyInput): Promise<void> {
  if (input.to === 'balanced' || !input.from.includes('balanced')) return;
  try {
    await supersedeLobbyCommands(client, input.lobbyId, `lobby is now ${input.to}`);
  } catch (error) {
    console.error(`moveLobby: superseding commands for lobby ${input.lobbyId} failed`, error);
  }
}

/**
 * {@link moveLobby}, and when it claims nothing, one line saying why if the reason is that the
 * lobby is already terminal.
 *
 * A refused move is usually ordinary — somebody else got there first, or the lobby is already
 * where we wanted it. It is *not* ordinary when the row is `finished` or `abandoned`: a game
 * that cannot close its lobby means the record and the game disagree, and the two-hour sweep
 * abandoning a lobby out from under an arriving end-of-game block is exactly the case worth
 * seeing in a log rather than guessing at later.
 */
export async function moveLobbyLogged(
  client: ServiceClient,
  input: MoveLobbyInput,
  context: string,
): Promise<boolean> {
  if (await moveLobby(client, input)) return true;

  const status = await readLobbyStatus(client, input.lobbyId);
  if (status !== null && isTerminalLobbyStatus(status)) {
    console.warn(`${context}: lobby ${input.lobbyId} is ${status}; cannot move ${status} -> ${input.to}`);
  }
  return false;
}

/**
 * The idle sweep, run at the start of every companion lobby and game post and by
 * `GET /api/cron/sweep`: two statements, both over the partial index `lobbies_open_idx`.
 *
 * 1. `open` or `balanced` and two hours unmentioned -> `abandoned`. It never started, so its
 *    roster is not history and the replace semantics survive (M2.9).
 * 2. `in_game` and two hours unmentioned -> `dropped` (M5.11). No game runs two hours, so
 *    this row has lost its end-of-game block; the roster stays frozen and the party's next
 *    post starts the night's next cycle instead of landing on a frozen row forever.
 *
 * The clock for both is the row's own `updated_at`, which the `in_progress` post moved when
 * it set `in_game` and which any later write to that row (a renamed lobby) moves again — so a
 * companion that is still reporting the party cannot have its game dropped out from under it
 * before the two hours are up.
 *
 * Returns how many lobbies were given up on, either way, for the log and for the cron route.
 */
export async function sweepIdleLobbies(client: ServiceClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_ABANDON_MS).toISOString();

  const { data, error } = await client
    .from('lobbies')
    .update({ status: 'abandoned' })
    .in('status', ['open', 'balanced'])
    .lt('updated_at', cutoff)
    .select('id');
  if (error) throw new Error(`sweepIdleLobbies: ${error.message}`);

  const abandoned = (data ?? []).length;
  if (abandoned > 0) {
    console.info(`lobby sweep: ${abandoned} lobby(ies) idle for over two hours -> abandoned`);
  }
  // The same rule as every other exit from `balanced`, for the one path that does not go
  // through `moveLobby` (M4.1). A lobby nobody has mentioned for two hours has no side left
  // worth moving anybody to.
  for (const row of data ?? []) {
    await supersedeCommandsQuietly(client, row.id, 'abandoned');
  }

  const { data: stuck, error: stuckError } = await client
    .from('lobbies')
    .update({ status: 'dropped' })
    .eq('status', 'in_game')
    .lt('updated_at', cutoff)
    .select('id');
  if (stuckError) throw new Error(`sweepIdleLobbies: dropping stuck games failed: ${stuckError.message}`);

  const dropped = (stuck ?? []).length;
  if (dropped > 0) {
    // Worth a line each: this is a night whose result nobody will ever see, and M5.5 is the
    // page that lists them.
    for (const row of stuck ?? []) {
      console.warn(`lobby sweep: lobby ${row.id} was in_game for over two hours with no result -> dropped`);
    }
  }
  for (const row of stuck ?? []) {
    await supersedeCommandsQuietly(client, row.id, 'dropped');
  }

  return abandoned + dropped;
}

/** {@link supersedeLobbyCommands}, with the sweep's own rule: one line, never a thrown error. */
async function supersedeCommandsQuietly(
  client: ServiceClient,
  lobbyId: string,
  status: LobbyStatusValue,
): Promise<void> {
  try {
    await supersedeLobbyCommands(client, lobbyId, `lobby is now ${status}`);
  } catch (error) {
    console.error(`lobby sweep: superseding commands for lobby ${lobbyId} failed`, error);
  }
}
