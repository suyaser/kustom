import type { ServiceClient } from '../supabase';

/**
 * Whether the group has ever had a rated game (M14.75): a scoreboard row with a `r_after`. Until it
 * has, there is nothing to reset, so the admin home draws no `Reset ratings` card. One row, read with
 * the service role beside the checklist's facts; a failed read keeps the card (the old behaviour).
 */
export async function readHasRatedGame(client: ServiceClient, groupId: string): Promise<boolean> {
  const { data, error } = await client
    .from('game_players')
    .select('game_id')
    .eq('group_id', groupId)
    .not('r_after', 'is', null)
    .limit(1);
  if (error) {
    console.error('admin: reading whether the group has a rated game failed', error.message);
    return true;
  }
  return (data ?? []).length > 0;
}
