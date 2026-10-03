import type { Database } from '@customs/db';
import type { GroupRole } from '@customs/db/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Throwaway groups for the integration tests (M13.4), so a test that needs "group A and group B"
 * never writes into the original group's one-per-group rows (`discord_config`, `fearless_state`)
 * that other files share. Tests only: nothing in the app imports this.
 */

type Db = SupabaseClient<Database>;

/**
 * One group per key, slug `it-<runId>-<key>`, each with a fearless cursor in the past (M13.5
 * inserts one with every group; this does it by hand). Returns the ids by key.
 */
export async function createTestGroups<K extends string>(
  db: Db,
  runId: string,
  keys: readonly K[],
): Promise<Record<K, string>> {
  const ids = {} as Record<K, string>;
  for (const key of keys) {
    const { data, error } = await db
      .from('groups')
      .insert({ slug: `it-${runId}-${key}`.toLowerCase(), name: `it ${runId} ${key}` })
      .select('id')
      .single();
    if (error) throw new Error(`test group ${key}: ${error.message}`);
    ids[key] = data.id;
    const cursor = await db
      .from('fearless_state')
      .insert({ group_id: data.id, reset_at: '2020-01-01T00:00:00.000Z' });
    if (cursor.error) throw new Error(`test group ${key} fearless: ${cursor.error.message}`);
  }
  return ids;
}

/** Make `playerId` a member of `groupId` with `role`, or move their role there if they already are. */
export async function setTestMembership(
  db: Db,
  groupId: string,
  playerId: string,
  role: GroupRole,
): Promise<void> {
  const { error } = await db
    .from('group_memberships')
    .upsert({ group_id: groupId, player_id: playerId, role }, { onConflict: 'group_id,player_id' });
  if (error) throw new Error(`test membership: ${error.message}`);
}

/**
 * Every row the test groups own, in an order the foreign keys accept, then the groups. Players
 * are the caller's to delete (they are global, not the group's).
 */
export async function deleteTestGroups(db: Db, groupIds: readonly string[]): Promise<void> {
  const ids = groupIds.filter((id) => id !== '');
  if (ids.length === 0) return;
  // `daily_mysteries` restricts its game's delete, so it goes before the games.
  const tables = [
    'daily_mysteries',
    'window_posts',
    'discord_config',
    'games',
    'lobbies',
    'companion_commands',
    'companion_tokens',
    'ratings',
    'fearless_state',
    'group_memberships',
  ] as const;
  for (const table of tables) {
    const { error } = await db.from(table).delete().in('group_id', ids);
    if (error) throw new Error(`cleanup: deleting ${table} of the test groups failed: ${error.message}`);
  }
  const { error } = await db.from('groups').delete().in('id', ids);
  if (error) throw new Error(`cleanup: deleting the test groups failed: ${error.message}`);
}
