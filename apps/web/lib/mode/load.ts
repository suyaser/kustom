import { DEFAULT_GROUP_MODE, type GroupMode, NEW_GROUP_MODE, parseGroupMode } from '@customs/db/schemas';
import type { PublicClient } from '../publicClient';

/**
 * The group's standing mode (M14.29): `group_modes.mode`, one row per group since `0024`.
 *
 * Read with whichever client the caller has: `group_modes` is public-read, so Tonight's anon client
 * and the service role see the same row. Name the columns: since `0029` (M14.40) anon may not read
 * `set_by`, so a `select('*')` with the anon key is a 42501. A failed read logs and answers
 * {@link DEFAULT_GROUP_MODE} (`fearless`, what every group that existed before `0030` is on), the
 * same way {@link loadFearless} never 500s a page over a ban list; so does a value this build does
 * not know (a newer deployment's mode). A missing row is a new group (one created between a deploy
 * and its migration) and reads as {@link NEW_GROUP_MODE} (`normal`, M14.46), what it would have
 * been born on.
 */
export async function loadGroupMode(client: PublicClient, groupId: string): Promise<GroupMode> {
  return (await loadGroupModeState(client, groupId)).mode;
}

/**
 * The mode and when it was last set (`group_modes.updated_at`, M14.30): the Mode card's
 * "Normal mode now." note shows from a switch until the next game lands. `since` is `null` on a
 * failed read or a missing row.
 */
export async function loadGroupModeState(
  client: PublicClient,
  groupId: string,
): Promise<{ mode: GroupMode; since: string | null }> {
  const { data, error } = await client
    .from('group_modes')
    .select('mode, updated_at')
    .eq('group_id', groupId)
    .maybeSingle();

  if (error) {
    console.error('mode: reading the group mode failed', error.message);
    return { mode: DEFAULT_GROUP_MODE, since: null };
  }

  if (data === null) return { mode: NEW_GROUP_MODE, since: null };
  return { mode: parseGroupMode(data.mode), since: data.updated_at };
}
