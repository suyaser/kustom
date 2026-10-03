import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Who a signed-in visitor with no player row may claim as themselves (M3.6).
 *
 * The brief's rule is that **a player somebody is already linked to is not offered** — not
 * greyed out, not refused on tap: not on the list. That is a fact about `players.discord_id`,
 * which is service-role only and which the tonight page reads with the anon key, so the list
 * is decided here, on the server, and only the PUUIDs of the *unclaimed* members travel to the
 * browser. Nothing about who is linked to what ever reaches a page.
 *
 * The lobby is tonight's newest non-`abandoned` row — the same one the page is rendering
 * (`lib/tonight/load.ts`) — because a friend may only claim somebody who is in the room with
 * them. `POST /api/me/link` runs the same two checks again before it writes: this decides what
 * is drawn, never what is allowed.
 */
export interface ClaimableOptions {
  now?: Date;
  timeZone: string;
  /** The group whose tonight lobby the page shows (M13.4). */
  groupId: string;
}

export async function claimablePuuids(client: ServiceClient, options: ClaimableOptions): Promise<string[]> {
  const since = nightStart(options.now ?? new Date(), options.timeZone).toISOString();

  const { data: lobby, error: lobbyError } = await client
    .from('lobbies')
    .select('id')
    .eq('group_id', options.groupId)
    .gte('created_at', since)
    .neq('status', 'abandoned')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lobbyError) throw new Error(`claimable: lobby lookup failed: ${lobbyError.message}`);
  if (!lobby) return [];

  const { data, error } = await client
    .from('lobby_members')
    .select('players!inner(puuid, discord_id)')
    .eq('lobby_id', lobby.id)
    .is('players.discord_id', null);
  if (error) throw new Error(`claimable: member lookup failed: ${error.message}`);

  // The `is` filter above is the whole rule; this second check is the one that would survive a
  // PostgREST embed that stopped filtering, because an unclaimable name on this list is a tap
  // that can only ever be refused.
  return (data ?? []).flatMap((row) => (row.players.discord_id === null ? [row.players.puuid] : []));
}
