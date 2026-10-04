import { type NameableRow, playerLabel } from '../admin/playerName';
import { nightWindow } from '../commands';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Tonight's `create_lobby` press, reduced to what a polling page needs (M19.16): where it is and
 * whose PC it went to. The slim sibling of `loadLobbyStart` (`./lobbyStart.ts`): the **same row**
 * (the group's newest `create_lobby` of tonight, bounded by the night at both ends), the same name
 * chain for the host, and nothing else -- no payload, no password, no invite count, so it is one
 * query and the page's full render stays the only place the sentence is built.
 *
 * The queue's own words become the poll's: `acked` is `done`. A `pending` or `sent` row past its
 * 60 s stays what the row says until the sweep (`sweepExpiredCommands`, run by the companions'
 * poll and by the next press) marks it `failed` -- the page reads the row the same way, and a read
 * never writes. Service role: `companion_commands` has no RLS policy at all.
 */

export type LobbyStartStatus = 'pending' | 'sent' | 'done' | 'failed';

export interface LobbyStartStatusView {
  status: LobbyStartStatus | null;
  host: { name: string } | null;
}

const STATUS: Record<'pending' | 'sent' | 'acked' | 'failed', LobbyStartStatus> = {
  pending: 'pending',
  sent: 'sent',
  acked: 'done',
  failed: 'failed',
};

export async function readLobbyStartStatus(
  client: ServiceClient,
  input: { groupId: string; now?: Date; timeZone?: string },
): Promise<LobbyStartStatusView> {
  const window = nightWindow(input.now ?? new Date(), input.timeZone ?? DEFAULT_NIGHT_TIME_ZONE);
  const { data, error } = await client
    .from('companion_commands')
    .select('status, players!inner(puuid, display_name, game_name, tag_line)')
    .eq('kind', 'create_lobby')
    .eq('group_id', input.groupId)
    .gte('created_at', window.start)
    .lte('created_at', window.until)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`readLobbyStartStatus: ${error.message}`);
  if (data === null) return { status: null, host: null };

  const host: NameableRow = {
    puuid: data.players.puuid,
    displayName: data.players.display_name,
    gameName: data.players.game_name,
    tagLine: data.players.tag_line,
  };
  return { status: STATUS[data.status], host: { name: playerLabel(host) } };
}
