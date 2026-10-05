import { HOST_WINDOW_MS } from '../lobbyStart';
import type { ServiceClient } from '../supabase';
import type { TokenSeen } from './tables';

/**
 * Who is watching each live table, for Tonight's `No Kustom` chip and note (M22.5 for M22.6,
 * 05-design.md 14.8). `companion_tokens` has no anon policy, so the page reads it here with the
 * service role, on the server, and only one boolean per table reaches the snapshot
 * (`withWatchers`, `./tables.ts`).
 *
 * The same tokens `liveTables`' `selectWatchingTokens` reads (the group's, unrevoked, seen inside
 * `HOST_WINDOW_MS`), plus each token's puuid so the seats come off the roster Tonight already has.
 * The page hands it to `loadTonight` (`readWatchers`), which calls it **only with two or more live
 * tables**, beside its second round: with one, nothing in 14 is drawn and the one-lobby page makes
 * the requests it made before M22; with several, no round is added. Null on any failure
 * ("unknown": no chip says `No Kustom` because a read failed).
 */
export async function loadTableWatchersOrNone(
  client: ServiceClient,
  groupId: string,
  now: Date,
): Promise<TokenSeen[] | null> {
  try {
    const seenSince = new Date(now.getTime() - HOST_WINDOW_MS).toISOString();
    const { data, error } = await client
      .from('companion_tokens')
      .select('id, player_id, current_party_id, current_party_at, players(puuid)')
      .eq('group_id', groupId)
      .is('revoked_at', null)
      .gte('last_seen_at', seenSince);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      tokenId: row.id,
      playerId: row.player_id,
      puuid: row.players?.puuid ?? null,
      currentPartyId: row.current_party_id,
      currentPartyAt: row.current_party_at,
    }));
  } catch (error) {
    console.error('tonight: reading who watches each lobby failed', error);
    return null;
  }
}
