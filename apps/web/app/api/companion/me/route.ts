import { companionMeResponseSchema } from '@customs/db/schemas';
import { withCompanionIdentity } from '@/lib/companionRoute';
import { groupSummaryById } from '@/lib/groups/create';
import { jsonError, jsonOk } from '@/lib/http';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/companion/me`: who this token is. The companion calls it on first run, right after
 * a friend pastes the token they were given, so "wrong token" is a sentence on their screen
 * instead of a silent 401 on the first lobby of the night (M2.1).
 *
 * The token decides the identity; there is no body and nothing here reads a PUUID from the
 * caller. Writes nothing, so a companion may call it on every start.
 */
export const GET = withCompanionIdentity(async (_request, { client, identity }) => {
  const { data, error } = await client
    .from('players')
    .select('display_name')
    .eq('id', identity.playerId)
    .maybeSingle();
  if (error) throw new Error(`companion me: player lookup failed: ${error.message}`);
  if (data === null) {
    // The token row references a player that no longer exists: not this caller's fault, and
    // not something they can fix, but it is not a valid identity either.
    return jsonError(401, 'companion token has no player');
  }

  // The group this token posts to (M13.3), so Kustom can file a pasted token under it (M14.6,
  // M14.12). `companion_tokens.group_id` is a foreign key, so a missing group is our bug: a 500.
  const group = await groupSummaryById(client, identity.groupId);
  if (group === null) throw new Error('companion me: the token group is not readable');

  return jsonOk(companionMeResponseSchema, {
    ok: true,
    puuid: identity.puuid,
    playerId: identity.playerId,
    displayName: data.display_name,
    group,
  });
});
