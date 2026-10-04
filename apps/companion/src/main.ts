/**
 * `pnpm --filter companion dev` (and, packaged, the exe a friend leaves running).
 *
 * One app, two modes (M6):
 *  - **Host** — companion token; lobby/game watchers plus the champ-select panel.
 *  - **Overlay** — no token; fearless + lobby synergy panel only.
 *
 * Startup: resolve the config directory, load or prompt for host config (CLI), open the log, then
 * start the panel (always) and host watchers (host mode only). Tauri sets `CUSTOMS_NIGHT_TAURI=1`
 * so the panel skips Edge and the shell opens its own overlay window from `status.json`.
 *
 * Flags: `--version` / `-v`, `--help` / `-h`, `--show-token`, `--verify-commands`,
 * `--mode host|overlay` (forces mode for this run when config is missing / for overlay first write).
 */

import { watchFile } from 'node:fs';
import { ApiClient, healthCheck } from './api.js';
import {
  type AppMode,
  apiBaseSchema,
  type CompanionConfig,
  configDir,
  configPath,
  DEFAULT_API_BASE,
  isHostConfig,
  loadConfig,
  logsDir,
  promptFirstRun,
  saveConfig,
  saveOverlayModeConfig,
  stdioPrompt,
} from './config.js';
import {
  fetchOverlayGroups,
  hostStateDirFor,
  mergeServerGroups,
  overlayGroupParam,
  resolveTopLevelToken,
} from './groups.js';
import { startHost } from './host.js';
import { type CompanionLogger, createFileLogger, errorFields, isLogLevel } from './log.js';
import { pairWithCode } from './pairing.js';
import { readCurrentPuuid } from './panel/lcu.js';
import { startPanel } from './panel/run.js';
import { GroupSession } from './session.js';
import { writeStatus } from './status.js';
import { runVerifyCommands } from './verifyCommands.js';
import { COMPANION_VERSION } from './version.js';

export const APP_NAME = 'Kustom';

export function usage(): string {
  return [
    `${APP_NAME} ${COMPANION_VERSION}`,
    '',
    'One app for Customs Night. Host mode watches the League client and reports lobbies and results.',
    'Overlay mode only shows fearless bans and lobby synergy during champ select (no token).',
    '',
    'Flags:',
    '  --version, -v   print the version and exit',
    '  --help, -h      print this text and exit',
    '  --mode host|overlay',
    '                  pick a mode when no config exists yet (overlay writes a token-free config)',
    '  --show-token    show the token as you type it at the first-run prompt (host mode)',
    '  --pair CODE [--api-base URL]',
    '                  join a group with the code from the join page: reads who is signed into League,',
    '                  sends both, saves the group, prints one JSON line (the setup window uses this)',
    '  --pair-check    print {"ready":true|false}: is League open and signed in (setup window)',
    '  --verify-commands',
    '                  verify the lobby writes against the running client; no API call, no token needed',
    '',
    'Environment:',
    '  CUSTOMS_NIGHT_CONFIG_DIR   config directory (config.json, logs/, queue/, status.json, …)',
    '  CUSTOMS_NIGHT_LOG_LEVEL    console level: debug | info | warn | error (default info)',
    '  CUSTOMS_NIGHT_SHOW_TOKEN   1 is the same as --show-token',
    '  CUSTOMS_NIGHT_VERIFY_COMMANDS',
    '                             1 is the same as --verify-commands',
    '  CUSTOMS_NIGHT_TAURI        1: panel window is owned by the Tauri shell',
    '',
    `Config: ${configDir()}`,
  ].join('\n');
}

async function holdWindowOpen(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }
  if (process.env.CUSTOMS_NIGHT_TAURI === '1') {
    return;
  }
  const io = stdioPrompt();
  await io.ask('Press Enter to close this window. ');
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function parseModeFlag(args: readonly string[]): AppMode | undefined {
  const raw = flagValue(args, '--mode');
  if (raw === 'host' || raw === 'overlay') return raw;
  return undefined;
}

async function resolveConfig(
  dir: string,
  logger: CompanionLogger,
  showToken: boolean,
  modeFlag: AppMode | undefined,
): Promise<CompanionConfig | null> {
  const loaded = loadConfig(dir);
  switch (loaded.status) {
    case 'ok':
      return loaded.config;
    case 'invalid':
      logger.error('config file is unreadable; fix or delete it and start again', {
        path: loaded.path,
        reason: loaded.reason,
      });
      return null;
    case 'missing': {
      if (modeFlag === 'overlay' || loaded.partial.mode === 'overlay') {
        const apiBase = loaded.partial.apiBase ?? DEFAULT_API_BASE;
        const path = saveOverlayModeConfig(dir, {
          apiBase,
          ...(loaded.partial.lockfilePath ? { lockfilePath: loaded.partial.lockfilePath } : {}),
        });
        logger.info('overlay config saved', { path, apiBase });
        return {
          mode: 'overlay',
          apiBase,
          ...(loaded.partial.lockfilePath ? { lockfilePath: loaded.partial.lockfilePath } : {}),
        };
      }
      if (loaded.reason === 'bad_token') {
        logger.warn('the saved companion token cannot be a token from the admin page; asking again', {
          path: loaded.path,
        });
      }
      const config = await promptFirstRun({
        io: stdioPrompt(process.stdin, process.stdout, { showToken }),
        partial: loaded.partial,
        checkApiBase: healthCheck(),
        reason: loaded.reason,
      });
      const path = saveConfig(dir, config);
      logger.info('config saved', { path });
      return config;
    }
  }
}

/** `--pair-check`: `{ ready }`, whether League is open and says who is signed in. The setup window's sentence. */
async function runPairCheck(dir: string): Promise<number> {
  const loaded = loadConfig(dir);
  const lockfilePath =
    loaded.status === 'ok'
      ? loaded.config.lockfilePath
      : loaded.status === 'missing'
        ? loaded.partial.lockfilePath
        : undefined;
  const who = await readCurrentPuuid(lockfilePath ? { lockfilePath } : {});
  console.log(JSON.stringify({ ready: who.ok }));
  return 0;
}

/** `--pair CODE`: one JSON line on stdout, `{ ok, message, group? }`, and nothing else. Exit 0 whatever the answer. */
async function runPair(args: readonly string[], dir: string): Promise<number> {
  const code = flagValue(args, '--pair') ?? '';
  const loaded = loadConfig(dir);
  const known =
    loaded.status === 'ok' ? loaded.config : loaded.status === 'missing' ? loaded.partial : undefined;
  const flagBase = flagValue(args, '--api-base');
  const base = apiBaseSchema.safeParse(flagBase ?? known?.apiBase ?? DEFAULT_API_BASE);
  if (loaded.status === 'invalid' || !base.success) {
    console.log(
      JSON.stringify({
        ok: false,
        message:
          loaded.status === 'invalid'
            ? 'Kustom could not read its settings file. Open the logs folder and fix or delete config.json.'
            : 'That server address is not valid.',
      }),
    );
    return 0;
  }
  // Host mode asks for a host token; Overlay (and a PC with no mode chosen yet) never does (M14.13).
  const mode: AppMode =
    parseModeFlag(args) ??
    (loaded.status === 'ok'
      ? loaded.config.mode
      : loaded.status === 'missing'
        ? loaded.partial.mode
        : undefined) ??
    'overlay';
  const outcome = await pairWithCode({
    apiBase: base.data,
    code,
    configDir: dir,
    mode,
    ...(known?.lockfilePath ? { lockfilePath: known.lockfilePath } : {}),
  });
  console.log(
    // Never the token: it is in the config file and nowhere else.
    JSON.stringify(
      outcome.ok
        ? { ok: true, message: outcome.message, group: outcome.group }
        : { ok: false, message: outcome.message, ...(outcome.group ? { group: outcome.group } : {}) },
    ),
  );
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(COMPANION_VERSION);
    return 0;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return 0;
  }
  const dir = configDir();
  if (args.includes('--pair-check')) {
    return runPairCheck(dir);
  }
  if (args.includes('--pair')) {
    return runPair(args, dir);
  }
  if (args.includes('--verify-commands') || process.env.CUSTOMS_NIGHT_VERIFY_COMMANDS === '1') {
    const loaded = loadConfig(dir);
    const lockfilePath =
      loaded.status === 'ok'
        ? loaded.config.lockfilePath
        : loaded.status === 'missing'
          ? loaded.partial?.lockfilePath
          : undefined;
    const code = await runVerifyCommands({
      configDir: dir,
      io: stdioPrompt(),
      ...(lockfilePath ? { lockfilePath } : {}),
    });
    await holdWindowOpen();
    return code;
  }

  const consoleLevelRaw = process.env.CUSTOMS_NIGHT_LOG_LEVEL ?? 'info';
  const consoleLevel = isLogLevel(consoleLevelRaw) ? consoleLevelRaw : 'info';
  const logger = createFileLogger({ dir: logsDir(dir), consoleLevel, fileLevel: 'debug' });
  const modeFlag = parseModeFlag(args);
  logger.info(`${APP_NAME} ${COMPANION_VERSION} starting`, {
    node: process.version,
    platform: process.platform,
    configDir: dir,
    logDir: logsDir(dir),
    tauri: process.env.CUSTOMS_NIGHT_TAURI === '1',
  });

  const showToken = args.includes('--show-token') || process.env.CUSTOMS_NIGHT_SHOW_TOKEN === '1';
  let config = await resolveConfig(dir, logger, showToken, modeFlag);
  if (config === null) {
    await holdWindowOpen();
    return 1;
  }
  const reload = (): CompanionConfig | null => {
    const result = loadConfig(dir);
    return result.status === 'ok' ? result.config : null;
  };

  // A token at the top level (a 0.2.x file, or a fresh paste) is filed under the group the server says it is
  // for. Before the watchers start: the group decides which state directory they use.
  if (isHostConfig(config) && config.companionToken) {
    logger.addSecret(config.companionToken);
    const filed = await resolveTopLevelToken({ configDir: dir, config, logger });
    if (filed !== null) config = reload() ?? config;
  }
  for (const group of config.groups ?? []) {
    if (group.companionToken) logger.addSecret(group.companionToken);
  }
  const startConfig: CompanionConfig = config;

  writeStatus(dir, {
    mode: startConfig.mode,
    state: 'starting',
    phase: null,
    playerName: null,
    overlayUrl: null,
    overlayVisible: false,
    error: null,
  });

  // One group per session (M13.8). Host: the watchers run on the selected group's token and a switch stops
  // them first. Overlay: the selection only changes which group the panel reads for.
  let panelRef: Awaited<ReturnType<typeof startPanel>> | null = null;
  const session = new GroupSession({
    mode: startConfig.mode,
    configDir: dir,
    initial: startConfig,
    reload,
    logger: logger.child({ component: 'groups' }),
    onState: (state) => panelRef?.setGroups(state),
    onSelected: () => panelRef?.refetch(),
    ...(isHostConfig(startConfig)
      ? {
          startHost: (group, onTokenRefused) => {
            if (group.token === undefined) throw new Error('no host token for this group');
            logger.info('posting tonight to a group', { slug: group.slug || null });
            return startHost({
              apiBase: startConfig.apiBase,
              token: group.token,
              lockfilePath: startConfig.lockfilePath,
              stateDir: hostStateDirFor(dir, group),
              logger,
              onTokenRefused,
            });
          },
        }
      : {}),
  });

  let overlayUrl: string | null = null;
  const panel = await startPanel(
    dir,
    {
      apiBase: startConfig.apiBase,
      ...(startConfig.lockfilePath ? { lockfilePath: startConfig.lockfilePath } : {}),
    },
    {
      openWindow: true,
      log: (message, fields) => {
        logger.warn(message, fields ?? {});
      },
      group: () => {
        const selected = session.selected();
        const state = session.state();
        return { groupId: overlayGroupParam(selected), skip: state.noGroups };
      },
      onGroupPick: (groupId) => {
        void session.select(groupId);
      },
      onPuuid: (puuid) => {
        if (startConfig.mode !== 'overlay') return;
        // Overlay refreshes its list from the server on start, so a friend who joined by playing sees the
        // group with zero setup. A failed answer changes nothing.
        void fetchOverlayGroups(startConfig.apiBase, puuid, { logger: logger.child({ component: 'groups' }) })
          .then(async (listed) => {
            if (listed === null) return;
            mergeServerGroups(dir, startConfig.apiBase, listed);
            await session.adoptServerGroups();
          })
          .catch((error: unknown) => {
            logger.warn('could not refresh the group list', errorFields(error));
          });
      },
      onState: (state) => {
        writeStatus(dir, {
          mode: startConfig.mode,
          state: state.connected ? (state.visible ? 'watching' : 'waiting') : 'disconnected',
          phase: state.phase,
          playerName: null,
          overlayUrl,
          overlayVisible: state.visible,
          error: null,
        });
      },
    },
  );
  panelRef = panel;
  overlayUrl = panel.url;

  writeStatus(dir, {
    mode: startConfig.mode,
    state: 'waiting',
    phase: null,
    playerName: null,
    overlayUrl: panel.url,
    overlayVisible: false,
    error: null,
  });
  // Tauri watches stdout for this line to open the overlay webview.
  console.info(`OVERLAY_READY ${panel.url}`);

  if (isHostConfig(startConfig)) {
    const probe = new ApiClient({ apiBase: startConfig.apiBase, logger: logger.child({ component: 'api' }) });
    const health = await probe.health();
    if (health === null) {
      logger.info('api reachable', { apiBase: startConfig.apiBase });
    } else {
      logger.warn('api not reachable now; calls will retry', {
        apiBase: startConfig.apiBase,
        reason: health,
      });
    }
  } else {
    logger.info('overlay mode: panel only (no companion token)');
  }
  await session.start();

  // A pairing runs in a one-shot `--pair` process and writes the config. Watch the file, so a host token it
  // saved starts the watchers with no paste and no restart (M14.13). Polling: it works the same on every OS.
  watchFile(configPath(dir), { interval: 1500, persistent: false }, () => {
    const latest = reload();
    if (latest === null) return;
    if (isHostConfig(latest)) {
      for (const group of latest.groups ?? []) {
        if (group.companionToken) logger.addSecret(group.companionToken);
      }
    }
    void session.adoptConfig();
  });

  let signals = 0;
  const onSignal = (signal: NodeJS.Signals): void => {
    signals += 1;
    if (signals > 1) {
      logger.warn('second signal; exiting immediately', { signal });
      process.exit(130);
    }
    logger.info('shutting down', { signal });
    void session
      .stop()
      .then(() => panel.stop())
      .then(() => {
        process.exit(0);
      });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception (continuing)', errorFields(error));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection (continuing)', errorFields(reason));
  });

  // Stay alive until a signal: a refused token or a switch can leave no watcher running, and the picker is
  // how the person gets back.
  await new Promise<void>(() => undefined);
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  async (error) => {
    console.error('kustom failed to start:', error instanceof Error ? error.message : String(error));
    await holdWindowOpen();
    process.exit(1);
  },
);
