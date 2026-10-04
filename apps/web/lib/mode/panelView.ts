import type { LobbyStatusValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import { loadFearless } from '../fearless/load';
import type { FearlessView } from '../fearless/types';
import type { PublicClient } from '../publicClient';
import { type ModeCardView, modeCardView } from './card';
import { championTable } from './champions';
import { loadModeState, loadTonightLobbyLock } from './tonightRead';

/**
 * The group half of the mode panel's read (M15.5, split out in M15.8): the standing mode and its
 * pool (`loadFearless`, the read Tonight makes), and what the Mode card is about (`modeCardView`
 * over the card state and tonight's newest lobby lock), so the panel and the card never disagree.
 * No cookies, no viewer: `app/_mode/loadPanel.ts` adds who is looking, and the M15.8 integration
 * test reads exactly what the page reads.
 */
export interface ModePanelView {
  mode: GroupMode;
  fearless: FearlessView;
  view: ModeCardView;
  lobbyStatus: LobbyStatusValue | null;
}

export async function loadModePanelView(
  client: PublicClient,
  groupId: string,
  nightStart: Date,
): Promise<ModePanelView> {
  const [{ mode, modeSince: _since, ...fearless }, state, lobby] = await Promise.all([
    loadFearless(client, groupId),
    loadModeState(client, groupId),
    loadTonightLobbyLock(client, groupId, nightStart),
  ]);
  const view = modeCardView({
    state: state ?? { standing: mode, pending: null, ratedOverride: null, version: 0 },
    lobbyStatus: lobby?.status ?? null,
    lock: lobby?.lock ?? null,
    bans: fearless.champions.map((champion) => champion.id),
    table: championTable(),
  });
  return { mode, fearless, view, lobbyStatus: lobby?.status ?? null };
}
