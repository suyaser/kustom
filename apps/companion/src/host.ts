/**
 * Host-mode watchers: lobby, game, rank, backfill, commands. Requires a companion token.
 * The champ-select panel is started separately by `main` / `engine` so Overlay mode can reuse it.
 */

import { ApiClient } from './api.js';
import { Backfill } from './backfill.js';
import { CommandRunner } from './commandRunner.js';
import { ConnectionMachine } from './connection.js';
import { GameWatcher } from './gameWatcher.js';
import { composeHooks, loggingHooks } from './hooks.js';
import { announceIdentity, checkIdentity } from './identity.js';
import { LobbyWatcher } from './lobbyWatcher.js';
import type { CompanionLogger } from './log.js';
import { RankSync } from './rankSync.js';

export interface HostHandle {
  stop(): void;
  /** A game is in progress or a block is unposted: not a moment to swap the watchers (M14.13). */
  busy?(): boolean;
  readonly run: Promise<void>;
}

export interface StartHostOptions {
  readonly apiBase: string;
  /** The selected group's token. One session, one token (M13.8). */
  readonly token: string;
  readonly lockfilePath?: string | undefined;
  /**
   * Where this group's queue, backfill cache and executed-commands record live (`groups.ts` `hostStateDir`).
   * Per group, so a block queued for one group can never be replayed with another group's token.
   */
  readonly stateDir: string;
  readonly logger: CompanionLogger;
  /** The API refused this session's token (401 or 403). Called once. */
  readonly onTokenRefused?: (status: 401 | 403) => void;
}

export function startHost(options: StartHostOptions): HostHandle {
  const { logger, stateDir: dir } = options;
  // Aborted by stop(): an API call that has not been sent yet is never sent after the session ends, so a
  // switch to another group cannot be followed by one more post on the old token.
  const stopController = new AbortController();
  const api = new ApiClient({
    apiBase: options.apiBase,
    token: options.token,
    logger: logger.child({ component: 'api' }),
    signal: stopController.signal,
    ...(options.onTokenRefused ? { onRefused: options.onTokenRefused } : {}),
  });

  const gameWatcher = new GameWatcher({ api, logger, configDir: dir });
  gameWatcher.start();

  void checkIdentity(api).then((identity) => {
    announceIdentity(identity, logger);
  });

  const commandRunner = new CommandRunner({ api, logger, configDir: dir });
  const lobbyWatcher = new LobbyWatcher({
    api,
    logger,
    onResponse: (response) => rankSync.needed(response.ranksNeeded),
    passwordFor: (partyId) => commandRunner.passwordFor(partyId),
  });
  const rankSync = new RankSync({ api, logger, names: lobbyWatcher.knownNames });
  const backfill = new Backfill({ api, logger, configDir: dir, sink: gameWatcher });
  const machine = new ConnectionMachine({
    logger,
    hooks: composeHooks(
      logger,
      loggingHooks(logger),
      lobbyWatcher.hooks(),
      gameWatcher.hooks(),
      rankSync.hooks(),
      backfill.hooks(),
      commandRunner.hooks(),
    ),
    lockfile: options.lockfilePath ? { overridePath: options.lockfilePath } : {},
  });
  commandRunner.start();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    stopController.abort();
    machine.stop();
    commandRunner.stop();
    lobbyWatcher.stop();
    rankSync.stop();
    backfill.stop();
    gameWatcher.stop();
  };

  return {
    stop,
    busy: () => gameWatcher.busy(),
    run: machine.run().then(() => {
      stop();
    }),
  };
}
