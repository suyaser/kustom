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

import { ApiClient, healthCheck } from './api.js';
import {
  type AppMode,
  type CompanionConfig,
  configDir,
  DEFAULT_API_BASE,
  type HostConfig,
  isHostConfig,
  loadConfig,
  logsDir,
  promptFirstRun,
  saveConfig,
  saveOverlayModeConfig,
  stdioPrompt,
} from './config.js';
import { startHost } from './host.js';
import { type CompanionLogger, createFileLogger, errorFields, isLogLevel } from './log.js';
import { startPanel } from './panel/run.js';
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
  const config = await resolveConfig(dir, logger, showToken, modeFlag);
  if (config === null) {
    await holdWindowOpen();
    return 1;
  }

  writeStatus(dir, {
    mode: config.mode,
    state: 'starting',
    phase: null,
    playerName: null,
    overlayUrl: null,
    overlayVisible: false,
    error: null,
  });

  let overlayUrl: string | null = null;
  const panel = await startPanel(
    dir,
    {
      apiBase: config.apiBase,
      ...(config.lockfilePath ? { lockfilePath: config.lockfilePath } : {}),
    },
    {
      openWindow: true,
      log: (message, fields) => {
        logger.warn(message, fields ?? {});
      },
      onState: (state) => {
        writeStatus(dir, {
          mode: config.mode,
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
  overlayUrl = panel.url;

  writeStatus(dir, {
    mode: config.mode,
    state: 'waiting',
    phase: null,
    playerName: null,
    overlayUrl: panel.url,
    overlayVisible: false,
    error: null,
  });
  // Tauri watches stdout for this line to open the overlay webview.
  console.info(`OVERLAY_READY ${panel.url}`);

  let host: ReturnType<typeof startHost> | null = null;
  if (isHostConfig(config)) {
    logger.addSecret(config.companionToken);
    const api = new ApiClient({
      apiBase: config.apiBase,
      token: config.companionToken,
      logger: logger.child({ component: 'api' }),
    });
    const health = await api.health();
    if (health === null) {
      logger.info('api reachable', { apiBase: config.apiBase });
    } else {
      logger.warn('api not reachable now; calls will retry', { apiBase: config.apiBase, reason: health });
    }
    host = startHost(config as HostConfig, dir, logger);
  } else {
    logger.info('overlay mode: panel only (no companion token)');
  }

  let signals = 0;
  const onSignal = (signal: NodeJS.Signals): void => {
    signals += 1;
    if (signals > 1) {
      logger.warn('second signal; exiting immediately', { signal });
      process.exit(130);
    }
    logger.info('shutting down', { signal });
    host?.stop();
    void panel.stop().then(() => {
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

  if (host !== null) {
    await host.run;
  } else {
    // Overlay-only: stay alive until signal.
    await new Promise<void>(() => undefined);
  }

  await panel.stop();
  logger.info('stopped');
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
