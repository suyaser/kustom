import { NOT_A_GROUP_ADMIN } from '../adminAuth';
import { loadBoard } from '../board/load';
import { compareBoardRows } from '../board/order';
import type { PlayerName } from '../discord/embeds';
import { postRatingsReset } from '../discord/ratingsReset';
import type { WebhookOutcome } from '../discord/webhook';
import type { ServiceClient } from '../supabase';
import { FINISH_TONIGHT_FIRST, ONLY_OWNER_RESETS, RESET_NEEDS_SLUG } from './homeCopy';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * The owner's `Reset ratings` (M14.18, STRATEGY §3.6): one per-group epoch, never per person.
 *
 * The rules live in `reset_group_ratings()` (`0027`), under the group's row lock: owner only,
 * refused while a lobby is live or a game landed in the last 15 minutes, then
 * `groups.ratings_since = now()` and the group's `ratings` rows deleted (everyone back to the
 * seed). This file adds what the database cannot: the typed confirmation (the slug, checked here
 * on the server), the top three for the Discord post (read **before** the reset, since the post is
 * the only record), and the post itself, once, after a reset that happened.
 */

// The three refusals live in the client-safe copy file, because the page prints them in place.
export { FINISH_TONIGHT_FIRST, ONLY_OWNER_RESETS, RESET_NEEDS_SLUG };

/** No such group (404). */
export const NO_SUCH_GROUP = 'no such group';

const OUTCOMES = ['ok', 'not_found', 'forbidden', 'owner_only', 'busy'] as const;
type Outcome = (typeof OUTCOMES)[number];

export interface ResetRatingsInput {
  groupId: string;
  /** The session's player, as the admin gate resolved it. Never an id from the body. */
  actorId: string;
  /** What the owner typed. */
  confirmSlug: string;
  /** For the Discord post's link. */
  requestOrigin?: string | null;
  now?: Date;
  /** Injected in tests: the webhook call. */
  fetchImpl?: typeof fetch;
}

export interface ResetRatingsResult {
  ratingsSince: string;
  post: WebhookOutcome['status'];
}

export async function resetGroupRatings(
  client: ServiceClient,
  input: ResetRatingsInput,
): Promise<AdminWriteResult<ResetRatingsResult>> {
  const { data: group, error: groupError } = await client
    .from('groups')
    .select('slug')
    .eq('id', input.groupId)
    .maybeSingle();
  if (groupError) throw new Error(`resetGroupRatings: group read failed: ${groupError.message}`);
  if (group === null) return writeFailed(404, NO_SUCH_GROUP);
  if (input.confirmSlug.trim() !== group.slug) return writeFailed(400, RESET_NEEDS_SLUG);

  const topThree = await topThreeBeforeReset(client, input.groupId, input.now);

  const { data, error } = await client.rpc('reset_group_ratings', {
    p_group_id: input.groupId,
    p_actor_id: input.actorId,
  });
  if (error) throw new Error(`resetGroupRatings failed: ${error.message}`);

  switch (outcomeOf(data)) {
    case 'not_found':
      return writeFailed(404, NO_SUCH_GROUP);
    case 'forbidden':
      return writeFailed(403, NOT_A_GROUP_ADMIN);
    case 'owner_only':
      return writeFailed(403, ONLY_OWNER_RESETS);
    case 'busy':
      return writeFailed(409, FINISH_TONIGHT_FIRST);
    case 'ok':
      break;
  }

  const { data: after, error: afterError } = await client
    .from('groups')
    .select('ratings_since')
    .eq('id', input.groupId)
    .single();
  if (afterError) throw new Error(`resetGroupRatings: epoch read failed: ${afterError.message}`);

  // Once, after a reset that happened. A webhook that is down costs a log line, never the reset.
  const outcome = await postRatingsReset(client, topThree, {
    groupId: input.groupId,
    requestOrigin: input.requestOrigin ?? null,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });

  return writeOk({ ratingsSince: after.ratings_since ?? new Date().toISOString(), post: outcome.status });
}

function outcomeOf(data: unknown): Outcome {
  if (typeof data === 'string' && (OUTCOMES as readonly string[]).includes(data)) return data as Outcome;
  throw new Error(`resetGroupRatings: unexpected answer ${String(data)}`);
}

/**
 * The `All time` board's first three **ranked** rows (not settling), by the board's own order:
 * the names the post prints. A failed read is logged and gives an empty list, so the post says
 * the reset happened and leaves the top three off; it never blocks the reset.
 */
async function topThreeBeforeReset(
  client: ServiceClient,
  groupId: string,
  now: Date | undefined,
): Promise<PlayerName[]> {
  try {
    const board = await loadBoard(client, { window: 'all-time', groupId, now: now ?? new Date() });
    return board.rows
      .filter((row) => !row.settling)
      .sort(compareBoardRows)
      .slice(0, 3)
      .map((row) => row.name);
  } catch (error) {
    console.error('ratings reset: reading the top three failed; posting without them', error);
    return [];
  }
}
