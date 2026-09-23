/**
 * Champ-select panel loop: LCU phase poll + GET /api/overlay + local HTTP UI.
 * Used in both Host and Overlay modes. Never holds a companion token.
 */

import { fetchOverlay } from './api.js';
import { OverlayLcuWatcher } from './lcu.js';
import { loadPosition, savePosition } from './position.js';
import { OverlayServer } from './server.js';
import { openOverlayWindow, type WindowHandle } from './window.js';

export interface PanelConfig {
  readonly apiBase: string;
  readonly lockfilePath?: string;
}

export interface PanelHandle {
  readonly url: string;
  stop(): Promise<void>;
  onVisible?: ((visible: boolean, phase: string | null) => void) | undefined;
}

export async function startPanel(
  dir: string,
  config: PanelConfig,
  options: {
    readonly openWindow?: boolean;
    readonly log?: (message: string, fields?: Record<string, unknown>) => void;
    readonly onState?: (state: {
      connected: boolean;
      visible: boolean;
      phase: string | null;
      puuid: string | null;
    }) => void;
  } = {},
): Promise<PanelHandle> {
  const openWindow = options.openWindow ?? true;
  const log = options.log ?? (() => undefined);
  const position = loadPosition(dir);

  const server = new OverlayServer();
  server.onPosition = (next) => {
    savePosition(dir, next);
  };
  await server.listen(0);

  let window: WindowHandle | null = null;
  if (openWindow) {
    window = openOverlayWindow(server.url(), position);
  }

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
      options.onState?.(state);
      if (state.visible && state.puuid) {
        if (state.puuid !== lastPuuid) lastPuuid = state.puuid;
        void refresh(state.puuid);
      }
    },
    log,
  });
  watcher.start();

  return {
    url: server.url(),
    async stop() {
      watcher.stop();
      window?.close();
      await server.close();
    },
  };
}
