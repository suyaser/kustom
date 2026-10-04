import type { ServiceClient } from '../supabase';

/**
 * The group's ratings epoch (M14.18, `0027`): `groups.ratings_since`, the moment of the owner's
 * latest `Reset ratings`, or null for a group that never reset.
 *
 * The live fold rates, and `rebuild-ratings --group` folds, only games with
 * `started_at >= ratings_since`. Games before it keep their stored rating columns untouched.
 *
 * **Tolerant of a database without the column** (`0027` not applied yet): Postgres's
 * `undefined_column` reads as "never reset", which is exactly the behaviour before the
 * migration. So this code can merge before or after the lead applies `0027`.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

export async function readRatingsSince(client: ServiceClient, groupId: string): Promise<string | null> {
  const { data, error } = await client.from('groups').select('ratings_since').eq('id', groupId).maybeSingle();
  if (error && MISSING_COLUMN_CODES.has(error.code)) return null;
  if (error) throw new Error(`ratings epoch lookup failed: ${error.message}`);
  return data?.ratings_since ?? null;
}

/** Whether a game that started at `startedAt` counts for ratings under the epoch `since`. */
export function countsForRatings(startedAt: string, since: string | null): boolean {
  return since === null || Date.parse(startedAt) >= Date.parse(since);
}
