import type { Database } from '@customs/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The `group_live.version` a Tonight render hands its page (M19.10), so the page's first
 * `SUBSCRIBED` re-reads only when the group moved since.
 *
 * **Never newer than the data.** The version is read beside the render's data reads, not before
 * them, so a bump that lands during the render could be read while an earlier data read missed the
 * write; the page would then take that version as already shown and never re-read. So a row bumped
 * within {@link LIVE_RACE_MARGIN_MS} of the render's start is handed down one lower: the page
 * re-reads once on subscribe, which costs one render only in the rare case a write raced the
 * render. The margin also covers clock skew between the server and the database.
 *
 * `null` (no row, or the read failed) makes the page re-read on subscribe, as before M19.10.
 */
export const LIVE_RACE_MARGIN_MS = 2_000;

export interface LiveVersionRow {
  version: number;
  changed_at: string;
}

/** Pure: the version to hand down for a row read during a render that started at `renderStartMs`. */
export function safeLiveVersion(row: LiveVersionRow | null, renderStartMs: number): number | null {
  if (row === null || !Number.isInteger(row.version) || row.version < 0) return null;
  const changed = Date.parse(row.changed_at);
  if (Number.isNaN(changed)) return null;
  return changed > renderStartMs - LIVE_RACE_MARGIN_MS ? row.version - 1 : row.version;
}

/** One anon read of the group's row, never throwing: a failure is `null`. */
export async function loadLiveVersionOrNone(
  client: SupabaseClient<Database>,
  groupId: string,
  renderStartMs: number,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from('group_live')
      .select('version, changed_at')
      .eq('group_id', groupId)
      .maybeSingle();
    if (error !== null) return null;
    return safeLiveVersion(data, renderStartMs);
  } catch {
    return null;
  }
}
