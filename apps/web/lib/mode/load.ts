import { DEFAULT_GROUP_MODE, type GroupMode, NEW_GROUP_MODE, parseGroupMode } from '@customs/db/schemas';
import { cache } from 'react';
import type { PublicClient } from '../publicClient';

/**
 * The group's one `group_modes` row, every column a page reads (the standing mode and when it was
 * set, and the M15 card state), **once per render** (app-perf, 2026-10-04): the fearless pool and
 * the Mode card both ask, and asked separately they were two round trips for one row. React's
 * `cache` keys on the client object and the group, so the dedupe only joins callers that share a
 * client inside one server render; a route handler or a script (no render) reads every time,
 * which is what a writer that re-reads after its own write needs.
 */
export const readGroupModeRow = cache((client: PublicClient, groupId: string) =>
  client
    .from('group_modes')
    .select('mode, updated_at, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override')
    .eq('group_id', groupId)
    .maybeSingle()
    .then((result) => result),
);

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
  const { data, error } = await readGroupModeRow(client, groupId);

  if (error) {
    console.error('mode: reading the group mode failed', error.message);
    return { mode: DEFAULT_GROUP_MODE, since: null };
  }

  if (data === null) return { mode: NEW_GROUP_MODE, since: null };
  return { mode: parseGroupMode(data.mode), since: data.updated_at };
}
