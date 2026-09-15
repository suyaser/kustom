import { randomInt } from 'node:crypto';
import { COMPANION_COMMAND_TTL_MS } from '@customs/db/schemas';
import { type NameableRow, playerLabel } from './admin/playerName';
import { type AdminWriteResult, writeFailed, writeOk } from './admin/result';
import {
  type CommandGate,
  enqueueCommands,
  isCommandKindEnabled,
  nightWindow,
  sweepExpiredCommands,
} from './commands';
import { DEFAULT_NIGHT_TIME_ZONE, formatDayMonth } from './night';
import type { ServiceClient } from './supabase';

/**
 * Start a lobby (M4.2): the one tap this product has.
 *
 * **In `lib/`, not `lib/admin/`, since M4.13.** The press is no longer an admin write: it moved
 * onto M3.6's `/api/me/*` class and every **linked** player may make it, so the rules and the
 * words followed the route out of the admin tree. Both surfaces — the tonight page and the one
 * button on `/admin` — import this one copy, which is the whole point of moving it rather than
 * leaving a second one behind. The two helpers it still borrows from `lib/admin/` are the name
 * chain and the write-result type, neither of which is about being an admin.
 *
 * 21:40, seven friends in voice, one of them taps **Start a lobby** on a phone. Somebody's
 * League client — nobody had to decide whose — opens a custom with a name and a password
 * neither of them chose, and the invite popup appears for everyone who is around. Nobody typed
 * a lobby name, nobody read a password out loud, nobody asked "who's making it?".
 *
 * This file is the rules. It writes exactly one row — a `create_lobby` command for the host it
 * picked — and the invites follow later, off the ack, in `lib/commands/invites.ts`: the
 * `create_lobby` coming back `done` is the only proof that a lobby exists, and a create that
 * fails or expires queues nothing.
 *
 * **What is not here.** No mode picker, no name field, no password field, no host dropdown:
 * each one is a step and this product's claim is that there are none. The mode itself is not
 * even on the payload — the companion reads the client's own custom-queue list and picks draft
 * (`04-decisions.md`, 2026-09-09 and 2026-09-10), so no queue id is a constant on this side.
 *
 * **Every read is bounded by `now` at both ends** — the night's 06:00 and `now` itself — so
 * "tonight" means one night and an injected clock names exactly the night it says. In
 * production the upper bound is a no-op; nothing is created in the future.
 */

// ---------------------------------------------------------------------------
// The words (product owns these, M4.2's brief; verbatim)
// ---------------------------------------------------------------------------

/** The control. */
export const START_LOBBY_BUTTON = 'Start a lobby';

/** A lobby of tonight is already `open`, `balanced` or `in_game`. */
export const LOBBY_ALREADY_OPEN = 'There is already a lobby open.';

/** Nobody's companion has been up in the last ten minutes, so there is nobody to run it. */
export const NO_COMPANION_AROUND = 'Nobody has the companion running right now. Start it and try again.';

/**
 * The double-tap guard: the pending row *is* the lock, so two taps produce one command.
 *
 * Two presses can say this, and they are indistinguishable from outside. The one that read the
 * pending row (`decideStart`) and the one that lost the insert to
 * `companion_commands_one_create_lobby_idx` (`0008`, M4.9) both answer 409 with this sentence.
 */
export const LOBBY_ALREADY_OPENING = 'A lobby is already being opened.';

/**
 * The refusal for a kind flagged off in `lib/commands/gate.ts` because its reference row is not
 * green. Unreachable in production since 2026-09-12 — both kinds this route needs are green — and
 * kept because the gate is one boolean away from being off again on the next patch.
 */
export const LOBBY_WRITES_UNVERIFIED = "Opening lobbies isn't verified on this patch yet.";

/** While the command is pending, on the page, naming the host that was picked. */
export function openingOnPcLine(hostName: string): string {
  return `Opening a lobby on ${hostName}'s PC…`;
}

/** The host's companion never answered and the command expired. Nothing was created. */
export const NO_CLIENT_ANSWERED = "Nobody's client answered. Try again.";

/** The host had made a lobby by hand a minute earlier (`already_in_lobby`). */
export function alreadyHasALobbyLine(hostName: string): string {
  return `${hostName} already has a lobby open — everyone can join that one.`;
}

/** Under the member list while the lobby is filling, until ten are in. */
export function invitedLine(count: number): string {
  return `Invited ${count} friend${count === 1 ? '' : 's'} — waiting for them to accept.`;
}

/** A `create_lobby` row as a page reads it: its status and, when it failed, the nack text. */
export interface CreateLobbyProgress {
  status: 'pending' | 'sent' | 'acked' | 'failed';
  /** The companion's prose (`already_in_lobby: partyId=…`) or the server's (`expired`). */
  error: string | null;
}

/**
 * What the page prints where the button was, from the row's own status. Pure, so the tonight
 * page and `/admin` cannot end up saying two different things about one command.
 *
 * - **pending / sent** — `Opening a lobby on <Name>'s PC…`, naming the host that was picked;
 * - **acked** — nothing. The member list appearing *is* the answer, and a toast on top of it is
 *   noise (product, M4.2);
 * - **failed with `already_in_lobby`** — the host made a lobby by hand a minute ago, so the
 *   group is told to join that one instead;
 * - **failed any other way** — `Nobody's client answered. Try again.` Product wrote that line
 *   for the expiry, and it is the only failure sentence there is: from the friend holding the
 *   phone, a `wrong_phase` (the host is in champion select) and a client that refused the POST
 *   are the same fact — nothing was created, press it again. Inventing a sentence per
 *   `commandFailureReasonSchema` word would put the queue's vocabulary on the tonight page.
 */
export function startLobbySentence(progress: CreateLobbyProgress | null, hostName: string): string | null {
  if (progress === null || progress.status === 'acked') return null;
  if (progress.status !== 'failed') return openingOnPcLine(hostName);
  return progress.error?.startsWith('already_in_lobby') ? alreadyHasALobbyLine(hostName) : NO_CLIENT_ANSWERED;
}

// ---------------------------------------------------------------------------
// The rules with numbers in them
// ---------------------------------------------------------------------------

/**
 * How recently a companion must have been seen for its player to be offered the lobby.
 *
 * Ten minutes, and `last_seen_at` means "at their PC with League open" from M4.1 on — the
 * commands poll writes it only when the client is up — which is exactly the question being
 * asked. `lib/commands/switchSide.ts` uses the same window for the same reason.
 */
export const HOST_WINDOW_MS = 10 * 60_000;

/** Four digits: somebody joining by hand types it, and the group reads it out in voice. */
export const LOBBY_PASSWORD_DIGITS = 4;

/** The client's own limit, and the payload schema's. */
export const LOBBY_NAME_MAX = 30;

// ---------------------------------------------------------------------------
// The name and the password
// ---------------------------------------------------------------------------

/**
 * `Customs 09 Sep #2`: ASCII, at most {@link LOBBY_NAME_MAX} characters, with the night's cycle
 * number so the client's own lobby list and the Discord embed say which game of the night this
 * is. The day is padded to two digits so a column of them lines up and the acceptance regex
 * (`^Customs \d\d [A-Z][a-z]{2} #\d+$`) holds all year.
 *
 * The date comes from `formatDayMonth`, which is the app's only date formatter: one locale, one
 * configured timezone, one spelling of September.
 */
export function lobbyNameFor(now: Date, cycle: number, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const [day = '', month = ''] = formatDayMonth(now, timeZone).split(' ');
  return `Customs ${day.padStart(2, '0')} ${month} #${Math.max(1, cycle)}`.slice(0, LOBBY_NAME_MAX);
}

/**
 * Four digits, zero padded. Not a secret — it goes in the Discord embed and on the tonight page
 * — so this is `randomInt` for evenness rather than for secrecy, and a long random string would
 * only make it unreadable aloud.
 */
export function generateLobbyPassword(random: () => number = () => randomInt(0, 10_000)): string {
  const value = Math.abs(Math.trunc(random())) % 10 ** LOBBY_PASSWORD_DIGITS;
  return String(value).padStart(LOBBY_PASSWORD_DIGITS, '0');
}

// ---------------------------------------------------------------------------
// Who hosts
// ---------------------------------------------------------------------------

/** A player who could run the lobby: one live companion token, and when it was last seen. */
export interface HostCandidate {
  playerId: string;
  puuid: string;
  displayName: string | null;
  gameName: string | null;
  tagLine: string | null;
  lastSeenAt: Date;
}

/**
 * The server picks the host; nobody chooses one in a dropdown.
 *
 * The presser first when they qualify — the person who tapped is at their PC by definition and
 * the lobby appearing on their own screen is the least surprising outcome — then the newest
 * `last_seen_at`, which is the freshest evidence that a client is up. Ties break on the player
 * id so the choice is deterministic.
 */
export function chooseHost(
  candidates: readonly HostCandidate[],
  pressedByPlayerId: string | null,
): HostCandidate | null {
  const ordered = [...candidates].sort(
    (left, right) =>
      right.lastSeenAt.getTime() - left.lastSeenAt.getTime() || left.playerId.localeCompare(right.playerId),
  );
  const presser = ordered.find((candidate) => candidate.playerId === pressedByPlayerId);
  return presser ?? ordered[0] ?? null;
}

/** `Hamoodi`, else `Ahmed#EUW`, else a puuid fragment — the admin pages' own chain (M1.7). */
export function hostLabel(host: HostCandidate): string {
  const row: NameableRow = {
    puuid: host.puuid,
    displayName: host.displayName,
    gameName: host.gameName,
    tagLine: host.tagLine,
  };
  return playerLabel(row);
}

// ---------------------------------------------------------------------------
// The state of the night, and the decision over it
// ---------------------------------------------------------------------------

/** Everything the press is decided on, as of `now`. */
export interface StartLobbyState {
  /** A lobby of tonight that is `open`, `balanced` or `in_game`, if there is one. */
  liveLobbyId: string | null;
  /** A `create_lobby` of tonight that is still live: the double-tap lock. */
  pendingCreateId: string | null;
  /** `lobbies` rows of tonight, any status. The name's `#n` is this plus one. */
  lobbiesTonight: number;
  /** Players with an unrevoked token seen inside {@link HOST_WINDOW_MS}. */
  hosts: HostCandidate[];
}

/** What a successful press decided, before anything is written. */
export interface StartLobbyPlan {
  host: HostCandidate;
  hostName: string;
  lobbyName: string;
  lobbyPassword: string;
  /** Which lobby of the night this is: the `#n` in the name. */
  cycle: number;
}

export interface DecideStartOptions {
  now?: Date;
  timeZone?: string;
  /** Tests only: the four digits. Production draws them from `randomInt`. */
  password?: () => string;
}

/**
 * The refusals, in one place and in one order, each of them one sentence the page prints where
 * the button was. The order is not the brief's table order and the difference matters:
 *
 * 1. **a live lobby** — the honest answer to "start a lobby" when one is open;
 * 2. **a pending `create_lobby`** — before the host check, because a double tap two seconds
 *    apart must say `A lobby is already being opened.` and not `Nobody has the companion
 *    running right now.` if that host's poll has not landed yet. The pending row is the lock,
 *    and from M4.9 this read is the *friendly* half of it: the enforcing half is a unique index
 *    (`0008`) that catches the two taps this read cannot see, the ones in the same millisecond;
 * 3. **nobody around** — no unrevoked token seen in the last ten minutes, so there is no client
 *    to run it and **nothing is written anywhere**.
 *
 * The verification gate is checked before any of it, in {@link startLobby}, so a deployment
 * whose reference rows are not green does not even read the database.
 */
export function decideStart(
  state: StartLobbyState,
  input: { pressedByPlayerId: string | null } & DecideStartOptions,
): AdminWriteResult<StartLobbyPlan> {
  if (state.liveLobbyId !== null) return writeFailed(409, LOBBY_ALREADY_OPEN);
  if (state.pendingCreateId !== null) return writeFailed(409, LOBBY_ALREADY_OPENING);

  const host = chooseHost(state.hosts, input.pressedByPlayerId);
  if (host === null) return writeFailed(409, NO_COMPANION_AROUND);

  const now = input.now ?? new Date();
  const cycle = state.lobbiesTonight + 1;

  return writeOk({
    host,
    hostName: hostLabel(host),
    lobbyName: lobbyNameFor(now, cycle, input.timeZone ?? DEFAULT_NIGHT_TIME_ZONE),
    lobbyPassword: (input.password ?? generateLobbyPassword)(),
    cycle,
  });
}

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------

/** The queue's own TTL for this kind, so the answer's `expiresAt` is the row's, not a second number. */
const CREATE_LOBBY_TTL_MS = COMPANION_COMMAND_TTL_MS.create_lobby;

/** Statuses a lobby that is live right now can be in (`lib/ingest/lobby.ts`'s own list). */
const LIVE_LOBBY_STATUSES = ['open', 'balanced', 'in_game'] as const;

export async function readStartLobbyState(
  client: ServiceClient,
  options: { now?: Date; timeZone?: string } = {},
): Promise<StartLobbyState> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const window = nightWindow(now, timeZone);
  const seenSince = new Date(now.getTime() - HOST_WINDOW_MS).toISOString();

  const [live, tonight, pending, tokens] = await Promise.all([
    client
      .from('lobbies')
      .select('id')
      .in('status', [...LIVE_LOBBY_STATUSES])
      .gte('created_at', window.start)
      .lte('created_at', window.until)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('lobbies')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', window.start)
      .lte('created_at', window.until),
    client
      .from('companion_commands')
      .select('id')
      .eq('kind', 'create_lobby')
      .in('status', ['pending', 'sent'])
      // A `create_lobby` that can still run **now**: its expiry is ahead of this instant and at
      // most one TTL ahead of it, because that is how the writer sets it. The upper bound is
      // what keeps the window one night wide rather than open-ended.
      .gt('expires_at', window.until)
      .lte('expires_at', new Date(now.getTime() + CREATE_LOBBY_TTL_MS).toISOString())
      .limit(1)
      .maybeSingle(),
    client
      .from('companion_tokens')
      .select('player_id, last_seen_at, players!inner(id, puuid, display_name, game_name, tag_line)')
      .is('revoked_at', null)
      .gte('last_seen_at', seenSince)
      .lte('last_seen_at', window.until),
  ]);

  if (live.error) throw new Error(`readStartLobbyState: live lobby: ${live.error.message}`);
  if (tonight.error) throw new Error(`readStartLobbyState: lobbies tonight: ${tonight.error.message}`);
  if (pending.error) throw new Error(`readStartLobbyState: pending create: ${pending.error.message}`);
  if (tokens.error) throw new Error(`readStartLobbyState: tokens: ${tokens.error.message}`);

  // One player, one host candidate, even with two tokens on two machines: the freshest wins.
  const hosts = new Map<string, HostCandidate>();
  for (const row of tokens.data ?? []) {
    if (row.last_seen_at === null) continue;
    const lastSeenAt = new Date(row.last_seen_at);
    const seen = hosts.get(row.player_id);
    if (seen !== undefined && seen.lastSeenAt.getTime() >= lastSeenAt.getTime()) continue;
    hosts.set(row.player_id, {
      playerId: row.player_id,
      puuid: row.players.puuid,
      displayName: row.players.display_name,
      gameName: row.players.game_name,
      tagLine: row.players.tag_line,
      lastSeenAt,
    });
  }

  return {
    liveLobbyId: live.data?.id ?? null,
    pendingCreateId: pending.data?.id ?? null,
    lobbiesTonight: tonight.count ?? 0,
    hosts: [...hosts.values()],
  };
}

// ---------------------------------------------------------------------------
// The press
// ---------------------------------------------------------------------------

export interface StartLobbyOptions extends DecideStartOptions {
  /** Tests only: per-kind override of the verification gate. Production reads the constant. */
  gate?: CommandGate;
}

export interface StartLobbyOutcome extends StartLobbyPlan {
  /** The `companion_commands` row that was written. The page polls its status. */
  commandId: string;
  /** 60 s out (`COMPANION_COMMAND_TTL_MS.create_lobby`), after which nothing was created. */
  expiresAt: string;
}

/**
 * One press: read the night, decide, write exactly one `create_lobby` row.
 *
 * **The gate first, before any read.** `create_lobby` **and** `invite` must both be green
 * (`lib/commands/gate.ts`): a lobby that opens and invites nobody is worse than no lobby, so
 * the two kinds gate this route together. Both went green on 16.18 (2026-09-12), so the press
 * gets a real lobby; with either off again — a patch breaks the path, or a test passes a `gate` —
 * this answers 409 with the "not verified" sentence and touches nothing at all.
 *
 * Idempotent, and idempotent in the database rather than in this function (M4.9). The pending
 * `create_lobby` row is the lock in two places now: `decideStart` reads it and gives the
 * friendly refusal, and `companion_commands_one_create_lobby_idx` (`0008`) enforces it for the
 * two presses that read the same empty table in the same millisecond. The loser of that race
 * gets the identical 409 and the identical sentence, so no caller can tell which path refused
 * it. There is no unlock — an ack, a non-retryable nack or the expiry sweep takes the row out of `pending`
 * and `sent`, and that releases it.
 */
export async function startLobby(
  client: ServiceClient,
  input: { pressedByPlayerId: string | null },
  options: StartLobbyOptions = {},
): Promise<AdminWriteResult<StartLobbyOutcome>> {
  if (!isCommandKindEnabled('create_lobby', options.gate) || !isCommandKindEnabled('invite', options.gate)) {
    return writeFailed(409, LOBBY_WRITES_UNVERIFIED);
  }

  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;

  // Expiry first, because from `0008` on a live `create_lobby` row is a lock on the whole table
  // and an expired one that nobody has swept would hold it. The sweep normally runs on every
  // companion poll; a host whose client went away between the last poll and this press is
  // exactly the case where it has not, and that must not cost the group its next lobby. One
  // statement, the same one the poll runs, and it settles nothing that is still in date.
  await sweepExpiredCommands(client, now);

  const state = await readStartLobbyState(client, { now, timeZone });
  const decided = decideStart(state, {
    ...options,
    now,
    timeZone,
    pressedByPlayerId: input.pressedByPlayerId,
  });
  if (!decided.ok) return decided;

  const plan = decided.value;
  const { queued, skipped } = await enqueueCommands(
    client,
    [
      {
        targetPlayerId: plan.host.playerId,
        kind: 'create_lobby',
        payload: { lobbyName: plan.lobbyName, lobbyPassword: plan.lobbyPassword },
      },
    ],
    { now, gate: options.gate },
  );

  const commandId = queued[0];
  if (commandId === undefined) {
    // The race the read above cannot win: somebody else's press inserted between our read and
    // our write, and `companion_commands_one_create_lobby_idx` refused this one (M4.9). The
    // same 409 and the same sentence `decideStart` would have given a second later.
    if (skipped.some((row) => row.reason === 'conflict')) return writeFailed(409, LOBBY_ALREADY_OPENING);
    // Otherwise: the gate flipped between the check above and the write, or the payload failed
    // its own schema — both of them our bug, and neither is the presser's problem.
    return writeFailed(409, LOBBY_WRITES_UNVERIFIED);
  }

  // The password is a `debug` line at most, never `info` (M4.1, acceptance check 12).
  console.info(`start a lobby: queued create_lobby ${commandId} on ${plan.hostName}'s companion`);

  return writeOk({
    ...plan,
    commandId,
    expiresAt: new Date(now.getTime() + CREATE_LOBBY_TTL_MS).toISOString(),
  });
}
