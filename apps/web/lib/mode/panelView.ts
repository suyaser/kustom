import type { LobbyStatusValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import { loadFearless } from '../fearless/load';
import type { FearlessView } from '../fearless/types';
import type { PublicClient } from '../publicClient';
import { loadLobbyCards } from '../tonight/cards';
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
  /** M22.6: how many lobbies are live (the panel's head says they share one list with 2+). */
  liveTables: number;
}

export async function loadModePanelView(
  client: PublicClient,
  groupId: string,
  nightStart: Date,
  lobbyId: string | null = null,
): Promise<ModePanelView> {
  const [{ mode, modeSince: _since, ...fearless }, row, lobby] = await Promise.all([
    loadFearless(client, groupId),
    loadModeState(client, groupId),
    // M22.6: the panel's `?lobby=` picks the table, so the lock is the selected lobby's.
    loadTonightLobbyLock(client, groupId, nightStart, { lobbyId }),
  ]);
  const groupRow = row ?? { standing: mode, pending: null, rated: null };
  // M22.6: with two or more lobbies live, a forked lobby's own rule, pair and Rated (`lobby_modes`).
  const fork =
    lobby !== null && lobby.liveTables >= 2
      ? ((await loadLobbyCards(client, groupId, nightStart.toISOString())).get(lobby.partyId) ?? null)
      : null;
  const view = modeCardView({
    row: fork === null ? groupRow : { standing: groupRow.standing, pending: fork.pending, rated: fork.rated },
    lobbyStatus: lobby?.status ?? null,
    lock: lobby?.lock ?? null,
    bans: fearless.champions.map((champion) => champion.id),
    table: championTable(),
  });
  return { mode, fearless, view, lobbyStatus: lobby?.status ?? null, liveTables: lobby?.liveTables ?? 0 };
}
