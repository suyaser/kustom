import type { CompanionCommandInsert, CompanionCommandRow } from '@customs/db';
import {
  COMMANDS_PAGE_SIZE,
  COMPANION_COMMAND_TTL_MS,
  type CompanionCommand,
  type CompanionCommandEnvelope,
  type CompanionCommandKind,
  companionCommandPayloadSchemas,
  companionCommandResultSchemas,
} from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { type CommandGate, isCommandKindEnabled } from './gate';
import { emitCommandAcked } from './hooks';

/**
 * The command queue's rules (M4.1, server half). The wire contract is the doc comment on
 * `companionCommandsResponseSchema` in `@customs/db/schemas`; this file implements it and the
 * three route handlers do nothing but parse, call in here and answer.
 *
 * What lives here and nowhere else:
 *
 * - **The TTLs** (`COMPANION_COMMAND_TTL_MS`, shared with the companion) applied at write time,
 *   and the expiry sweep that fails a row the moment it is past `expires_at`. The server owns
 *   expiry; the companion never compares `expires_at` with its own clock.
 * - **The hand-out**: oldest first, at most ten, the token's player only, `sent` +
 *   `attempts + 1`, a `sent` row reclaimed after 30 s, and the fourth delivery failing the row
 *   instead of handing it out again.
 * - **Settling**: ack, nack and retryable nack, each a compare-and-set so two acks of one row
 *   cannot both win.
 * - **Superseding**: a lobby that leaves `balanced`, or a reroll, fails the rows the old split
 *   asked for. Nobody is dragged to a side from a split the group has moved on from.
 *
 * Nothing in here is allowed to decide *what* to queue: that is `switchSide.ts` (M4.3) and
 * M4.2's start-a-lobby route. And nothing in here is allowed to POST to a client: the
 * companion is the only thing that talks to League.
 */

/** A `sent` row is offered again only after this long, so a companion mid-execution is not raced. */
export const COMMANDS_RECLAIM_MS = 30_000;

/**
 * How many times one row may be handed out. The delivery that would make `attempts` four fails
 * it instead: a command that has killed the companion three times is not going to work now.
 */
export const COMMANDS_MAX_DELIVERIES = 3;

/** The three errors the server writes itself. Everything else in `error` came from a nack. */
export const COMMAND_ERRORS = {
  expired: 'expired',
  notAcked: `not acked after ${COMMANDS_MAX_DELIVERIES} deliveries`,
  superseded: 'superseded',
} as const;

/** `superseded`, plus why, in the "reason: detail" shape a nack uses. */
export function supersededError(detail?: string): string {
  return detail ? `${COMMAND_ERRORS.superseded}: ${detail}` : COMMAND_ERRORS.superseded;
}

/** The live statuses: a row that is still worth handing out or settling. */
const LIVE_STATUSES = ['pending', 'sent'] as const;

const CLAIM_COLUMNS = 'id, kind, payload, created_at, expires_at, attempts, sent_at, status';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored row as the wire wants it. Timestamps are normalised through `Date` so the answer is
 * always `...Z` and never PostgREST's microsecond `+00:00`, which
 * `companionCommandEnvelopeSchema` would still accept but which no two rows would spell the
 * same way.
 */
function toEnvelope(row: {
  id: string;
  kind: CompanionCommandKind;
  payload: unknown;
  created_at: string;
  expires_at: string;
}): CompanionCommandEnvelope {
  return {
    id: row.id,
    kind: row.kind,
    // A payload that is not an object cannot happen through `enqueueCommands`; if one ever
    // does, the companion nacks `malformed_payload` rather than the whole page failing.
    payload: isObject(row.payload) ? row.payload : {},
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * One row to write: who it is for, the group it belongs to, and a kind with the payload that kind
 * takes. `groupId` is the target token's group (M13.3): a host in two groups polls with two
 * tokens, and each token is handed its own group's rows only.
 */
export type CommandToQueue = CompanionCommand & { targetPlayerId: string; groupId: string };

export interface EnqueueOptions {
  now?: Date | undefined;
  /** Tests only: per-kind override of the verification gate. */
  gate?: CommandGate | undefined;
}

/**
 * Why a command asked for was not written.
 *
 * - `gated` — its verification row is not green (`gate.ts`). No database call was made.
 * - `malformed` — the payload failed its own kind's schema. Our bug, logged and dropped.
 * - `conflict` — the database refused it. Only `create_lobby` can hit this: `0008` allows at
 *   most one of them in `pending` or `sent` at a time, so a second press in the same instant
 *   loses the race here rather than opening a second lobby (M4.9).
 */
export type EnqueueSkipReason = 'gated' | 'malformed' | 'conflict';

export interface EnqueueResult {
  /** The ids written, in the order they were asked for. */
  queued: string[];
  /** What was not written and why, one line per command. Never an error: this is normal. */
  skipped: { kind: CompanionCommandKind; reason: EnqueueSkipReason }[];
}

/**
 * The Start-a-lobby lock, as `0008_one_create_lobby_at_a_time.sql` spells it: a unique index
 * over `kind` where `kind = 'create_lobby' and status in ('pending', 'sent')`. Named here
 * because the only way to tell this violation from any other unique violation on the table is
 * the index name Postgres puts in the message.
 */
export const CREATE_LOBBY_LOCK_INDEX = 'companion_commands_one_create_lobby_idx';

/** Postgres `unique_violation`. PostgREST hands it back as the error's `code`. */
const UNIQUE_VIOLATION = '23505';

/** A PostgREST error, narrowed to the three fields that say which constraint refused a write. */
interface WriteError {
  code?: string | undefined;
  message?: string | undefined;
  details?: string | null | undefined;
}

/**
 * Is this the create-lobby lock refusing a second live `create_lobby`?
 *
 * A `23505` on `companion_commands` can only be this index today, but matching the name as
 * well as the code keeps that true after the next migration: a different constraint would be a
 * different bug and must still throw.
 */
export function isCreateLobbyLockViolation(error: WriteError | null): boolean {
  if (error === null || error.code !== UNIQUE_VIOLATION) return false;
  return `${error.message ?? ''} ${error.details ?? ''}`.includes(CREATE_LOBBY_LOCK_INDEX);
}

/**
 * Write commands. Each row's `expires_at` is `now + the kind's TTL`, and a kind whose
 * verification row is not green is skipped without a database call — the gate is what stops an
 * unverified path being POSTed by anybody, ever (`04-decisions.md`, 2026-09-09).
 *
 * The payload is parsed with its kind's schema before it is stored: a bad payload here is our
 * bug, and the queue is not the place to find out about it at 21:40. It is logged and dropped
 * rather than thrown, because the caller is a hook on the `balanced` transition and a bad
 * command must never cost the group its teams.
 *
 * A `create_lobby` that the database refuses because one is already live (`0008`, the
 * Start-a-lobby lock) is `skipped: 'conflict'` for the same reason: losing a race is a normal
 * outcome with a sentence of its own, not a 500. Every other write error still throws.
 */
export async function enqueueCommands(
  client: ServiceClient,
  commands: readonly CommandToQueue[],
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const now = options.now ?? new Date();
  const result: EnqueueResult = { queued: [], skipped: [] };
  const inserts: CompanionCommandInsert[] = [];

  for (const command of commands) {
    if (!isCommandKindEnabled(command.kind, options.gate)) {
      result.skipped.push({ kind: command.kind, reason: 'gated' });
      continue;
    }
    const parsed = companionCommandPayloadSchemas[command.kind].safeParse(command.payload);
    if (!parsed.success) {
      console.error(
        `enqueueCommands: ${command.kind} payload failed its own schema; not queued`,
        parsed.error.issues,
      );
      result.skipped.push({ kind: command.kind, reason: 'malformed' });
      continue;
    }
    inserts.push({
      target_player_id: command.targetPlayerId,
      group_id: command.groupId,
      kind: command.kind,
      payload: parsed.data,
      expires_at: new Date(now.getTime() + COMPANION_COMMAND_TTL_MS[command.kind]).toISOString(),
    });
  }

  if (inserts.length === 0) return result;

  const { data, error } = await client.from('companion_commands').insert(inserts).select('id');
  if (error === null) {
    result.queued = (data ?? []).map((row) => row.id);
    return result;
  }

  // Anything but the create-lobby lock is a real failure and still throws.
  if (!isCreateLobbyLockViolation(error)) throw new Error(`enqueueCommands: ${error.message}`);

  // The lock (M4.9): a `create_lobby` is already live, so this one is not written and the
  // caller is told which kind lost and why. `startLobby` turns that into the same 409 and the
  // same sentence as its own read-first refusal — a presser cannot tell the two apart, and
  // that is the point.
  for (const row of inserts) {
    if (row.kind === 'create_lobby') result.skipped.push({ kind: 'create_lobby', reason: 'conflict' });
  }
  console.info('enqueueCommands: a create_lobby is already live; the lock refused a second one');

  // Nothing in this codebase mixes `create_lobby` with another kind in one batch, but an insert
  // is all-or-nothing: retry the rest so a future batch cannot lose an invite to somebody
  // else's double tap.
  const rest = inserts.filter((row) => row.kind !== 'create_lobby');
  if (rest.length === 0) return result;

  const retry = await client.from('companion_commands').insert(rest).select('id');
  if (retry.error) throw new Error(`enqueueCommands: ${retry.error.message}`);
  result.queued = (retry.data ?? []).map((row) => row.id);
  return result;
}

/**
 * Fail every live row of these kinds for these players. Used when a split stops being the
 * answer: the lobby left `balanced`, or a reroll promoted another split. The rows go to
 * `failed` with `superseded` so the queue's history says what happened, and `acked_at` is set
 * because the row is settled — nothing will ever come back for it.
 *
 * Returns how many rows it settled, for the log line.
 */
export async function supersedeCommands(
  client: ServiceClient,
  input: {
    playerIds: readonly string[];
    kinds: readonly CompanionCommandKind[];
    error: string;
    now?: Date;
  },
): Promise<number> {
  if (input.playerIds.length === 0 || input.kinds.length === 0) return 0;
  const now = input.now ?? new Date();

  const { data, error } = await client
    .from('companion_commands')
    .update({ status: 'failed', error: input.error, acked_at: now.toISOString(), result: null })
    .in('target_player_id', [...input.playerIds])
    .in('kind', [...input.kinds])
    .in('status', [...LIVE_STATUSES])
    .select('id');
  if (error) throw new Error(`supersedeCommands: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Every live command for this lobby's members, superseded. Called from the state machine when
 * a lobby leaves `balanced` (`lib/lobbyState.ts`): the split those commands were written for
 * is no longer the split, and a `switch_side` that lands afterwards moves somebody for no
 * reason.
 *
 * Scoped by member rather than by lobby because `companion_commands` has no `lobby_id` and does
 * not need one: a player is in at most one live lobby (`lobbies_active_party_idx`), so their
 * live rows are that lobby's rows.
 *
 * `create_lobby` and `invite` are deliberately **not** superseded — those two are how a lobby
 * gets filled in the first place, and the lobby leaving `balanced` (to `in_game`, say) says
 * nothing about whether an invite is still worth popping up. Their own TTL is what gives up on
 * them.
 */
export async function supersedeLobbyCommands(
  client: ServiceClient,
  lobbyId: string,
  detail: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await client.from('lobby_members').select('player_id').eq('lobby_id', lobbyId);
  if (error) throw new Error(`supersedeLobbyCommands: member select failed: ${error.message}`);

  const playerIds = (data ?? []).map((row) => row.player_id);
  const settled = await supersedeCommands(client, {
    playerIds,
    kinds: ['switch_side'],
    error: supersededError(detail),
    now,
  });
  if (settled > 0) {
    console.info(`lobby ${lobbyId}: superseded ${settled} pending switch_side command(s) (${detail})`);
  }
  return settled;
}

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

/**
 * One cheap statement at the top of every poll, whatever `clientConnected` says: a row past
 * its `expires_at` is `failed` with `expired` and is never handed to anybody. This is the whole
 * of expiry — the writer sets `expires_at`, the sweep enforces it, and no other clock is
 * consulted anywhere in the system.
 */
export async function sweepExpiredCommands(client: ServiceClient, now: Date = new Date()): Promise<number> {
  const { data, error } = await client
    .from('companion_commands')
    .update({ status: 'failed', error: COMMAND_ERRORS.expired, acked_at: now.toISOString() })
    .in('status', [...LIVE_STATUSES])
    .lte('expires_at', now.toISOString())
    .select('id');
  if (error) throw new Error(`sweepExpiredCommands: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Hand out this player's work **in the polling token's group**: up to ten rows, oldest first,
 * each one claimed with a compare-and-set on `attempts` so two polls of the same token cannot
 * both take the same row. A host in two groups polls with two tokens (M13.8) and each poll gets
 * its own group's rows only (M13.3).
 *
 * A `sent` row is a candidate again after {@link COMMANDS_RECLAIM_MS} — long enough that a
 * companion mid-execution is not raced by its own next poll, short enough that a crash costs
 * one poll. The delivery that would make `attempts` four fails the row instead.
 *
 * The caller must have swept first; nothing here looks at expiry beyond refusing to hand out a
 * row that is already past it.
 */
export async function claimCommands(
  client: ServiceClient,
  targetPlayerId: string,
  groupId: string,
  now: Date = new Date(),
): Promise<CompanionCommandEnvelope[]> {
  const nowIso = now.toISOString();
  const reclaimBefore = new Date(now.getTime() - COMMANDS_RECLAIM_MS).toISOString();

  const { data, error } = await client
    .from('companion_commands')
    .select(CLAIM_COLUMNS)
    .eq('target_player_id', targetPlayerId)
    .eq('group_id', groupId)
    .in('status', [...LIVE_STATUSES])
    .gt('expires_at', nowIso)
    // A pending row, or a sent one whose 30 seconds are up (or that somehow never recorded
    // when it went out).
    .or(`status.eq.pending,sent_at.is.null,sent_at.lte.${reclaimBefore}`)
    .order('created_at', { ascending: true })
    .limit(COMMANDS_PAGE_SIZE);
  if (error) throw new Error(`claimCommands: ${error.message}`);

  const claimed: CompanionCommandEnvelope[] = [];
  for (const row of data ?? []) {
    if (row.attempts >= COMMANDS_MAX_DELIVERIES) {
      await failUndelivered(client, row.id, row.attempts, now);
      continue;
    }

    const { data: taken, error: takeError } = await client
      .from('companion_commands')
      .update({ status: 'sent', sent_at: nowIso, attempts: row.attempts + 1 })
      .eq('id', row.id)
      // The compare-and-set: whoever reads `attempts` first writes it, and the loser sees no
      // row back and simply does not hand this one out.
      .eq('attempts', row.attempts)
      .in('status', [...LIVE_STATUSES])
      .gt('expires_at', nowIso)
      .select('id, kind, payload, created_at, expires_at')
      .maybeSingle();
    if (takeError) throw new Error(`claimCommands: hand-out failed: ${takeError.message}`);
    if (taken === null) continue;

    claimed.push(toEnvelope(taken));
  }

  return claimed;
}

/** The fourth delivery: the row is failed instead of handed out, and never returned again. */
async function failUndelivered(
  client: ServiceClient,
  id: string,
  attempts: number,
  now: Date,
): Promise<void> {
  const { error } = await client
    .from('companion_commands')
    .update({ status: 'failed', error: COMMAND_ERRORS.notAcked, acked_at: now.toISOString() })
    .eq('id', id)
    .in('status', [...LIVE_STATUSES]);
  if (error) throw new Error(`claimCommands: giving up on ${id} failed: ${error.message}`);
  console.warn(`command ${id}: handed out ${attempts} times with no ack; giving up`);
}

// ---------------------------------------------------------------------------
// Ack and nack
// ---------------------------------------------------------------------------

export type CommandLookup =
  | { ok: true; row: CompanionCommandRow }
  | { ok: false; status: 404 | 409; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The row this ack or nack is about, or the refusal.
 *
 * - **404** for an id that is not a uuid, does not exist, **or belongs to another player** -- or
 *   to the same player in another group than the token's (M13.3). Never 403: a 403 would confirm
 *   that somebody else's command id exists.
 * - **409** for a row that is already `acked` or `failed`, and nothing changes. The companion
 *   reads that as "already recorded" — the other half of execute-once, for the ack that was
 *   lost after the client call had already happened.
 */
export async function readCommandForPlayer(
  client: ServiceClient,
  input: { id: string; targetPlayerId: string; groupId: string },
): Promise<CommandLookup> {
  if (!UUID_RE.test(input.id)) {
    // Refused before the query: `id=eq.<not a uuid>` is a Postgres 22P02, which would be a 500.
    return { ok: false, status: 404, error: 'no such command' };
  }

  const { data, error } = await client
    .from('companion_commands')
    .select('*')
    .eq('id', input.id)
    .eq('target_player_id', input.targetPlayerId)
    .eq('group_id', input.groupId)
    .maybeSingle();
  if (error) throw new Error(`readCommandForPlayer: ${error.message}`);
  if (data === null) return { ok: false, status: 404, error: 'no such command' };
  if (data.status === 'acked' || data.status === 'failed') {
    return { ok: false, status: 409, error: `command is already ${data.status}` };
  }
  return { ok: true, row: data };
}

export type SettleResult = { ok: true } | { ok: false; status: 409 | 422; error: string };

/**
 * `outcome: done`. The result is parsed with the kind's schema first: a result that fails it is
 * **422 and the row is left alone**, because a mangled result is a companion bug and losing it
 * is better than storing a lie M4.2 will read.
 */
export async function ackCommand(
  client: ServiceClient,
  input: { row: CompanionCommandRow; result: unknown; now?: Date },
): Promise<SettleResult> {
  const parsed = companionCommandResultSchemas[input.row.kind].safeParse(input.result);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      error: `result does not match the ${input.row.kind} result schema`,
    };
  }

  const now = input.now ?? new Date();
  const { data, error } = await client
    .from('companion_commands')
    .update({ status: 'acked', acked_at: now.toISOString(), result: parsed.data, error: null })
    .eq('id', input.row.id)
    .in('status', [...LIVE_STATUSES])
    .select('id');
  if (error) throw new Error(`ackCommand: ${error.message}`);
  // Somebody settled it between the read and the write: the sweep, or a second ack.
  if ((data ?? []).length === 0) return { ok: false, status: 409, error: 'command is already settled' };

  await emitCommandAcked({
    commandId: input.row.id,
    targetPlayerId: input.row.target_player_id,
    groupId: input.row.group_id,
    kind: input.row.kind,
    status: 'acked',
    result: parsed.data as Record<string, unknown>,
    error: null,
  });
  return { ok: true };
}

/**
 * `outcome: failed`, in two flavours.
 *
 * - `retryable: false` — the command ran, or was refused for a reason that will not change:
 *   `failed`, `acked_at` set, the nack text stored verbatim, `result` null, hooks run.
 * - `retryable: true` — **nothing was executed** (`not_connected`, or a client that gave no
 *   HTTP answer at all). Back to `pending` with `sent_at` cleared so the next poll offers it
 *   again inside its TTL, `attempts` **unchanged** (the contract's word: a retryable nack does
 *   not refund the delivery, so three of them still give up on the row), `error` kept for the
 *   log, and no hook — nothing has happened yet for anybody to hear about.
 */
export async function nackCommand(
  client: ServiceClient,
  input: { row: CompanionCommandRow; error: string; retryable: boolean; now?: Date },
): Promise<SettleResult> {
  const now = input.now ?? new Date();
  const error = input.error.slice(0, 500);

  const update = input.retryable
    ? { status: 'pending' as const, sent_at: null, error }
    : { status: 'failed' as const, acked_at: now.toISOString(), error, result: null };

  const { data, error: writeError } = await client
    .from('companion_commands')
    .update(update)
    .eq('id', input.row.id)
    .in('status', [...LIVE_STATUSES])
    .select('id');
  if (writeError) throw new Error(`nackCommand: ${writeError.message}`);
  if ((data ?? []).length === 0) return { ok: false, status: 409, error: 'command is already settled' };

  if (!input.retryable) {
    await emitCommandAcked({
      commandId: input.row.id,
      targetPlayerId: input.row.target_player_id,
      groupId: input.row.group_id,
      kind: input.row.kind,
      status: 'failed',
      result: null,
      error,
    });
  }
  return { ok: true };
}
