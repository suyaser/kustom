/**
 * The command runner (M4.1): polls `GET /api/companion/commands`, executes each command through
 * `@customs/lcu`'s lobby writes, and answers with an ack (result) or a nack (reason). The contract is the doc
 * comment on `companionCommandsResponseSchema` in `@customs/db/schemas`; this file implements it and nothing
 * else restates it.
 *
 * Rules, in the order they are applied to every command:
 *  1. **Executed once.** An id in `commands-done.json` (`executed.ts`) is re-acked from its record; no client
 *     call. The file is written after the client call and before the ack.
 *  2. **Stale** (held longer than its own TTL since the poll, e.g. the PC slept in between): `expired`. The
 *     server owns expiry; `expiresAt` is never compared with the local clock (`isStale`).
 *  3. **Malformed** (a kind the enum does not name, a payload that fails its schema): `malformed_payload`.
 *  4. **Gate.** A kind whose reference row is still `unverified` (`LOBBY_WRITE_VERIFICATION` in `@customs/lcu`)
 *     is `endpoint_unverified` with one log line naming the row; no client call. Tests override it.
 *  5. **No client:** `not_connected`, retryable, for the race where the socket dropped between the poll and the
 *     call. While disconnected the poll itself says `clientConnected=false` and is handed nothing.
 *  6. **Phase** other than `None`/`Lobby`: `wrong_phase`. Champion select and in-game are never states we act in.
 *  7. **Read before write.** Every executor GETs `/lol-lobby/v2/lobby` and compares: a second `create_lobby`
 *     finds a lobby and nacks `already_in_lobby`; a second `invite` finds the invitee and acks `done` without a
 *     POST; a second `switch_side` finds the player already there and acks `done` without a POST.
 *  8. **Ids from the client, never constants.** `create_lobby` reads `/lol-game-queues/v1/custom` for the
 *     Summoner's Rift subcategory's entries and `/lol-game-queues/v1/queues` to name them (16.18: the
 *     dialog's own entries carry no descriptive text at all, so the mode is resolved by joining the two on
 *     `id`, see `customLobbyIdsFor`), and takes the draft entry's id as the body's `queueId`/`mutators.id`,
 *     exactly as the client's own dialog does; when the join names no entry as draft, the command is
 *     `client_rejected` with the list in the nack, and nothing is posted.
 *
 * Polling: every `nextPollInMs` (5 s) while the client is connected, every `DISCONNECTED_POLL_INTERVAL_MS`
 * (60 s) with `clientConnected=false` while it is not (the answer is empty by contract, so the slower cadence
 * costs nothing). One command at a time, in the order handed out. Nothing here throws; nothing here stops the
 * process. The password of a lobby this companion created is kept in memory (`passwordFor`) so the lobby
 * watcher can send it with every lobby post for that party (M4.2), and it is logged at `debug` only. The lobby
 * `Create` event usually beats the post-write read that learns the party id, so the first lobby post after a
 * create may carry `lobbyPassword: null`; the password rides on the next roster change, and the server's
 * never-clear-on-null rule is what makes that harmless.
 */

import {
  COMMANDS_POLL_INTERVAL_MS,
  type CommandFailureReason,
  type CompanionCommandEnvelope,
  type CreateLobbyCommandPayload,
  type CreateLobbyCommandResult,
  companionCommandAckResponseSchema,
  companionCommandPayloadSchemas,
  companionCommandsResponseSchema,
  type InviteCommandPayload,
  type InviteCommandResult,
  type SwitchSideCommandPayload,
  type SwitchSideCommandResult,
} from '@customs/db/schemas';
import {
  CustomGameQueuesSchema,
  type CustomLobbyMode,
  customLobbyIdsFor,
  describeMutators,
  describeWriteResponse,
  GameflowPhaseSchema,
  GameQueuesSchema,
  inviteWithFallback,
  isLobbyWriteVerified,
  type LcuClient,
  LOBBY_WRITE_REFERENCE_ROW,
  type Lobby,
  LobbySchema,
  type LobbyWriteKind,
  postCreateLobby,
  postSwitchSide,
  readEndpoint,
  summonersRiftSubcategory,
} from '@customs/lcu';
import { type ApiClient, failureFields } from './api.js';
import type { CompanionHooks, ConnectedContext } from './connection.js';
import { type ExecutedEntry, ExecutedStore } from './executed.js';
import { realScheduler, type Scheduler } from './lobbyWatcher.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const COMMANDS_API_PATH = '/api/companion/commands';
export const LOBBY_PATH = readEndpoint('lobby').path;
export const GAMEFLOW_PHASE_PATH = readEndpoint('gameflow-phase').path;
/** Where a create body's `queueId` / `mutators.id` come from: the client's own Create Custom dialog data. */
export const CUSTOM_GAME_QUEUES_PATH = readEndpoint('custom-game-queues').path;
/**
 * The dialog's own mutator entries carry no descriptive text on 16.18 (`CustomGameMutatorSchema`), so the
 * mode is resolved by joining their ids against this list's names instead (`customLobbyIdsFor`).
 */
export const GAME_QUEUES_PATH = readEndpoint('game-queues').path;
/** The pick mode a `create_lobby` opens unless it asks otherwise (docs/04-decisions.md, 2026-09-09: the group plays draft). */
export const CREATE_LOBBY_MODE: CustomLobbyMode = 'draft';
/** M17.17: the payload's `pickType` names the mode; a mirror game's `create_lobby` asks for blind. */
export function createLobbyModeFor(pickType: 'draft' | 'blind'): CustomLobbyMode {
  return pickType === 'blind' ? 'blind' : CREATE_LOBBY_MODE;
}
/** The poll while the client is away: the answer is empty by contract, so this is a heartbeat, not a queue. */
export const DISCONNECTED_POLL_INTERVAL_MS = 60_000;
/** The only phases a command runs in. Anything else is `wrong_phase`. */
export const ACTIONABLE_PHASES: readonly string[] = ['None', 'Lobby'];
/** A custom side holds five; the sixth would be refused by the client, so it is refused here first. */
export const MAX_TEAM_SIZE = 5;

export function commandAckPath(id: string): string {
  return `${COMMANDS_API_PATH}/${encodeURIComponent(id)}/ack`;
}

export function commandNackPath(id: string): string {
  return `${COMMANDS_API_PATH}/${encodeURIComponent(id)}/nack`;
}

export type CommandOutcome =
  | { readonly outcome: 'done'; readonly result: Record<string, unknown> }
  | { readonly outcome: 'failed'; readonly error: string; readonly retryable: boolean };

function failed(reason: CommandFailureReason, detail?: string, retryable = false): CommandOutcome {
  const error = detail && detail.length > 0 ? `${reason}: ${detail}` : reason;
  return { outcome: 'failed', error: error.slice(0, 500), retryable };
}

function done(result: Record<string, unknown>): CommandOutcome {
  return { outcome: 'done', result };
}

/** The nack text of a failed outcome, for a log line; a done outcome has none. */
function outcomeError(outcome: CommandOutcome): string {
  return outcome.outcome === 'failed' ? outcome.error : 'done';
}

type LobbyRead =
  | { readonly kind: 'lobby'; readonly lobby: Lobby }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly outcome: CommandOutcome };

const KINDS: readonly LobbyWriteKind[] = ['create_lobby', 'invite', 'switch_side'];

function isKind(value: string): value is LobbyWriteKind {
  return (KINDS as readonly string[]).includes(value);
}

export interface CommandRunnerOptions {
  readonly api: ApiClient;
  readonly configDir: string;
  readonly logger?: CompanionLogger;
  readonly now?: () => number;
  readonly schedule?: Scheduler;
  /** Poll interval while connected, until the server dials it. Default 5 s. */
  readonly pollIntervalMs?: number;
  readonly disconnectedPollIntervalMs?: number;
  /** Attempts for an ack or nack. Default 2. */
  readonly ackAttempts?: number;
  /** Tests only: per-kind override of the verification gate. Production reads `@customs/lcu`. */
  readonly gate?: Partial<Record<LobbyWriteKind, boolean>>;
  readonly executed?: ExecutedStore;
}

export class CommandRunner {
  private readonly api: ApiClient;
  private readonly logger: CompanionLogger;
  private readonly now: () => number;
  private readonly schedule: Scheduler;
  private readonly pollIntervalMs: number;
  private readonly disconnectedPollIntervalMs: number;
  private readonly ackAttempts: number;
  private readonly gate: Partial<Record<LobbyWriteKind, boolean>>;
  private readonly executed: ExecutedStore;
  private readonly passwords = new Map<string, string>();

  private context: ConnectedContext | null = null;
  private phase: string | null = null;
  private started = false;
  private stopped = false;
  private polling = false;
  private pollAgain = false;
  private timer: (() => void) | null = null;
  private nextPollInMs: number;
  private lastPollFailure: string | null = null;

  constructor(options: CommandRunnerOptions) {
    this.api = options.api;
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'commands' });
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? realScheduler;
    this.pollIntervalMs = options.pollIntervalMs ?? COMMANDS_POLL_INTERVAL_MS;
    this.nextPollInMs = this.pollIntervalMs;
    this.disconnectedPollIntervalMs = options.disconnectedPollIntervalMs ?? DISCONNECTED_POLL_INTERVAL_MS;
    this.ackAttempts = options.ackAttempts ?? 2;
    this.gate = options.gate ?? {};
    this.executed =
      options.executed ??
      new ExecutedStore({ configDir: options.configDir, logger: this.logger, now: this.now });
  }

  hooks(): CompanionHooks {
    return {
      onConnected: (context) => {
        this.context = context;
        this.phase = context.phase;
        // A command queued while the client was away should not wait a whole disconnected interval.
        this.requestPoll();
      },
      onGameflowPhase: (phase) => {
        this.phase = phase;
      },
      onDisconnected: () => {
        this.context = null;
        this.phase = null;
      },
    };
  }

  /** Whether a kind may run here. The gate is `@customs/lcu`'s; tests override it per kind. */
  isEnabled(kind: LobbyWriteKind): boolean {
    return this.gate[kind] ?? isLobbyWriteVerified(kind);
  }

  /** The password this companion set for a party, for the lobby post (M4.2). Null for any other party. */
  passwordFor(partyId: string): string | null {
    return this.passwords.get(partyId) ?? null;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.requestPoll();
  }

  stop(): void {
    this.stopped = true;
    this.timer?.();
    this.timer = null;
    this.context = null;
  }

  /** Resolves once no poll is running or requested. Tests use it. */
  settled(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = (): void => {
        if (!this.polling && !this.pollAgain) {
          resolve();
        } else if (Date.now() - startedAt > timeoutMs) {
          reject(new Error('command runner did not settle'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  /** One poll and the execution of everything it returned. Never throws. Tests call it directly. */
  async pollNow(): Promise<void> {
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    this.timer?.();
    this.timer = null;
    try {
      await this.poll();
    } catch (error) {
      this.logger.error('command poll threw', errorFields(error));
    } finally {
      this.polling = false;
    }
    if (this.pollAgain) {
      this.pollAgain = false;
      if (!this.stopped) {
        void this.pollNow();
      }
      return;
    }
    this.scheduleNext();
  }

  private requestPoll(): void {
    if (!this.started || this.stopped) {
      return;
    }
    void this.pollNow();
  }

  private scheduleNext(): void {
    if (!this.started || this.stopped) {
      return;
    }
    this.timer?.();
    const delay = this.context !== null ? this.nextPollInMs : this.disconnectedPollIntervalMs;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.pollNow();
    }, delay);
  }

  private async poll(): Promise<void> {
    const connected = this.context !== null;
    const result = await this.api.request(
      'GET',
      `${COMMANDS_API_PATH}?clientConnected=${connected ? 'true' : 'false'}`,
      undefined,
      companionCommandsResponseSchema,
      1,
      { quiet: true },
    );
    if (!result.ok) {
      const description = JSON.stringify(failureFields(result));
      if (description !== this.lastPollFailure) {
        this.lastPollFailure = description;
        // A 404 is the route not being deployed yet; say it once, then only at debug.
        this.logger.warn('command poll failed; trying again on the next interval', failureFields(result));
      } else {
        this.logger.debug('command poll still failing', failureFields(result));
      }
      return;
    }
    if (this.lastPollFailure !== null) {
      this.lastPollFailure = null;
      this.logger.info('command poll is answering again');
    }
    this.nextPollInMs = result.data.nextPollInMs ?? this.pollIntervalMs;
    if (result.data.commands.length > 0) {
      this.logger.debug('commands received', {
        count: result.data.commands.length,
        kinds: result.data.commands.map((command) => command.kind),
      });
    }
    const receivedAt = this.now();
    for (const command of result.data.commands) {
      if (this.stopped) {
        return;
      }
      await this.handle(command, receivedAt);
    }
  }

  private async handle(command: CompanionCommandEnvelope, receivedAt: number): Promise<void> {
    const log = this.logger.child({ commandId: command.id, kind: command.kind });
    const recorded = this.executed.get(command.id);
    if (recorded !== null) {
      log.info('command already executed here; re-sending its outcome without a client call', {
        outcome: recorded.outcome,
      });
      await this.send(command, recordedOutcome(recorded), log);
      return;
    }
    let outcome: CommandOutcome;
    try {
      outcome = await this.execute(command, receivedAt, log);
    } catch (error) {
      log.error('command executor threw', errorFields(error));
      outcome = failed('client_rejected', 'executor threw', false);
    }
    if (outcome.outcome === 'failed' && outcome.retryable) {
      // Nothing ran: no record, so a later delivery executes for real.
      log.info('command not run', { error: outcome.error, retryable: true });
      await this.send(command, outcome, log);
      return;
    }
    const entry: ExecutedEntry = {
      id: command.id,
      kind: command.kind,
      at: new Date(this.now()).toISOString(),
      outcome: outcome.outcome,
      ...(outcome.outcome === 'done' ? { result: outcome.result } : { error: outcome.error }),
    };
    this.executed.record(entry);
    if (outcome.outcome === 'done') {
      log.info('command done', { result: outcome.result });
    } else {
      log.info('command failed', { error: outcome.error });
    }
    await this.send(command, outcome, log);
  }

  private async execute(
    command: CompanionCommandEnvelope,
    receivedAt: number,
    log: CompanionLogger,
  ): Promise<CommandOutcome> {
    if (isStale(command, receivedAt, this.now())) {
      return failed(
        'expired',
        `held for longer than its TTL after the poll (expiresAt=${command.expiresAt})`,
      );
    }
    if (!isKind(command.kind)) {
      return failed('malformed_payload', `unknown kind "${command.kind}"`);
    }
    const kind = command.kind;
    const parsed = companionCommandPayloadSchemas[kind].safeParse(command.payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      return failed('malformed_payload', issues);
    }
    if (!this.isEnabled(kind)) {
      log.warn('command refused: its client endpoint is not verified on this patch', {
        verify: LOBBY_WRITE_REFERENCE_ROW[kind],
        how: 'run the companion with --verify-commands and paste the report back',
      });
      return failed(
        'endpoint_unverified',
        `${LOBBY_WRITE_REFERENCE_ROW[kind]} is not verified on this patch`,
      );
    }
    const context = this.context;
    if (context === null) {
      return failed('not_connected', 'the League client went away before the command ran', true);
    }
    // The phase the machine keeps current from the socket (connect-time read, then every event). Only read
    // it from the client when nothing is known yet, so a bad phase costs no client call at all.
    if (this.phase === null) {
      const phase = await context.client.get(GAMEFLOW_PHASE_PATH, GameflowPhaseSchema);
      if (!phase.ok) {
        if (phase.reason === 'network') {
          return failed('not_connected', describeWriteResponse(phase), true);
        }
        return failed('client_rejected', `gameflow-phase answered ${describeWriteResponse(phase)}`);
      }
      this.phase = phase.json;
    }
    if (!ACTIONABLE_PHASES.includes(this.phase)) {
      return failed('wrong_phase', this.phase);
    }
    switch (kind) {
      case 'create_lobby':
        return this.createLobby(context, parsed.data as CreateLobbyCommandPayload, log);
      case 'invite':
        return this.invite(context, parsed.data as InviteCommandPayload, log);
      case 'switch_side':
        return this.switchSide(context, parsed.data as SwitchSideCommandPayload, log);
    }
  }

  private async readLobby(client: LcuClient): Promise<LobbyRead> {
    const result = await client.get(LOBBY_PATH, LobbySchema);
    if (result.ok) {
      return { kind: 'lobby', lobby: result.json };
    }
    if (result.reason === 'http' && result.status === 404) {
      return { kind: 'none' };
    }
    if (result.reason === 'network') {
      return { kind: 'failed', outcome: failed('not_connected', describeWriteResponse(result), true) };
    }
    return {
      kind: 'failed',
      outcome: failed('client_rejected', `lobby answered ${describeWriteResponse(result)}`),
    };
  }

  // --- create_lobby --------------------------------------------------------------------------------------

  private async createLobby(
    context: ConnectedContext,
    payload: CreateLobbyCommandPayload,
    log: CompanionLogger,
  ): Promise<CommandOutcome> {
    const before = await this.readLobby(context.client);
    if (before.kind === 'failed') {
      return before.outcome;
    }
    if (before.kind === 'lobby') {
      // Never dissolve a lobby somebody is standing in.
      return failed('already_in_lobby', `partyId=${before.lobby.partyId}`);
    }
    const dialog = await context.client.get(CUSTOM_GAME_QUEUES_PATH, CustomGameQueuesSchema);
    if (!dialog.ok) {
      if (dialog.reason === 'network') {
        return failed('not_connected', describeWriteResponse(dialog), true);
      }
      return failed(
        'client_rejected',
        `${CUSTOM_GAME_QUEUES_PATH} answered ${describeWriteResponse(dialog)}; no lobby created`,
      );
    }
    // The dialog's own entries carry no descriptive text on 16.18 (schemas.ts, CustomGameMutatorSchema); the
    // queue list names them by the same id, so it is read here and joined in `customLobbyIdsFor`.
    const queues = await context.client.get(GAME_QUEUES_PATH, GameQueuesSchema);
    if (!queues.ok) {
      if (queues.reason === 'network') {
        return failed('not_connected', describeWriteResponse(queues), true);
      }
      return failed(
        'client_rejected',
        `${GAME_QUEUES_PATH} answered ${describeWriteResponse(queues)}; no lobby created`,
      );
    }
    const mode = createLobbyModeFor(payload.pickType);
    const ids = customLobbyIdsFor(dialog.json, mode, queues.json);
    if (ids === null) {
      const rift = summonersRiftSubcategory(dialog.json);
      return failed(
        'client_rejected',
        rift === null
          ? `${CUSTOM_GAME_QUEUES_PATH} lists no Summoner's Rift classic subcategory; no lobby created`
          : `${CUSTOM_GAME_QUEUES_PATH} lists no ${mode} entry for Summoner's Rift (it has: ${describeMutators(rift)}); no lobby created`,
      );
    }
    log.debug('creating a custom lobby', {
      lobbyName: payload.lobbyName,
      lobbyPassword: payload.lobbyPassword,
      mode,
      queueId: ids.queueId,
      mutatorId: ids.mutatorId,
    });
    const write = await postCreateLobby(context.client, {
      lobbyName: payload.lobbyName,
      lobbyPassword: payload.lobbyPassword,
      ids,
    });
    if (!write.response.ok) {
      return failed('client_rejected', `${write.path} answered ${describeWriteResponse(write.response)}`);
    }
    // The lobby now exists whatever the read-back says, so nothing from here on may be retryable: a retryable
    // nack would have the server re-offer the row, the re-run would find the lobby and nack already_in_lobby,
    // and the password would never be remembered. One more read on a failed one, then a recorded refusal.
    let after = await this.readLobby(context.client);
    if (after.kind === 'failed') {
      log.warn('lobby created but could not be read back; reading once more', {
        error: outcomeError(after.outcome),
      });
      after = await this.readLobby(context.client);
    }
    if (after.kind !== 'lobby') {
      return failed(
        'client_rejected',
        after.kind === 'failed'
          ? `create answered ${write.response.status} but the lobby could not be read back (${outcomeError(after.outcome)})`
          : `create answered ${write.response.status} but no lobby followed`,
      );
    }
    if (!after.lobby.gameConfig.isCustom) {
      return failed(
        'client_rejected',
        `create answered ${write.response.status} but the lobby is not custom`,
      );
    }
    this.passwords.set(after.lobby.partyId, payload.lobbyPassword);
    const result: CreateLobbyCommandResult = {
      partyId: after.lobby.partyId,
      lobbyName: after.lobby.gameConfig.customLobbyName || payload.lobbyName,
    };
    log.info('custom lobby created', { partyId: result.partyId, lobbyName: result.lobbyName });
    return done(result);
  }

  // --- invite ----------------------------------------------------------------------------------------------

  private async invite(
    context: ConnectedContext,
    payload: InviteCommandPayload,
    log: CompanionLogger,
  ): Promise<CommandOutcome> {
    const before = await this.readLobby(context.client);
    if (before.kind === 'failed') {
      return before.outcome;
    }
    if (before.kind === 'none') {
      return failed('no_lobby');
    }
    const lobby = before.lobby;
    if (!lobby.gameConfig.isCustom) {
      return failed('not_custom_lobby', `queueId=${lobby.gameConfig.queueId}`);
    }
    const method: InviteCommandResult['method'] = payload.summonerId !== null ? 'summonerId' : 'puuid';
    const already = inviteState(lobby, payload.puuid);
    if (already !== null) {
      log.info('invite already in place; no client call', { puuid: payload.puuid, state: already });
      return done({ puuid: payload.puuid, method, state: already } satisfies InviteCommandResult);
    }
    if (!lobby.localMember.isLeader && lobby.localMember.allowedInviteOthers === false) {
      return failed('client_rejected', 'the local player may not invite (not the leader)');
    }
    const summonerId = payload.summonerId === null ? null : Number(payload.summonerId);
    const sent = await inviteWithFallback(context.client, {
      puuid: payload.puuid,
      summonerId: summonerId !== null && Number.isSafeInteger(summonerId) ? summonerId : null,
    });
    const last = sent.attempts[sent.attempts.length - 1];
    if (last === undefined || !last.response.ok) {
      const answers = sent.attempts
        .map(
          (attempt) =>
            `${attempt.path} by ${inviteKey(attempt.body)} answered ${describeWriteResponse(attempt.response)}`,
        )
        .join('; ');
      return failed('client_rejected', answers);
    }
    const after = await this.readLobby(context.client);
    const state = after.kind === 'lobby' ? inviteState(after.lobby, payload.puuid) : null;
    if (state === null) {
      log.warn('invite accepted by the client but no invitation row followed; reporting Pending', {
        puuid: payload.puuid,
        method: sent.used.method,
      });
    }
    log.info('invite sent', { puuid: payload.puuid, method: sent.used.method, state: state ?? 'Pending' });
    return done({
      puuid: payload.puuid,
      method: sent.used.method,
      state: state ?? 'Pending',
    } satisfies InviteCommandResult);
  }

  // --- switch_side -----------------------------------------------------------------------------------------

  private async switchSide(
    context: ConnectedContext,
    payload: SwitchSideCommandPayload,
    log: CompanionLogger,
  ): Promise<CommandOutcome> {
    const before = await this.readLobby(context.client);
    if (before.kind === 'failed') {
      return before.outcome;
    }
    if (before.kind === 'none') {
      return failed('no_lobby');
    }
    const lobby = before.lobby;
    if (!lobby.gameConfig.isCustom) {
      return failed('not_custom_lobby', `queueId=${lobby.gameConfig.queueId}`);
    }
    const puuid = context.summoner?.puuid ?? lobby.localMember.puuid;
    const side = sideOf(lobby, puuid);
    if (side === null) {
      return failed('not_on_a_team', lobby.localMember.isSpectator ? 'spectator' : 'on neither side');
    }
    if (side === payload.targetSide) {
      log.info('already on the target side; no client call', { side });
      return done({ side } satisfies SwitchSideCommandResult);
    }
    const target =
      payload.targetSide === 100 ? lobby.gameConfig.customTeam100 : lobby.gameConfig.customTeam200;
    if (target.length >= MAX_TEAM_SIZE) {
      return failed('side_full', `side ${payload.targetSide} holds ${target.length}`);
    }
    const sent = await postSwitchSide(context.client, payload.targetSide);
    if (!sent.response.ok) {
      return failed('client_rejected', `${sent.path} answered ${describeWriteResponse(sent.response)}`);
    }
    const after = await this.readLobby(context.client);
    const sideAfter = after.kind === 'lobby' ? sideOf(after.lobby, puuid) : null;
    if (sideAfter !== payload.targetSide) {
      return failed(
        'client_rejected',
        `${sent.path} answered ${sent.response.status} but the local player is ${sideAfter === null ? 'on no side' : `still on ${sideAfter}`}`,
      );
    }
    log.info('switched side', { from: side, to: sideAfter, path: sent.path });
    return done({ side: sideAfter } satisfies SwitchSideCommandResult);
  }

  // --- ack / nack ------------------------------------------------------------------------------------------

  private async send(
    command: CompanionCommandEnvelope,
    outcome: CommandOutcome,
    log: CompanionLogger,
  ): Promise<void> {
    const path = outcome.outcome === 'done' ? commandAckPath(command.id) : commandNackPath(command.id);
    const body =
      outcome.outcome === 'done'
        ? { result: outcome.result }
        : { error: outcome.error, retryable: outcome.retryable };
    const result = await this.api.request(
      'POST',
      path,
      body,
      companionCommandAckResponseSchema,
      this.ackAttempts,
      { quiet: true },
    );
    if (result.ok) {
      log.debug(outcome.outcome === 'done' ? 'command acked' : 'command nacked');
      return;
    }
    if (result.reason === 'http' && result.status === 409) {
      log.debug('the server already had this outcome', { status: 409 });
      return;
    }
    if (result.reason === 'http' && result.status === 404) {
      log.warn('the server does not know this command; nothing more to do', { status: 404 });
      return;
    }
    log.warn('ack failed; it is re-sent from the local record on the next poll', failureFields(result));
  }
}

/**
 * Whether a command has been held longer than its own TTL since the poll that handed it out. The server owns
 * expiry (it sweeps before every hand-out), so this only catches the PC that slept between the poll and the
 * execution — and it compares two local instants against two server instants, so a PC clock that is minutes
 * off never fails anything. Never `expiresAt` against the local clock.
 */
export function isStale(
  command: Pick<CompanionCommandEnvelope, 'createdAt' | 'expiresAt'>,
  receivedAt: number,
  now: number,
): boolean {
  const ttlMs = Date.parse(command.expiresAt) - Date.parse(command.createdAt);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return false;
  }
  return now - receivedAt > ttlMs;
}

/** `toSummonerId` or `toPuuid`: which body an invite attempt used, for a nack line. */
function inviteKey(body: unknown): string {
  const first = Array.isArray(body) ? body[0] : undefined;
  return first && typeof first === 'object' ? (Object.keys(first as object)[0] ?? 'unknown') : 'unknown';
}

function recordedOutcome(entry: ExecutedEntry): CommandOutcome {
  if (entry.outcome === 'done') {
    return done(entry.result ?? {});
  }
  return { outcome: 'failed', error: entry.error ?? 'failed', retryable: false };
}

/** `Accepted` when the puuid is a member, `Pending` when it holds an outstanding invitation, else null. */
export function inviteState(lobby: Lobby, puuid: string): InviteCommandResult['state'] | null {
  if (lobby.members.some((member) => member.puuid === puuid)) {
    return 'Accepted';
  }
  const row = lobby.invitations?.find((invitation) => invitation.toPuuid === puuid);
  if (row === undefined) {
    return null;
  }
  return row.state === 'Accepted' ? 'Accepted' : 'Pending';
}

/** The side the puuid is on, from `customTeam100`/`customTeam200` (reference, question 3). Null for a spectator or nobody. */
export function sideOf(lobby: Lobby, puuid: string): 100 | 200 | null {
  if (lobby.gameConfig.customTeam100.some((member) => member.puuid === puuid)) {
    return 100;
  }
  if (lobby.gameConfig.customTeam200.some((member) => member.puuid === puuid)) {
    return 200;
  }
  return null;
}
