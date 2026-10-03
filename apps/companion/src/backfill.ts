/**
 * Backfill (M5.1): walk the local player's match history, find the customs the server has never heard of,
 * fetch each one's detail and hand it to the game queue as `source: 'backfill'`. Background work on somebody's
 * game machine, never on the path of a lobby post.
 *
 * - **When.** 60 s after the first connect (the eog queue replay and the identity check go first), then every
 *   6 h. A pass that stops with work left — the detail cap, the page cap, a pause, a failed scan — comes back
 *   in 10 min. Nothing runs unless the client is idle (`None` or `Lobby`); a timer that fires mid-game is put
 *   back 10 min, and a pass in flight stops where it stands when the phase changes.
 * - **The walk.** `GET /lol-match-history/v1/products/lol/{puuid}/matches` in pages of 20 (`begIndex` steps of
 *   20, inclusive windows, the overlap deduped), at most 5 pages per pass, never past position 200. A fresh
 *   install walks the whole window across passes (`resumeBegIndex` in the cache); once the end has been seen
 *   the steady state starts at 0 and stops at the first page whose customs are all already known. A short or
 *   empty page is the end, and the deepest `begIndex` reached is logged for M5.6.
 * - **The scan.** `POST /api/companion/backfill/scan`; the contract, in full, is the doc comment on
 *   `companionBackfillScanResponseSchema` in `@customs/db/schemas`. There is no approval step: every scan is
 *   answered (2026-10-03). A 403 means the token's player is no longer in its group: one plain sentence and
 *   a stop until the next 6 h pass. Ids the server already has a draft-ban list for go into the local cache
 *   and are not scanned again. A live eog row has no list, so the server still asks for a detail. Version 2
 *   of this cache forgets the old "we have the id" set so last night's Yi/Zac get asked about once.
 * - **Details.** `GET /lol-match-history/v1/games/{gameId}` for the unknown ids, at most 20 per pass, one at a
 *   time, at least 2 s apart. Each one is mapped with `mapMatchDetail` and dropped with one line naming the id
 *   when it is not a `CUSTOM_GAME`, not `GameComplete`, not ten participants, has no winner or fails the
 *   schema. What survives goes to the game watcher's queue. A game already captured live is posted again
 *   so the server can copy `teams[].bans` onto the eog row — Most banned cannot see last night otherwise.
 * - **The cache.** `<configDir>/backfill.json`, tmp-file-and-rename: ids known to be handled (capped at 2000),
 *   ids scanned but not yet fetched, the walk cursor and the deepest index seen. It saves detail fetches and
 *   nothing else: delete it and the next pass re-walks and re-scans, and every post answers `created: false`.
 *
 * Read-only against the client, through `@customs/lcu`. Log fields are ids, indexes and counts; never a body.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKFILL_SCAN_BATCH_SIZE,
  type CompanionBackfillScanRequest,
  type CompanionGameEogPayloadInput,
  companionBackfillScanResponseSchema,
} from '@customs/db/schemas';
import {
  fillPath,
  type MatchDetail,
  MatchDetailSchema,
  type MatchGame,
  MatchHistoryListSchema,
  mapMatchDetail,
  matchHistoryPagePath,
  readEndpoint,
  type UnmappedTimelinePair,
} from '@customs/lcu';
import { z } from 'zod';
import { type ApiClient, failureFields } from './api.js';
import { sleep } from './backoff.js';
import type { CompanionHooks, ConnectedContext } from './connection.js';
import { CUSTOM_GAME_TYPE, type GameSink } from './gameWatcher.js';
import { realScheduler, type Scheduler } from './lobbyWatcher.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const BACKFILL_SCAN_API_PATH = '/api/companion/backfill/scan';
export const MATCH_DETAIL_PATH = readEndpoint('match-detail').path;

export const BACKFILL_CACHE_FILE = 'backfill.json';
export const BACKFILL_CACHE_VERSION = 2;
/** Ids remembered as handled. Over this the oldest are forgotten, which costs a scan, not a post. */
export const MAX_KNOWN_GAME_IDS = 2000;

export const PAGE_SIZE = 20;
export const MAX_PAGES_PER_PASS = 5;
/** The walk never asks for a position past this. How deep history really goes is M5.6's question. */
export const MAX_WALK_DEPTH = 200;
/** Passes in a row that may fail on the same page before the deep cursor is dropped. */
export const MAX_WALK_STRIKES = 3;
export const MAX_DETAILS_PER_PASS = 20;
export const DETAIL_INTERVAL_MS = 2_000;
/** Ids per scan call: the route's cap, from the contract. */
export const SCAN_BATCH_SIZE = BACKFILL_SCAN_BATCH_SIZE;
/** Ids scanned per pass; anything beyond waits in the cache for the next one. */
export const MAX_SCANNED_PER_PASS = 200;

export const FIRST_PASS_DELAY_MS = 60_000;
export const PASS_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RETRY_INTERVAL_MS = 10 * 60 * 1000;

/** The client phases in which the walker may talk to the client at all. */
export const IDLE_PHASES: readonly string[] = ['None', 'Lobby'];
export const GAME_COMPLETE = 'GameComplete';

/**
 * The one sentence for a scan the server refused (HTTP 403): the token is real, but its player is no longer a
 * member of the token's group. Once per pass, never more. Backfill has no approval step (2026-10-03), so this is
 * the only refusal the scan has.
 */
export const SCAN_REFUSED_MESSAGE =
  "Backfill was refused: this token's player is no longer a member of its group. Nothing was sent.";

export const backfillCacheSchema = z.object({
  version: z.literal(BACKFILL_CACHE_VERSION),
  lastRunAt: z.iso.datetime({ offset: true }).nullable(),
  /** The deepest `begIndex` a list page was fetched at. Evidence for M5.6. */
  deepestBegIndex: z.number().int().nonnegative(),
  /** Handled: queued, known to the server, or dropped for good. Never scanned or fetched again. */
  knownGameIds: z.array(z.number().int().positive()),
  /** Scanned and unknown to the server, waiting for a detail fetch. */
  pendingGameIds: z.array(z.number().int().positive()).default([]),
  /** Where the first walk continues; null once it has seen the end of history (or the depth cap). */
  resumeBegIndex: z.number().int().nonnegative().nullable().default(null),
});
export type BackfillCache = z.infer<typeof backfillCacheSchema>;

export function emptyBackfillCache(): BackfillCache {
  return {
    version: BACKFILL_CACHE_VERSION,
    lastRunAt: null,
    deepestBegIndex: 0,
    knownGameIds: [],
    pendingGameIds: [],
    resumeBegIndex: 0,
  };
}

export function backfillCachePath(configDir: string): string {
  return join(configDir, BACKFILL_CACHE_FILE);
}

/** The cache file. Never throws: a missing or unreadable file is an empty cache, and a failed save is a log line. */
export class BackfillStore {
  readonly path: string;
  private readonly logger: CompanionLogger;

  constructor(configDir: string, logger: CompanionLogger) {
    this.path = backfillCachePath(configDir);
    this.logger = logger;
  }

  load(): BackfillCache {
    if (!existsSync(this.path)) {
      return emptyBackfillCache();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      this.logger.warn('backfill cache is unreadable; starting over (this costs fetches, nothing else)', {
        path: this.path,
        ...errorFields(error),
      });
      return emptyBackfillCache();
    }
    const parsed = backfillCacheSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('backfill cache does not parse; starting over (this costs fetches, nothing else)', {
        path: this.path,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      });
      return emptyBackfillCache();
    }
    return parsed.data;
  }

  save(cache: BackfillCache): void {
    const trimmed: BackfillCache = {
      ...cache,
      knownGameIds: cache.knownGameIds.slice(-MAX_KNOWN_GAME_IDS),
      pendingGameIds: cache.pendingGameIds.slice(0, MAX_KNOWN_GAME_IDS),
    };
    const tmp = `${this.path}.tmp`;
    try {
      mkdirSync(join(this.path, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (error) {
      this.logger.warn('could not write the backfill cache', { path: this.path, ...errorFields(error) });
      try {
        unlinkSync(tmp);
      } catch {
        // Nothing to clean up.
      }
    }
  }
}

export type PassEnd =
  /** Nothing left to do until the next interval. */
  | 'done'
  /** Work left (pending ids, pages, a failed page); back in `retryIntervalMs`. */
  | 'more'
  /** The client stopped being idle mid-pass. */
  | 'paused'
  /** The server refused the token (403); back in `intervalMs`. */
  | 'refused'
  /** The scan call failed; back in `retryIntervalMs`. */
  | 'scan_failed'
  /** No client, or no local player. */
  | 'no_client';

export interface PassSummary {
  readonly startedAt: string;
  readonly end: PassEnd;
  readonly pages: number;
  readonly deepestBegIndex: number;
  readonly walkEnded: boolean;
  readonly candidates: number;
  readonly scanned: number;
  readonly fetched: number;
  readonly queued: number;
  readonly duplicates: number;
  readonly dropped: number;
  readonly pending: number;
}

export interface BackfillOptions {
  readonly api: ApiClient;
  /** The game watcher: its queue is where a backfilled game goes. */
  readonly sink: GameSink;
  readonly configDir: string;
  readonly logger?: CompanionLogger;
  readonly now?: () => number;
  readonly schedule?: Scheduler;
  readonly firstDelayMs?: number;
  readonly intervalMs?: number;
  readonly retryIntervalMs?: number;
  readonly detailIntervalMs?: number;
  readonly pageSize?: number;
  readonly maxPagesPerPass?: number;
  readonly maxDepth?: number;
  readonly maxDetailsPerPass?: number;
  /** Attempts for the scan call. Default 2. */
  readonly scanAttempts?: number;
}

type DropLevel = 'debug' | 'info';

export class Backfill {
  private readonly api: ApiClient;
  private readonly sink: GameSink;
  private readonly logger: CompanionLogger;
  private readonly now: () => number;
  private readonly schedule: Scheduler;
  private readonly store: BackfillStore;
  private readonly firstDelayMs: number;
  private readonly intervalMs: number;
  private readonly retryIntervalMs: number;
  private readonly detailIntervalMs: number;
  private readonly pageSize: number;
  private readonly maxPagesPerPass: number;
  private readonly maxDepth: number;
  private readonly maxDetailsPerPass: number;
  private readonly scanAttempts: number;
  private readonly stopController = new AbortController();

  private context: ConnectedContext | null = null;
  private phase: string | null = null;
  private started = false;
  private timer: (() => void) | null = null;
  private nextDelayMs: number | null = null;
  private running: Promise<PassSummary> | null = null;
  private lastDetailAt = 0;
  private walkFailures: { begIndex: number; count: number } | null = null;
  private readonly loggedDrops = new Set<number>();
  /** `timeline.lane+role` pairs already reported as unmapped (M5.18): one line per distinct pair per process. */
  private readonly loggedTimelinePairs = new Set<string>();
  private noPlayerLogged = false;
  private readonly history: PassSummary[] = [];

  constructor(options: BackfillOptions) {
    this.api = options.api;
    this.sink = options.sink;
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'backfill' });
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? realScheduler;
    this.store = new BackfillStore(options.configDir, this.logger);
    this.firstDelayMs = options.firstDelayMs ?? FIRST_PASS_DELAY_MS;
    this.intervalMs = options.intervalMs ?? PASS_INTERVAL_MS;
    this.retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
    this.detailIntervalMs = options.detailIntervalMs ?? DETAIL_INTERVAL_MS;
    this.pageSize = options.pageSize ?? PAGE_SIZE;
    this.maxPagesPerPass = options.maxPagesPerPass ?? MAX_PAGES_PER_PASS;
    this.maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
    this.maxDetailsPerPass = options.maxDetailsPerPass ?? MAX_DETAILS_PER_PASS;
    this.scanAttempts = options.scanAttempts ?? 2;
  }

  hooks(): CompanionHooks {
    return {
      onConnected: (context) => this.onConnected(context),
      onGameflowPhase: (phase) => {
        this.phase = phase;
      },
      onDisconnected: () => {
        this.context = null;
        this.phase = null;
      },
    };
  }

  stop(): void {
    this.stopController.abort();
    this.timer?.();
    this.timer = null;
  }

  /** The delay the pending timer was armed with, for tests and logs. Null when nothing is scheduled. */
  get scheduledDelayMs(): number | null {
    return this.nextDelayMs;
  }

  /** Every pass this process ran, oldest first. */
  get passes(): readonly PassSummary[] {
    return this.history;
  }

  /** The cache as it is on disk right now. */
  cache(): BackfillCache {
    return this.store.load();
  }

  /** Resolves once no pass is running. Tests use it. */
  settled(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (this.running === null) {
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error('backfill did not settle'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  /**
   * Runs a pass now instead of waiting for the timer (the timer is disarmed and re-armed from the outcome).
   * Still needs an idle client; otherwise it is the same 10-minute put-back as a timer that fired mid-game.
   */
  runNow(): Promise<PassSummary> {
    if (this.running !== null) {
      return this.running;
    }
    this.timer?.();
    this.timer = null;
    this.nextDelayMs = null;
    return this.tick();
  }

  // --- scheduling --------------------------------------------------------------------------------------

  private onConnected(context: ConnectedContext): void {
    this.context = context;
    this.phase = context.phase;
    if (!this.started) {
      this.started = true;
      this.arm(this.firstDelayMs);
    }
  }

  private arm(delayMs: number): void {
    this.timer?.();
    if (this.stopController.signal.aborted) {
      return;
    }
    this.nextDelayMs = delayMs;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.nextDelayMs = null;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<PassSummary> {
    if (this.running !== null) {
      return this.running;
    }
    const run = this.pass()
      .catch((error): PassSummary => {
        this.logger.error('backfill pass threw', errorFields(error));
        return this.summary('more', { startedAt: new Date(this.now()).toISOString() });
      })
      .then((result) => {
        this.history.push(result);
        this.running = null;
        this.arm(result.end === 'done' || result.end === 'refused' ? this.intervalMs : this.retryIntervalMs);
        return result;
      });
    this.running = run;
    return run;
  }

  private idle(context: ConnectedContext): boolean {
    return (
      !this.stopController.signal.aborted &&
      this.context === context &&
      this.phase !== null &&
      IDLE_PHASES.includes(this.phase)
    );
  }

  // --- one pass ----------------------------------------------------------------------------------------

  private async pass(): Promise<PassSummary> {
    const startedAt = new Date(this.now()).toISOString();
    const context = this.context;
    if (context === null || !this.idle(context)) {
      this.logger.debug('backfill pass skipped: the client is not idle', { phase: this.phase });
      return this.summary('no_client', { startedAt });
    }
    const puuid = context.summoner?.puuid;
    if (puuid === undefined) {
      if (!this.noPlayerLogged) {
        this.noPlayerLogged = true;
        this.logger.warn('backfill skipped: the local player is unknown (current-summoner did not answer)');
      }
      return this.summary('no_client', { startedAt });
    }

    const cache = this.store.load();
    const known = new Set(cache.knownGameIds);
    const pending = cache.pendingGameIds.filter((id) => !known.has(id));

    // 1. The walk.
    const walk = await this.walk(context, puuid, cache, known, pending);
    cache.deepestBegIndex = walk.deepestBegIndex;
    cache.resumeBegIndex = walk.resumeBegIndex;
    const candidates = [...new Set([...pending, ...walk.fresh])];

    const counts = { scanned: 0, fetched: 0, queued: 0, duplicates: 0, dropped: 0 };
    let end: PassEnd;
    let leftover: number[] = candidates;

    if (candidates.length === 0) {
      end = walk.paused ? 'paused' : walk.error || cache.resumeBegIndex !== null ? 'more' : 'done';
    } else {
      // 2. The scan.
      const toScan = candidates.slice(0, MAX_SCANNED_PER_PASS);
      const unscanned = candidates.slice(MAX_SCANNED_PER_PASS);
      const scan = await this.scan(toScan, known);
      counts.scanned = scan.scanned;
      if (scan.outcome === 'refused') {
        this.logger.warn(SCAN_REFUSED_MESSAGE);
        end = 'refused';
      } else if (scan.outcome === 'failed') {
        end = 'scan_failed';
      } else {
        // 3. The details.
        const fetchNow = scan.unknown.slice(0, this.maxDetailsPerPass);
        const later = scan.unknown.slice(this.maxDetailsPerPass);
        const fetched = await this.fetchDetails(context, fetchNow, known, cache);
        counts.fetched = fetched.fetched;
        counts.queued = fetched.queued;
        counts.duplicates = fetched.duplicates;
        counts.dropped = fetched.dropped;
        leftover = [...fetched.leftover, ...later, ...unscanned];
        end =
          fetched.paused || walk.paused
            ? 'paused'
            : leftover.length > 0 || walk.error || cache.resumeBegIndex !== null
              ? 'more'
              : 'done';
      }
    }

    cache.knownGameIds = [...known];
    cache.pendingGameIds = [...new Set(leftover)].filter((id) => !known.has(id));
    cache.lastRunAt = new Date(this.now()).toISOString();
    this.store.save(cache);

    const result = this.summary(end, {
      startedAt,
      pages: walk.pages,
      deepestBegIndex: cache.deepestBegIndex,
      walkEnded: walk.ended,
      candidates: candidates.length,
      ...counts,
      pending: cache.pendingGameIds.length,
    });
    this.logger.info('backfill pass finished', {
      ...result,
      resumeBegIndex: cache.resumeBegIndex,
      known: cache.knownGameIds.length,
    });
    return result;
  }

  private summary(end: PassEnd, fields: Partial<PassSummary> & { startedAt: string }): PassSummary {
    return {
      end,
      pages: 0,
      deepestBegIndex: 0,
      walkEnded: false,
      candidates: 0,
      scanned: 0,
      fetched: 0,
      queued: 0,
      duplicates: 0,
      dropped: 0,
      pending: 0,
      ...fields,
    };
  }

  // --- the walk ----------------------------------------------------------------------------------------

  private async walk(
    context: ConnectedContext,
    puuid: string,
    cache: BackfillCache,
    known: Set<number>,
    pending: readonly number[],
  ): Promise<{
    fresh: number[];
    pages: number;
    deepestBegIndex: number;
    resumeBegIndex: number | null;
    ended: boolean;
    paused: boolean;
    error: boolean;
  }> {
    const deep = cache.resumeBegIndex !== null;
    let begIndex = cache.resumeBegIndex ?? 0;
    let deepest = cache.deepestBegIndex;
    let pages = 0;
    let ended = false;
    let paused = false;
    let error = false;
    let giveUp = false;
    const seen = new Set<number>();
    const fresh: number[] = [];
    const pendingSet = new Set(pending);

    while (pages < this.maxPagesPerPass) {
      if (begIndex >= this.maxDepth) {
        ended = true;
        this.logger.info('match history walk reached its depth cap', { begIndex, cap: this.maxDepth });
        break;
      }
      if (!this.idle(context)) {
        paused = true;
        break;
      }
      const endIndex = begIndex + this.pageSize;
      const result = await context.client.get(
        matchHistoryPagePath(puuid, begIndex, endIndex),
        MatchHistoryListSchema,
      );
      pages += 1;
      if (!result.ok) {
        const refused = result.reason === 'http' && result.status >= 400 && result.status < 500;
        if (refused && begIndex > 0) {
          // The client says no to a position past the first page: that is the end of what it will give us,
          // and exactly the answer M5.6 is waiting for. Never a reason to ask the same page forever.
          ended = true;
          this.walkFailures = null;
          this.logger.info('match history ends here (M5.6: the client refused a page past the window)', {
            begIndex,
            endIndex,
            status: result.status,
          });
          break;
        }
        const strikes = this.noteWalkFailure(begIndex);
        this.logger.warn('match history page failed; the walk stops here and tries again later', {
          begIndex,
          endIndex,
          reason: result.reason,
          status: result.status,
          strikes,
        });
        if (deep && strikes >= MAX_WALK_STRIKES) {
          // Three passes stuck on one page: give the deep cursor up so the steady-state walk from 0 resumes
          // and new customs keep landing. The pages beyond stay unread until the cache is deleted.
          giveUp = true;
          this.walkFailures = null;
          this.logger.warn('match history walk gave up on this page; continuing from the newest games', {
            begIndex,
            strikes,
          });
        }
        error = true;
        break;
      }
      this.walkFailures = null;
      deepest = Math.max(deepest, begIndex);
      const { games } = result.json;
      this.logger.debug('match history page', {
        begIndex,
        endIndex,
        games: games.games.length,
        gameCount: games.gameCount,
        gameIndexBegin: games.gameIndexBegin,
        gameIndexEnd: games.gameIndexEnd,
      });

      let customs = 0;
      let unknownOnPage = 0;
      for (const game of games.games) {
        if (seen.has(game.gameId)) {
          continue;
        }
        seen.add(game.gameId);
        if (game.gameType !== CUSTOM_GAME_TYPE) {
          this.drop(game.gameId, `not a custom game (${game.gameType})`, 'debug');
          continue;
        }
        customs += 1;
        if (known.has(game.gameId)) {
          continue;
        }
        if (!this.isComplete(game)) {
          this.drop(
            game.gameId,
            `not a completed game (${game.endOfGameResult ?? 'no endOfGameResult'})`,
            'info',
          );
          known.add(game.gameId);
          continue;
        }
        unknownOnPage += 1;
        if (!pendingSet.has(game.gameId)) {
          fresh.push(game.gameId);
        }
      }

      if (games.games.length < this.pageSize) {
        ended = true;
        this.logger.info('match history ends here (M5.6: the deepest page reached)', {
          begIndex,
          endIndex,
          games: games.games.length,
          gameCount: games.gameCount,
        });
        break;
      }
      begIndex += this.pageSize;
      if (begIndex >= this.maxDepth) {
        ended = true;
        this.logger.info('match history walk reached its depth cap', { begIndex, cap: this.maxDepth });
        break;
      }
      if (!deep && customs > 0 && unknownOnPage === 0) {
        // Steady state: everything on this page has been handled, and older pages were handled before it.
        break;
      }
    }

    const resumeBegIndex = deep ? (ended || giveUp ? null : begIndex) : null;
    return { fresh, pages, deepestBegIndex: deepest, resumeBegIndex, ended, paused, error };
  }

  /** Consecutive failed passes on the same page (in memory; a restart starts counting again). */
  private noteWalkFailure(begIndex: number): number {
    const failures = this.walkFailures;
    this.walkFailures =
      failures !== null && failures.begIndex === begIndex
        ? { begIndex, count: failures.count + 1 }
        : { begIndex, count: 1 };
    return this.walkFailures.count;
  }

  private isComplete(game: Pick<MatchGame, 'endOfGameResult'>): boolean {
    return game.endOfGameResult === undefined || game.endOfGameResult === GAME_COMPLETE;
  }

  // --- the scan ----------------------------------------------------------------------------------------

  private async scan(
    ids: readonly number[],
    known: Set<number>,
  ): Promise<{ outcome: 'ok' | 'refused' | 'failed'; unknown: number[]; scanned: number }> {
    const unknown: number[] = [];
    let scanned = 0;
    for (let start = 0; start < ids.length; start += SCAN_BATCH_SIZE) {
      if (this.stopController.signal.aborted) {
        return { outcome: 'failed', unknown, scanned };
      }
      const batch = ids.slice(start, start + SCAN_BATCH_SIZE);
      const body: CompanionBackfillScanRequest = { gameIds: batch };
      const result = await this.api.request(
        'POST',
        BACKFILL_SCAN_API_PATH,
        body,
        companionBackfillScanResponseSchema,
        this.scanAttempts,
        { quiet: true },
      );
      if (!result.ok) {
        if (result.reason === 'http' && result.status === 403) {
          return { outcome: 'refused', unknown, scanned };
        }
        this.logger.warn('backfill scan failed; trying again later', {
          gameIds: batch.length,
          ...failureFields(result),
        });
        return { outcome: 'failed', unknown, scanned };
      }
      // `approved` is always true (the schema is a literal): there is nothing to branch on.
      scanned += batch.length;
      const unknownSet = new Set(result.data.unknown);
      for (const id of batch) {
        if (unknownSet.has(id)) {
          unknown.push(id);
        } else {
          known.add(id);
        }
      }
    }
    return { outcome: 'ok', unknown, scanned };
  }

  // --- the details -------------------------------------------------------------------------------------

  private async fetchDetails(
    context: ConnectedContext,
    ids: readonly number[],
    known: Set<number>,
    cache: BackfillCache,
  ): Promise<{
    fetched: number;
    queued: number;
    duplicates: number;
    dropped: number;
    leftover: number[];
    paused: boolean;
  }> {
    const counts = { fetched: 0, queued: 0, duplicates: 0, dropped: 0 };
    const leftover: number[] = [];
    let paused = false;
    for (let index = 0; index < ids.length; index += 1) {
      const gameId = ids[index] as number;
      if (!this.idle(context)) {
        paused = true;
        leftover.push(...ids.slice(index));
        this.logger.info('backfill paused: the client is busy; the rest waits for the next pass', {
          phase: this.phase,
          left: ids.length - index,
        });
        break;
      }
      await this.throttle();
      if (!this.idle(context)) {
        paused = true;
        leftover.push(...ids.slice(index));
        break;
      }
      const result = await context.client.get(
        fillPath(MATCH_DETAIL_PATH, { gameId: String(gameId) }),
        MatchDetailSchema,
      );
      counts.fetched += 1;
      if (!result.ok) {
        if (result.reason === 'schema' || (result.reason === 'http' && result.status === 404)) {
          this.drop(
            gameId,
            result.reason === 'schema' ? 'detail does not match the schema' : 'detail is 404',
            'info',
          );
          known.add(gameId);
          counts.dropped += 1;
        } else {
          this.logger.warn('match detail fetch failed; left for the next pass', {
            gameId,
            reason: result.reason,
            status: result.status,
          });
          leftover.push(gameId);
        }
        continue;
      }
      const outcome = this.handleDetail(gameId, result.json);
      if (outcome === 'refused') {
        // The queue could not write the file (disk full, a permissions change): not this game's fault, and
        // not something to remember as handled. It waits for the next pass like a failed fetch.
        leftover.push(gameId);
      } else {
        known.add(gameId);
        counts[outcome === 'queued' ? 'queued' : outcome === 'duplicate' ? 'duplicates' : 'dropped'] += 1;
      }
      // Saved as we go: a pass cut short by a lid closing keeps what it fetched.
      cache.knownGameIds = [...known];
      cache.pendingGameIds = [...leftover, ...ids.slice(index + 1), ...cache.pendingGameIds].filter(
        (id) => !known.has(id),
      );
      this.store.save(cache);
    }
    return { ...counts, leftover, paused };
  }

  private handleDetail(gameId: number, detail: MatchDetail): 'queued' | 'duplicate' | 'dropped' | 'refused' {
    if (detail.gameType !== CUSTOM_GAME_TYPE) {
      this.drop(gameId, `not a custom game (${detail.gameType})`, 'info');
      return 'dropped';
    }
    if (!this.isComplete(detail)) {
      this.drop(gameId, `not a completed game (${detail.endOfGameResult})`, 'info');
      return 'dropped';
    }
    const payload: CompanionGameEogPayloadInput = mapMatchDetail(detail, {
      onUnmappedRole: (pair) => this.noteUnmappedRole(gameId, pair),
    });
    if (payload.participants.length !== 10) {
      this.drop(gameId, `${payload.participants.length} participants, not ten`, 'info');
      return 'dropped';
    }
    if (payload.winningSide === null) {
      this.drop(gameId, 'no winning team', 'info');
      return 'dropped';
    }
    const outcome = this.sink.enqueue(payload, 'backfill');
    if (outcome === 'queued') {
      this.logger.info('backfilled game queued', {
        gameId,
        startedAt: payload.startedAt,
        durationS: payload.durationS,
        winningSide: payload.winningSide,
      });
      return 'queued';
    }
    if (outcome === 'duplicate') {
      this.logger.debug('backfilled game already in the queue', { gameId });
      return 'duplicate';
    }
    // The queue said why (one line of its own); the id is tried again next pass.
    return 'refused';
  }

  /**
   * A `timeline.lane`/`role` pair the verified table does not know: the participant is stored with `role: null`
   * and the pair is logged once, with its values and the first game it was seen in, so the next fixture pass
   * (`pnpm --filter @customs/lcu timeline-roles`) knows what to look for (M5.18).
   */
  private noteUnmappedRole(gameId: number, pair: UnmappedTimelinePair): void {
    if (this.loggedTimelinePairs.has(pair.key)) {
      return;
    }
    this.loggedTimelinePairs.add(pair.key);
    this.logger.info('backfill: timeline pair has no verified role; stored as null', {
      gameId,
      lane: pair.lane,
      role: pair.role,
    });
  }

  private drop(gameId: number, reason: string, level: DropLevel): void {
    if (this.loggedDrops.has(gameId)) {
      return;
    }
    this.loggedDrops.add(gameId);
    this.logger[level]('backfill: game dropped', { gameId, reason });
  }

  /** At least `detailIntervalMs` between two detail fetches, measured on the wall clock. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastDetailAt;
    if (this.lastDetailAt > 0 && elapsed < this.detailIntervalMs) {
      await sleep(this.detailIntervalMs - elapsed, this.stopController.signal);
    }
    this.lastDetailAt = Date.now();
  }
}
