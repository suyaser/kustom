import type { PublicClient } from '../publicClient';
import type { PlayerName } from './types';

/**
 * The admins' display names, for the strip's `Waiting on Yasser or Omar to roll the teams.`
 * (2026-10-03). A night with no admin online stalls at ten; naming who can roll is the fix that
 * was chosen, and it changes nobody's permissions.
 *
 * Today's `players.is_admin` and nothing else — the per-group admin model is M13's and is not
 * live. Read through `players_public` with the anon key, like every other name on this page:
 * the view carries `is_admin` already, and who the admins are is not a secret among the people
 * who play. Oldest row first, so the order is the same on every load.
 *
 * Read **once with the page** and never on a Realtime event: `players` is in no publication, and
 * who the admins are does not change during a night.
 */
export async function loadAdminNames(client: PublicClient): Promise<PlayerName[]> {
  const { data, error } = await client
    .from('players_public')
    .select('display_name, game_name, created_at')
    .eq('is_admin', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`tonight: admin lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.display_name ?? row.game_name ?? null);
}

/**
 * The same, and an empty list on any failure: the page's answer to "is the night happening" may
 * not depend on a sentence that names admins, and with none the strip says `an admin`.
 */
export async function loadAdminNamesOrNone(client: PublicClient): Promise<PlayerName[]> {
  try {
    return await loadAdminNames(client);
  } catch (error) {
    console.error('tonight: reading the admins failed', error);
    return [];
  }
}
