/**
 * Read-only LCU loop for the overlay: lockfile → summoner puuid + gameflow phase.
 * Never subscribes to `/lol-champ-select/*`.
 */

import {
  createLockfileDiscovery,
  GameflowPhaseSchema,
  LcuClient,
  type LockfileCredentials,
  type LockfileDiscovery,
  SummonerSchema,
  type TlsMode,
} from '@customs/lcu';
import { shouldShowOverlay } from './phases.js';

export const CURRENT_SUMMONER_PATH = '/lol-summoner/v1/current-summoner';
export const GAMEFLOW_PHASE_PATH = '/lol-gameflow/v1/gameflow-phase';

export interface OverlayLcuState {
  puuid: string | null;
  phase: string | null;
  visible: boolean;
  connected: boolean;
}

export type OverlayLcuListener = (state: OverlayLcuState) => void;

export interface OverlayLcuOptions {
  lockfilePath?: string;
  pollIntervalMs?: number;
  tlsMode?: TlsMode;
  onState: OverlayLcuListener;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export class OverlayLcuWatcher {
  private readonly pollIntervalMs: number;
  private readonly tlsMode: TlsMode;
  private readonly onState: OverlayLcuListener;
  private readonly log: NonNullable<OverlayLcuOptions['log']>;
  private readonly discovery: LockfileDiscovery;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private client: LcuClient | null = null;
  private lastCredsKey: string | null = null;
  private state: OverlayLcuState = {
    puuid: null,
    phase: null,
    visible: false,
    connected: false,
  };

  constructor(options: OverlayLcuOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
    this.tlsMode = options.tlsMode ?? { mode: 'pinned' };
    this.onState = options.onState;
    this.log = options.log ?? (() => undefined);
    this.discovery = createLockfileDiscovery(
      options.lockfilePath !== undefined ? { extraCandidates: [options.lockfilePath] } : {},
    );
  }

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.client?.close();
    this.client = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const found = await this.discovery();
      if (found.status !== 'found') {
        this.emit({ puuid: null, phase: null, visible: false, connected: false });
        this.client?.close();
        this.client = null;
        this.lastCredsKey = null;
        this.schedule();
        return;
      }
      await this.readClient(found.credentials);
    } catch (error) {
      this.log('overlay lcu tick failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit({ puuid: null, phase: null, visible: false, connected: false });
      this.client?.close();
      this.client = null;
      this.lastCredsKey = null;
    }
    this.schedule();
  }

  private async readClient(credentials: LockfileCredentials): Promise<void> {
    const key = `${credentials.port}:${credentials.password}`;
    if (this.client === null || this.lastCredsKey !== key) {
      this.client?.close();
      this.client = LcuClient.fromCredentials(credentials, { tls: this.tlsMode });
      this.lastCredsKey = key;
    }

    const [summonerRes, phaseRes] = await Promise.all([
      this.client.get(CURRENT_SUMMONER_PATH, SummonerSchema),
      this.client.get(GAMEFLOW_PHASE_PATH, GameflowPhaseSchema),
    ]);

    const puuid = summonerRes.ok ? summonerRes.json.puuid : null;
    const phase = phaseRes.ok ? phaseRes.json : null;

    this.emit({
      puuid,
      phase,
      visible: shouldShowOverlay(phase),
      connected: true,
    });
  }

  private emit(next: OverlayLcuState): void {
    const changed =
      next.puuid !== this.state.puuid ||
      next.phase !== this.state.phase ||
      next.visible !== this.state.visible ||
      next.connected !== this.state.connected;
    this.state = next;
    if (changed) this.onState(next);
  }
}
