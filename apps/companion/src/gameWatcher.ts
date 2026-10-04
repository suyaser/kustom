/**
 * Game capture (M2.3): notice the game started, notice how it ended, and never lose it.
 *
 * Post 1, `phase: 'in_progress'` — on the phase event `GameStart` (or `InProgress` when `GameStart` was
 * missed), one `GET /lol-gameflow/v1/session` and one POST with `gameData.gameId`, the moment the phase was
 * observed, and the last custom-lobby `partyId` this process saw. Never read in any other phase: in `Lobby`
 * the session still holds the previous game's id all night. Not queued to disk; the API client's own retries,
 * then one log line. `{ gameId, startedAt, partyId }` is held in memory for the end-of-game post.
 *
 * Post 2, `phase: 'eog'` — **from the WebSocket event, held in memory.** The block's `Create` lands about a
 * second before the phase reaches `EndOfGame`, and the GET is a 404 once anyone clicks past the score
 * screen. The one GET is at connect time when the phase is already `EndOfGame`/`WaitingForStats`, once, never
 * a poll. Pipeline: ignore `Delete`; dedupe on `gameId` (posted this process, holding a queue file, file on
 * disk); drop what the server would refuse before it costs a file (`gameType !== 'CUSTOM_GAME'`, no winning
 * team); map with the shared mapper (which scrubs `raw`); write `<configDir>/queue/<gameId>.json`; then post.
 *
 * The queue: replayed at start without waiting for the client, oldest first, one at a time. A file is deleted
 * on any 2xx (`created: false` means the server already had it) and on a permanent 4xx (400, 403, 404, 422),
 * each with a line saying the game is left to backfill; kept and retried on an outer backoff (30 s to 15 min,
 * jittered) for anything else — network, 5xx, 408, 429, 401 (the token may be replaced) — for as long as the
 * process runs. Nothing here writes to the League client.
 *
 * Log fields are ids, phases and counts. Never a block: it carries chat credentials.
 */

import {
  type CompanionGameEogPayloadInput,
  type CompanionGameInProgressPayloadInput,
  type CompanionGameResponse,
  companionGameResponseSchema,
} from '@customs/db/schemas';
import {
  type EogStatsBlock,
  EogStatsBlockSchema,
  GameflowSessionSchema,
  mapEog,
  readEndpoint,
} from '@customs/lcu';
import { type ApiClient, type ApiResult, failureFields } from './api.js';
import { Backoff, type BackoffOptions } from './backoff.js';
import type { CompanionHooks, ConnectedContext, EogHookEvent, LobbyHookEvent } from './connection.js';
import { realScheduler, type Scheduler } from './lobbyWatcher.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';
import { GameQueue, type QueuedGame } from './queue.js';

export const GAME_API_PATH = '/api/companion/game';
export const GAMEFLOW_SESSION_PATH = readEndpoint('gameflow-session').path;
export const EOG_BLOCK_PATH = readEndpoint('eog-stats-block').path;

/** The block is read from the client only at connect time, and only in these phases. */
export const EOG_CONNECT_PHASES: readonly string[] = ['EndOfGame', 'WaitingForStats'];
/** The phase events that trigger the one session read. */
const START_PHASES: readonly string[] = ['GameStart', 'InProgress'];
/** Session phases in which `gameData.gameId` is known to be stale (the previous game's). */
const STALE_SESSION_PHASES: readonly string[] = ['Lobby', 'None'];

export const CUSTOM_GAME_TYPE = 'CUSTOM_GAME';

/** Statuses that mean the server has refused the game for good. */
export const PERMANENT_REFUSALS: readonly number[] = [400, 403, 404, 422];

/** The outer retry for a queued file: 30 s to 15 min, jittered. */
export const DEFAULT_QUEUE_BACKOFF: BackoffOptions = { minMs: 30_000, maxMs: 15 * 60_000 };

export interface GameWatcherOptions {
  readonly api: ApiClient;
  /** The companion's config directory; the queue lives in `<configDir>/queue/`. */
  readonly configDir: string;
  readonly logger?: CompanionLogger;
  /** Injected clock for `startedAt`. Default `Date.now`. */
  readonly now?: () => number;
  readonly schedule?: Scheduler;
  /** Outer backoff between passes over the queue. Default 30 s to 15 min. */
  readonly backoff?: BackoffOptions;
  /** Attempts the API client makes for the `in_progress` post. Default: the client's own default. */
  readonly inProgressAttempts?: number;
  /** Cap on queued files. Default 50. */
  readonly maxQueued?: number;
}

interface HeldStart {
  readonly gameId: number;
  readonly startedAt: string;
  readonly partyId: string | null;
}

type PostOutcome = 'settled' | 'retry';

/** What `enqueue` says about a payload handed to the queue. */
export type EnqueueOutcome = 'queued' | 'duplicate' | 'refused';

/**
 * The queue as backfill (M5.1) sees it: hand over a payload, get told whether it was written. A backfilled
 * game is a queue file like any other, and the dedupe on `gameId` runs across both sources.
 */
export interface GameSink {
  enqueue(payload: CompanionGameEogPayloadInput, origin: string): EnqueueOutcome;
}

export class GameWatcher implements GameSink {
  readonly queue: GameQueue;
  private readonly api: ApiClient;
  private readonly logger: CompanionLogger;
  private readonly now: () => number;
  private readonly schedule: Scheduler;
  private readonly retryBackoff: Backoff;
  private readonly inProgressAttempts: number | undefined;
  private readonly stopController = new AbortController();

  private lastPartyId: string | null = null;
  private sessionRead: 'idle' | 'reading' | 'done' = 'idle';
  private readonly starts = new Map<number, HeldStart>();
  private readonly inProgressPosted = new Set<number>();
  private readonly settledGames = new Set<string>();
  private readonly queuedGames = new Set<string>();
  private readonly droppedGames = new Set<string>();
  private inProgressInFlight = 0;
  private inGame = false;
  private draining = false;
  private wake: (() => void) | null = null;

  constructor(options: GameWatcherOptions) {
    this.api = options.api;
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'game' });
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? realScheduler;
    this.retryBackoff = new Backoff(options.backoff ?? DEFAULT_QUEUE_BACKOFF);
    this.inProgressAttempts = options.inProgressAttempts;
    this.queue = new GameQueue({
      configDir: options.configDir,
      logger: this.logger,
      ...(options.maxQueued !== undefined ? { maxFiles: options.maxQueued } : {}),
    });
  }

  /** The hooks to hand to the connection machine. */
  hooks(): CompanionHooks {
    return {
      onConnected: (context) => this.onConnected(context),
      onLobbyEvent: (event) => this.onLobbyEvent(event),
      onGameflowPhase: (phase, context) => this.onGameflowPhase(phase, context),
      onEogBlock: (event) => this.onEogBlock(event),
      onDisconnected: () => this.onDisconnected(),
    };
  }

  /**
   * Replays the queue. Needs the API, not League, so `main.ts` calls it before the connection machine starts.
   * Returns once the first pass is over; anything still pending keeps retrying in the background.
   */
  start(): void {
    void this.drain();
  }

  /** Cancels timers. Posts already in flight finish on their own; their files are handled by the next start. */
  stop(): void {
    this.stopController.abort();
    this.wake?.();
  }

  /** The `{ gameId, startedAt, partyId }` held for a game, for tests and logs. */
  heldStart(gameId: number): HeldStart | undefined {
    return this.starts.get(gameId);
  }

  /** Game ids (as digits) that reached a 2xx or a permanent refusal in this process. */
  get settledGameIds(): ReadonlySet<string> {
    return this.settledGames;
  }

  /** Resolves once no post is in flight and the queue is not being drained (or is asleep between passes). */
  settled(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (
          this.inProgressInFlight === 0 &&
          this.sessionRead !== 'reading' &&
          (!this.draining || this.wake !== null)
        ) {
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error('game watcher did not settle'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  // --- hooks -------------------------------------------------------------------------------------------

  private onConnected(context: ConnectedContext): void {
    this.sessionRead = 'idle';
    if (context.phase !== null && EOG_CONNECT_PHASES.includes(context.phase)) {
      // Not awaited: the machine waits for this hook before opening the socket. One GET, never a poll.
      void this.readBlockAtConnect(context, context.phase);
    }
  }

  private onLobbyEvent(event: LobbyHookEvent): void {
    // `Delete` fires 30-100 ms after `GameStart`; the id captured at `GameStart` is kept through the game.
    if (event.lobby?.gameConfig.isCustom) {
      this.lastPartyId = event.lobby.partyId;
    }
  }

  /**
   * True while swapping the watchers out would risk a game: one is being played or has just ended and its
   * block is not posted yet, a post is in flight, or a block is queued unposted (M14.13: a replaced token's
   * relaunch waits for this to clear).
   */
  busy(): boolean {
    return (
      this.inGame ||
      this.inProgressInFlight > 0 ||
      this.sessionRead === 'reading' ||
      this.queuedGames.size > 0 ||
      this.queue.list().length > 0
    );
  }

  private onGameflowPhase(phase: string, context: ConnectedContext): void {
    this.inGame = START_PHASES.includes(phase) || EOG_CONNECT_PHASES.includes(phase);
    if (!START_PHASES.includes(phase)) {
      this.sessionRead = 'idle';
      return;
    }
    if (this.sessionRead !== 'idle') {
      // `InProgress` follows `GameStart` by tens of milliseconds; one read per game.
      return;
    }
    this.sessionRead = 'reading';
    const observedAt = new Date(this.now()).toISOString();
    void this.readSessionAndPost(context, phase, observedAt, this.lastPartyId);
  }

  private onEogBlock(event: EogHookEvent): void {
    if (event.block === null) {
      this.logger.debug('end-of-game block withdrawn; nothing to do', { eventType: event.eventType });
      return;
    }
    this.capture(event.block, event.eventType);
  }

  private onDisconnected(): void {
    this.inGame = false;
    this.sessionRead = 'idle';
  }

  // --- post 1: in_progress -----------------------------------------------------------------------------

  private async readSessionAndPost(
    context: ConnectedContext,
    phase: string,
    observedAt: string,
    partyId: string | null,
  ): Promise<void> {
    try {
      const result = await context.client.get(GAMEFLOW_SESSION_PATH, GameflowSessionSchema);
      if (this.sessionRead === 'reading') {
        this.sessionRead = 'done';
      }
      if (!result.ok) {
        this.logger.warn(
          'could not read the gameflow session at game start; no in_progress post (the end-of-game block carries its own id)',
          { phase, reason: result.reason, status: result.status },
        );
        return;
      }
      const { gameData } = result.json;
      if (STALE_SESSION_PHASES.includes(result.json.phase)) {
        this.logger.warn('gameflow session is not in a game; its game id is stale and is not posted', {
          phase,
          sessionPhase: result.json.phase,
        });
        return;
      }
      const gameId = gameData.gameId;
      if (!Number.isSafeInteger(gameId) || gameId <= 0) {
        this.logger.warn('gameflow session carries no game id at game start; no in_progress post', {
          phase,
          gameId,
        });
        return;
      }
      if (!gameData.isCustomGame) {
        this.logger.info('game is not a custom; no in_progress post', { phase, gameId });
        return;
      }
      if (this.inProgressPosted.has(gameId)) {
        this.logger.debug('in_progress already posted for this game', { gameId });
        return;
      }
      this.inProgressPosted.add(gameId);
      this.starts.set(gameId, { gameId, startedAt: observedAt, partyId });
      const payload: CompanionGameInProgressPayloadInput = {
        phase: 'in_progress',
        gameId,
        partyId,
        startedAt: observedAt,
      };
      this.logger.info('game started', { gameId, partyId, startedAt: observedAt, phase });
      this.inProgressInFlight += 1;
      try {
        const posted = await this.api.request(
          'POST',
          GAME_API_PATH,
          payload,
          companionGameResponseSchema,
          this.inProgressAttempts,
        );
        if (posted.ok) {
          this.logger.info('game start posted', { gameId, partyId, lobbyId: posted.data.lobbyId });
        } else {
          this.logger.warn(
            'in_progress post failed; giving up on it (the end-of-game post carries the same ids)',
            { gameId, partyId, ...failureFields(posted) },
          );
        }
      } finally {
        this.inProgressInFlight -= 1;
      }
    } catch (error) {
      if (this.sessionRead === 'reading') {
        this.sessionRead = 'done';
      }
      this.logger.error('game start handling threw', errorFields(error));
    }
  }

  // --- post 2: eog -------------------------------------------------------------------------------------

  private async readBlockAtConnect(context: ConnectedContext, phase: string): Promise<void> {
    try {
      const result = await context.client.get(EOG_BLOCK_PATH, EogStatsBlockSchema);
      if (result.ok) {
        this.logger.info('end-of-game block read at connect', { phase, gameId: result.json.gameId });
        this.capture(result.json, 'connect');
        return;
      }
      if (result.reason === 'http' && result.status === 404) {
        this.logger.warn(
          'connected on the end-of-game screen but the client no longer has the block; if it does not arrive over the socket the game is left to backfill (M5.1). Not asking again.',
          { phase },
        );
        return;
      }
      this.logger.warn('could not read the end-of-game block at connect; not asking again', {
        phase,
        reason: result.reason,
        status: result.status,
      });
    } catch (error) {
      this.logger.error('end-of-game read at connect threw', errorFields(error));
    }
  }

  /** The pipeline from step 2 of the brief: dedupe, drop what would be refused, map, write, post. */
  private capture(block: EogStatsBlock, source: string): void {
    const gameId = String(block.gameId);
    if (this.settledGames.has(gameId) || this.queuedGames.has(gameId) || this.queue.has(gameId)) {
      this.logger.debug('end-of-game block already handled', { gameId, source });
      return;
    }
    if (this.droppedGames.has(gameId)) {
      return;
    }
    if (block.gameType !== CUSTOM_GAME_TYPE) {
      this.droppedGames.add(gameId);
      this.logger.info('end-of-game block is not a custom game; not posting it', {
        gameId,
        gameType: block.gameType,
        source,
      });
      return;
    }
    const held = this.starts.get(block.gameId);
    const payload = mapEog(block, {
      partyId: held?.partyId ?? null,
      startedAt: held?.startedAt ?? null,
      now: this.now,
    });
    if (payload.winningSide === null) {
      this.droppedGames.add(gameId);
      this.logger.warn(
        'end-of-game block has no winning team (remake or TerminatedInError); not posting it',
        {
          gameId,
          source,
          durationS: block.gameLength,
        },
      );
      return;
    }
    this.logger.info('end-of-game block captured', {
      gameId,
      source,
      partyId: payload.partyId,
      startedAt: payload.startedAt,
      startedAtFrom: held ? 'observed' : 'derived',
      durationS: payload.durationS,
      winningSide: payload.winningSide,
      participants: payload.participants.length,
    });
    this.enqueue(payload, source);
  }

  /**
   * Writes a payload to the queue and starts a drain. A second eog of the same `gameId` is a
   * no-op. A backfill of that id is posted so the server can copy draft bans onto the eog row.
   * Never throws; a refused write is one log line from the queue.
   */
  enqueue(payload: CompanionGameEogPayloadInput, origin: string): EnqueueOutcome {
    const gameId = String(payload.gameId);
    const already = this.settledGames.has(gameId) || this.queuedGames.has(gameId) || this.queue.has(gameId);
    // A live eog row wins the scoreboard. A later backfill of the same id is still posted
    // so the server can copy `teams[].bans` onto that row — Most banned cannot see last
    // night otherwise. Any other second enqueue stays a no-op.
    if (already && origin !== 'backfill') {
      this.logger.debug('game already handled; not queued again', { gameId, origin });
      return 'duplicate';
    }
    const entry = this.queue.write(payload, new Date(this.now()).toISOString());
    if (entry === null) {
      return 'refused';
    }
    this.queuedGames.add(gameId);
    void this.drain();
    return 'queued';
  }

  // --- the queue ---------------------------------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.draining) {
      this.wake?.();
      return;
    }
    this.draining = true;
    try {
      while (!this.stopController.signal.aborted) {
        const entries = this.queue.list();
        if (entries.length === 0) {
          this.retryBackoff.reset();
          break;
        }
        let pending = 0;
        for (const entry of entries) {
          if (this.stopController.signal.aborted) {
            return;
          }
          this.queuedGames.add(entry.gameId);
          if ((await this.postQueued(entry)) === 'retry') {
            pending += 1;
          }
        }
        if (pending === 0) {
          // Everything landed; look again in case a game was captured meanwhile.
          this.retryBackoff.reset();
          continue;
        }
        const delayMs = this.retryBackoff.next();
        this.logger.warn('queued games still pending; retrying later', { pending, delayMs });
        await this.wait(delayMs);
      }
    } catch (error) {
      this.logger.error('queue drain threw', errorFields(error));
    } finally {
      this.draining = false;
    }
  }

  private async postQueued(entry: QueuedGame): Promise<PostOutcome> {
    const { gameId } = entry;
    // One attempt per pass: the outer backoff is the retry loop, and it survives restarts because the
    // file does.
    const result: ApiResult<CompanionGameResponse> = await this.api.request(
      'POST',
      GAME_API_PATH,
      entry.payload,
      companionGameResponseSchema,
      1,
    );
    if (result.ok) {
      this.logger.info('game posted', {
        gameId,
        created: result.data.created,
        lobbyId: result.data.lobbyId,
        participants: result.data.participants,
        queuedAt: entry.queuedAt,
      });
      this.settle(gameId, 'posted');
      return 'settled';
    }
    if (result.reason === 'malformed' || result.reason === 'schema') {
      // A 2xx whose body we could not read: the server has the game.
      this.logger.warn('game posted but the answer was unreadable; treating the 2xx as delivered', {
        gameId,
        ...failureFields(result),
      });
      this.settle(gameId, 'posted');
      return 'settled';
    }
    if (result.reason === 'http' && PERMANENT_REFUSALS.includes(result.status)) {
      const backfilled = entry.payload.phase === 'eog' && entry.payload.source === 'backfill';
      this.logger.warn(
        backfilled
          ? 'api refused the backfilled game for good; deleting the queued copy (it is not fetched again unless backfill.json is deleted)'
          : 'api refused the game for good; deleting the queued copy (the game is left to backfill)',
        {
          gameId,
          ...failureFields(result),
        },
      );
      this.settle(gameId, 'refused');
      return 'settled';
    }
    this.logger.warn('game post failed; the queued copy is kept and retried', {
      gameId,
      queuedAt: entry.queuedAt,
      ...failureFields(result),
    });
    return 'retry';
  }

  private settle(gameId: string, how: 'posted' | 'refused'): void {
    this.settledGames.add(gameId);
    this.queuedGames.delete(gameId);
    this.queue.delete(gameId);
    const numeric = Number(gameId);
    if (Number.isSafeInteger(numeric)) {
      this.starts.delete(numeric);
    }
    this.logger.debug('queued game settled', { gameId, how });
  }

  /** Sleeps for `ms`, or until `stop()` or a new capture wakes the drain. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const signal = this.stopController.signal;
      const finish = (): void => {
        cancel();
        signal.removeEventListener('abort', finish);
        this.wake = null;
        resolve();
      };
      const cancel = this.schedule(finish, ms);
      this.wake = finish;
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
