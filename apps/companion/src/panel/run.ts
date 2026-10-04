/**
 * Champ-select panel loop: LCU phase poll + GET /api/overlay + local HTTP UI.
 * Used in both Host and Overlay modes. Never holds a companion token.
 */

import type { GroupPanelState } from '../session.js';
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
  /** Publishes the group picker state to the panel. */
  setGroups(state: GroupPanelState): void;
  /** Fetches again for the current PUUID and the (new) selected group. */
  refetch(): void;
}

export async function startPanel(
  dir: string,
  config: PanelConfig,
  options: {
    readonly openWindow?: boolean;
    /**
     * Which group the panel reads for (M13.8). `groupId` goes out as `group=`; `skip` is true when there is
     * no group to read for (Overlay with zero memberships), so nothing is fetched.
     */
    readonly group?: () => { groupId: string | null; skip: boolean };
    /** The person picked a group in the panel's picker. */
    readonly onGroupPick?: (groupId: string) => void;
    /** The PUUID signed into League changed (or was first seen). */
    readonly onPuuid?: (puuid: string) => void;
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
  server.onGroupPick = (groupId) => {
    options.onGroupPick?.(groupId);
  };
  await server.listen(0);

  let window: WindowHandle | null = null;
  if (openWindow) {
    window = openOverlayWindow(server.url(), position);
  }

  let lastPuuid: string | null = null;
  let fetchInFlight = false;
  // A group switch that landed while a fetch for the old group was in flight: fetch again when it ends.
  let again = false;

  const refresh = async (puuid: string, force = false): Promise<void> => {
    if (fetchInFlight) {
      again = again || force;
      return;
    }
    const target = options.group?.() ?? { groupId: null, skip: false };
    if (target.skip) {
      server.setState({ payload: null, error: null, waiting: false });
      return;
    }
    fetchInFlight = true;
    try {
      const payload = await fetchOverlay(config.apiBase, puuid, fetch, target.groupId);
      server.setState({ payload, error: null, waiting: false });
    } catch (error) {
      server.setState({
        error: error instanceof Error ? error.message : String(error),
        payload: null,
      });
    } finally {
      fetchInFlight = false;
      if (again) {
        again = false;
        void refresh(puuid);
      }
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
      if (state.puuid && state.puuid !== lastPuuid) {
        lastPuuid = state.puuid;
        options.onPuuid?.(state.puuid);
      }
      if (state.visible && state.puuid) {
        void refresh(state.puuid);
      }
    },
    log,
  });
  watcher.start();

  return {
    url: server.url(),
    setGroups(state) {
      server.setState({ groups: state });
    },
    refetch() {
      if (lastPuuid !== null) void refresh(lastPuuid, true);
    },
    async stop() {
      watcher.stop();
      window?.close();
      await server.close();
    },
  };
}
