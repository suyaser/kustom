import type { ModeRow } from '@customs/core';
import { pendingOf } from '../mode/state';
import type { PublicClient } from '../publicClient';

/**
 * A forked lobby's own card (M22.4, `lobby_modes`): its pending rule, region pair and Rated. The
 * standing mode is the group's (`group_modes`), so it is not here. Anon-readable (0051).
 */
export interface LobbyCard {
  pending: ModeRow['pending'];
  rated: boolean | null;
  /** `lobby_modes.updated_at`: the card's gate in the client mode store (`modeCardKey`). */
  updatedAt: string;
}

/**
 * Tonight's forked cards by party (rows created before `nightStart` are last night's and ignored,
 * M22 D5). Read only with two or more live tables (`loadTonight`, beside its second round), so a
 * one-lobby night makes no extra request. Empty on failure: every lobby then shows the group's card,
 * which is what a lobby with no row reads anyway (`cardSourceOf`).
 */
export async function loadLobbyCards(
  client: PublicClient,
  groupId: string,
  nightStart: string,
): Promise<Map<string, LobbyCard>> {
  const { data, error } = await client
    .from('lobby_modes')
    .select(
      'lcu_party_id, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at',
    )
    .eq('group_id', groupId)
    .gte('created_at', nightStart);
  if (error) {
    console.error('tonight: reading the lobby cards failed', error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((row) => [
      row.lcu_party_id,
      { pending: pendingOf(row), rated: row.rated_override, updatedAt: row.updated_at },
    ]),
  );
}
