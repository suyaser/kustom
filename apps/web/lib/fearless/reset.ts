import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * Move one group's fearless cursor to `now` (M10, per group since M13.3). The pool is derived,
 * so this is the whole write: every counted Rift custom of the group whose `started_at` is after
 * this instant is in, and everything before is out. Idempotent. Does not touch `games`.
 *
 * `groupId` defaults to the original group until the admin route passes the request's group
 * (M13.4).
 */

export async function resetFearless(
  client: ServiceClient,
  input: { playerId: string; now?: Date; groupId?: string },
): Promise<{ resetAt: string }> {
  const resetAt = (input.now ?? new Date()).toISOString();
  const groupId = input.groupId ?? ORIGINAL_GROUP_ID;

  const { data, error } = await client
    .from('fearless_state')
    .update({ reset_at: resetAt, reset_by: input.playerId })
    .eq('group_id', groupId)
    .select('reset_at')
    .maybeSingle();

  if (error) {
    throw new Error(`fearless reset failed: ${error.message}`);
  }

  if (data !== null) {
    return { resetAt: data.reset_at };
  }

  const inserted = await client
    .from('fearless_state')
    .insert({ group_id: groupId, reset_at: resetAt, reset_by: input.playerId })
    .select('reset_at')
    .single();

  if (inserted.error || inserted.data === null) {
    throw new Error(`fearless reset insert failed: ${inserted.error?.message ?? 'no row'}`);
  }

  return { resetAt: inserted.data.reset_at };
}
