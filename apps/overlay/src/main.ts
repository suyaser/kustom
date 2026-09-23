/**
 * Kustom Overlay (M12): fearless bans and lobby synergy during Lobby / ChampSelect.
 *
 * No companion token. Reads only `current-summoner` and `gameflow-phase` from the client.
 */

import { fetchOverlay } from './api.js';
import { configDir, loadOverlayConfig, loadPosition, savePosition } from './config.js';
import { OverlayLcuWatcher } from './lcu.js';
import { OverlayServer } from './server.js';
import { OVERLAY_VERSION } from './version.js';
import { openOverlayWindow } from './window.js';

export const APP_NAME = 'Kustom Overlay';

export function usage(): string {
  return [
    `${APP_NAME} ${OVERLAY_VERSION}`,
    '',
    'Shows the fearless ban list and how you do with the people in this lobby',
    'during lobby and champion select. No token. Leave it running beside League.',
    '',
    'Flags:',
    '  --version, -v   print the version and exit',
    '  --help, -h      print this text and exit',
    '',
    `Config: ${configDir()}\\overlay.json`,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log(usage());
    return;
  }
  if (args.has('--version') || args.has('-v')) {
    console.log(OVERLAY_VERSION);
    return;
  }

  const dir = configDir();
  const config = loadOverlayConfig(dir);
  const position = loadPosition(dir);

  const server = new OverlayServer();
  server.onPosition = (next) => {
    savePosition(dir, next);
  };
  const port = await server.listen(0);
  console.info(`${APP_NAME} ${OVERLAY_VERSION} on ${server.url()} → ${config.apiBase}`);

  const window = openOverlayWindow(server.url(), position);

  let lastPuuid: string | null = null;
  let fetchInFlight = false;

  const refresh = async (puuid: string): Promise<void> => {
    if (fetchInFlight) return;
    fetchInFlight = true;
    try {
      const payload = await fetchOverlay(config.apiBase, puuid);
      server.setState({ payload, error: null, waiting: false });
    } catch (error) {
      server.setState({
        error: error instanceof Error ? error.message : String(error),
        payload: null,
      });
    } finally {
      fetchInFlight = false;
    }
  };

  const watcher = new OverlayLcuWatcher({
    ...(config.lockfilePath !== undefined ? { lockfilePath: config.lockfilePath } : {}),
    onState: (state) => {
      server.setState({
        connected: state.connected,
        visible: state.visible,
        phase: state.phase,
        waiting: !state.connected,
      });
      if (state.visible && state.puuid) {
        if (state.puuid !== lastPuuid) lastPuuid = state.puuid;
        void refresh(state.puuid);
      }
    },
    log: (message, fields) => {
      console.warn(message, fields ?? '');
    },
  });
  watcher.start();

  const shutdown = async (): Promise<void> => {
    watcher.stop();
    window.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  // Keep the process alive; the LCU poller and HTTP server hold the event loop.
  console.info(`Listening on 127.0.0.1:${port}. Ctrl+C to quit.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
