import 'server-only';
import { randomInt } from 'node:crypto';
import type { ModeState } from '@customs/core';
import { COMPANION_COMMAND_TTL_MS, type CreateLobbyCommandPayload } from '@customs/db/schemas';
import { type NameableRow, playerLabel } from './admin/playerName';
import { type AdminWriteResult, writeFailed, writeOk } from './admin/result';
import {
  type CommandGate,
  enqueueCommands,
  isCommandKindEnabled,
  nightWindow,
  sweepExpiredCommands,
} from './commands';
import {
  LOBBY_ALREADY_OPEN,
  LOBBY_ALREADY_OPENING,
  LOBBY_WRITES_UNVERIFIED,
  noKustomRunningLine,
} from './lobbyStartCopy';
import { supabaseModeStore } from './mode/state';
import { DEFAULT_NIGHT_TIME_ZONE, formatDayMonth } from './night';
import type { ServiceClient } from './supabase';
import { adminNames, isNameless, renderWebName } from './tonight/copy';

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
 * even on the payload — the companion reads the client's own custom-queue list and picks the
 * entry for `pickType` (`04-decisions.md`, 2026-09-09 and 2026-09-10), so no queue id is a
 * constant on this side. `pickType` is the server's call (M17.17): blind when the next game's
 * rule is mirror match, draft otherwise.
 *
 * **Every read is bounded by `now` at both ends** — the night's 06:00 and `now` itself — so
 * "tonight" means one night and an injected clock names exactly the night it says. In
 * production the upper bound is a no-op; nothing is created in the future.
 */

// The words live in `./lobbyStartCopy` (M14.44) so a client component can import them without
// `node:crypto`; re-exported here so the server side keeps one import.
export {
  alreadyHasALobbyLine,
  type CreateLobbyProgress,
  invitedLine,
  LOBBY_ALREADY_OPEN,
  LOBBY_ALREADY_OPENING,
  LOBBY_WRITES_UNVERIFIED,
  NO_CLIENT_ANSWERED,
  NO_COMPANION_AROUND,
  noKustomRunningLine,
  openingOnPcLine,
  START_LOBBY_BUTTON,
  startLobbySentence,
} from './lobbyStartCopy';

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

/** `Hamoodi`, else `Ahmed#EUW`, else `Someone` — the admin pages' own chain (M1.7, M14.60). */
export function hostLabel(host: HostCandidate): string {
  const row: NameableRow = {
    puuid: host.puuid,
    displayName: host.displayName,
    gameName: host.gameName,
    tagLine: host.tagLine,
  };
  return playerLabel(row);
}

/**
 * The pick type of the lobby the next game needs (M17.17). Mirror match is Blind Pick (every
 * player picks the lane opponent's champion in secret); every other rule and both standing modes
 * play Draft Pick, as the group always has.
 */
export function pickTypeFor(pending: ModeState['pending']): CreateLobbyCommandPayload['pickType'] {
  return pending?.id === 'mirror' ? 'blind' : 'draft';
}

/**
 * Read the group's card and answer {@link pickTypeFor}. A read that fails answers draft, loudly:
 * the press must still open the lobby the group always had rather than fail on the card.
 */
export async function readPickType(
  client: ServiceClient,
  groupId: string,
): Promise<CreateLobbyCommandPayload['pickType']> {
  try {
    return pickTypeFor((await supabaseModeStore(client).read(groupId)).state.pending);
  } catch (error) {
    console.error('start a lobby: reading the mode card failed; opening a draft lobby', error);
    return 'draft';
  }
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
  /**
   * Every host of the group by name, seen or not ({@link readGroupHostNames}, M14.66): who the
   * refusal tells the group to ask. Absent in older fixtures: read as none.
   */
  hostNames?: string[];
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
  // M14.66: name who to ask (up to three hosts), else `whoever hosts`.
  if (host === null) return writeFailed(409, noKustomRunningLine(adminNames(state.hostNames ?? [])));

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

/**
 * The night **of one group** (M13.3): its live lobby, its lobbies tonight (the `#n` in the name),
 * its pending `create_lobby`, and the hosts it can pick from -- the unrevoked tokens **whose
 * `group_id` is this group**, freshest first. A token of another group is never a host here, even
 * one seen more recently and even when its player is in both groups: that token posts to the
 * other group.
 */
export async function readStartLobbyState(
  client: ServiceClient,
  options: { groupId: string; now?: Date; timeZone?: string },
): Promise<StartLobbyState> {
  const now = options.now ?? new Date();
  const groupId = options.groupId;
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const window = nightWindow(now, timeZone);
  const seenSince = new Date(now.getTime() - HOST_WINDOW_MS).toISOString();

  const [live, tonight, pending, tokens, hostNames] = await Promise.all([
    client
      .from('lobbies')
      .select('id')
      .eq('group_id', groupId)
      .in('status', [...LIVE_LOBBY_STATUSES])
      .gte('created_at', window.start)
      .lte('created_at', window.until)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('lobbies')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .gte('created_at', window.start)
      .lte('created_at', window.until),
    client
      .from('companion_commands')
      .select('id')
      .eq('group_id', groupId)
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
      .eq('group_id', groupId)
      .is('revoked_at', null)
      .gte('last_seen_at', seenSince)
      .lte('last_seen_at', window.until),
    readGroupHostNames(client, groupId),
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
    hostNames,
  };
}

// ---------------------------------------------------------------------------
// The group's hosts, for the words (M14.66)
// ---------------------------------------------------------------------------

/** One unrevoked token of the group, as {@link readHostPresence} reads it. */
interface HostTokenRow {
  player_id: string;
  last_seen_at: string | null;
  players: { display_name: string | null; game_name: string | null; created_at: string };
}

async function selectGroupHostTokens(client: ServiceClient, groupId: string): Promise<HostTokenRow[]> {
  const { data, error } = await client
    .from('companion_tokens')
    .select('player_id, last_seen_at, players!inner(display_name, game_name, created_at)')
    .eq('group_id', groupId)
    .is('revoked_at', null);
  if (error) throw new Error(`group hosts: ${error.message}`);
  return data ?? [];
}

/**
 * The group's hosts by name (M14.66): every player with an unrevoked companion token **of this
 * group**, seen or not, oldest player first, named the way the strip names admins
 * (`display_name`, else the Riot game name, through `renderWebName`). Nameless hosts are dropped
 * rather than printed as `Someone`: `Ask Someone to open it` names nobody.
 */
function hostNamesOf(rows: readonly HostTokenRow[]): string[] {
  const byPlayer = new Map<string, HostTokenRow['players']>();
  for (const row of rows) byPlayer.set(row.player_id, row.players);
  return [...byPlayer.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.created_at.localeCompare(right.created_at) || leftId.localeCompare(rightId),
    )
    .map(([, player]) => player.display_name ?? player.game_name ?? null)
    .filter((name) => !isNameless(name))
    .map(renderWebName);
}

export async function readGroupHostNames(client: ServiceClient, groupId: string): Promise<string[]> {
  return hostNamesOf(await selectGroupHostTokens(client, groupId));
}

/** What Tonight shows before anyone taps (M14.66): who hosts, and whether any of them is up. */
export interface HostPresence {
  /** {@link readGroupHostNames}: every named host of the group, oldest player first. */
  hostNames: string[];
  /** An unrevoked token of the group seen inside {@link HOST_WINDOW_MS}: the press has a host. */
  hostSeenRecently: boolean;
}

/** One read for both facts; "recently" is {@link readStartLobbyState}'s host window. */
export async function readHostPresence(
  client: ServiceClient,
  options: { groupId: string; now?: Date | undefined },
): Promise<HostPresence> {
  const now = (options.now ?? new Date()).getTime();
  const rows = await selectGroupHostTokens(client, options.groupId);
  const hostSeenRecently = rows.some(
    (row) => row.last_seen_at !== null && Date.parse(row.last_seen_at) >= now - HOST_WINDOW_MS,
  );
  return { hostNames: hostNamesOf(rows), hostSeenRecently };
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
  /**
   * `groupId` is the group the press is for (M13.3): the host is the freshest token **of that
   * group** and the `create_lobby` row is written in it.
   */
  input: { pressedByPlayerId: string | null; groupId: string },
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

  const state = await readStartLobbyState(client, { groupId: input.groupId, now, timeZone });
  const decided = decideStart(state, {
    ...options,
    now,
    timeZone,
    pressedByPlayerId: input.pressedByPlayerId,
  });
  if (!decided.ok) return decided;

  const plan = decided.value;
  const pickType = await readPickType(client, input.groupId);
  const { queued, skipped } = await enqueueCommands(
    client,
    [
      {
        targetPlayerId: plan.host.playerId,
        // The host token's group, which is the press's group: that token is the one that polls it.
        groupId: input.groupId,
        kind: 'create_lobby',
        payload: { lobbyName: plan.lobbyName, lobbyPassword: plan.lobbyPassword, pickType },
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
