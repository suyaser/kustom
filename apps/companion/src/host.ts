/**
 * Host-mode watchers: lobby, game, rank, backfill, commands. Requires a companion token.
 * The champ-select panel is started separately by `main` / `engine` so Overlay mode can reuse it.
 */

import { ApiClient } from './api.js';
import { Backfill } from './backfill.js';
import { CommandRunner } from './commandRunner.js';
import type { HostConfig } from './config.js';
import { ConnectionMachine } from './connection.js';
import { GameWatcher } from './gameWatcher.js';
import { composeHooks, loggingHooks } from './hooks.js';
import { announceIdentity, checkIdentity } from './identity.js';
import { LobbyWatcher } from './lobbyWatcher.js';
import type { CompanionLogger } from './log.js';
import { RankSync } from './rankSync.js';

export interface HostHandle {
  stop(): void;
  readonly run: Promise<void>;
}

export function startHost(config: HostConfig, dir: string, logger: CompanionLogger): HostHandle {
  const api = new ApiClient({
    apiBase: config.apiBase,
    token: config.companionToken,
    logger: logger.child({ component: 'api' }),
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
    lockfile: config.lockfilePath ? { overridePath: config.lockfilePath } : {},
  });
  commandRunner.start();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    machine.stop();
    commandRunner.stop();
    lobbyWatcher.stop();
    rankSync.stop();
    backfill.stop();
    gameWatcher.stop();
  };

  return {
    stop,
    run: machine.run().then(() => {
      stop();
    }),
  };
}
