import type { ServiceClient } from '../supabase';
import { FEARLESS_STATE_ID } from './types';

/**
 * Move the fearless cursor to `now` (M10). The pool is derived, so this is the whole write:
 * every counted Rift custom whose `started_at` is after this instant is in, and everything
 * before is out. Idempotent. Does not touch `games`.
 */

export async function resetFearless(
  client: ServiceClient,
  input: { playerId: string; now?: Date },
): Promise<{ resetAt: string }> {
  const resetAt = (input.now ?? new Date()).toISOString();

  const { data, error } = await client
    .from('fearless_state')
    .update({ reset_at: resetAt, reset_by: input.playerId })
    .eq('id', FEARLESS_STATE_ID)
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
    .insert({ id: FEARLESS_STATE_ID, reset_at: resetAt, reset_by: input.playerId })
    .select('reset_at')
    .single();

  if (inserted.error || inserted.data === null) {
    throw new Error(`fearless reset insert failed: ${inserted.error?.message ?? 'no row'}`);
  }

  return { resetAt: inserted.data.reset_at };
}
