import type { ServiceClient } from '../supabase';

/**
 * Every group, oldest first (M13.4), for the crons that loop over groups: the nightly board, the
 * closed-window post and the daily mystery. Oldest first so the original group is always served
 * first and a log reads in the same order every run.
 */
export interface GroupRef {
  id: string;
  slug: string;
}

export async function listGroups(client: ServiceClient): Promise<GroupRef[]> {
  const { data, error } = await client
    .from('groups')
    .select('id, slug, created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`listing groups failed: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, slug: row.slug }));
}
