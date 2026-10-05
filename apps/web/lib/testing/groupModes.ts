import type { ServiceClient } from '../supabase';

/**
 * Tests only: keep a real group's Mode card as the test found it.
 *
 * Since M15.3 a game recorded from a rolled lobby runs compare-and-clear on its group's
 * `group_modes` row (M20.7: a hand-back or a lockless game's use-up; Roll moves the pending fields). An
 * integration file that rolls lobbies in the shared `customs` group would otherwise wipe whatever
 * rule or Rated override somebody set on the local stack. Call this in `beforeAll` and the
 * returned function in `afterAll`: it writes the snapshotted card state back with the service
 * role (or deletes a row the test created where there was none).
 */
const COLUMNS =
  'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, pending_set_by, set_by' as const;

export async function snapshotGroupModes(
  client: ServiceClient,
  groupId: string,
): Promise<() => Promise<void>> {
  const { data: before, error } = await client
    .from('group_modes')
    .select(COLUMNS)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`snapshotGroupModes: reading ${groupId} failed: ${error.message}`);

  return async () => {
    if (before === null) {
      const { error: deleteError } = await client.from('group_modes').delete().eq('group_id', groupId);
      if (deleteError)
        throw new Error(`snapshotGroupModes: removing ${groupId} failed: ${deleteError.message}`);
      return;
    }
    const { error: restoreError } = await client.from('group_modes').update(before).eq('group_id', groupId);
    if (restoreError)
      throw new Error(`snapshotGroupModes: restoring ${groupId} failed: ${restoreError.message}`);
  };
}
