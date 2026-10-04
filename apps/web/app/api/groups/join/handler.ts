import { joinGroupRequestSchema, joinGroupResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { invalidateGroup } from '@/lib/cache/tags';
import { joinGroup } from '@/lib/groups/invites';
import { type SessionRouteOptions, withSession } from '@/lib/groups/sessionRoute';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/http';
import { bumpIfWrote } from '@/lib/live/bump';

/**
 * `POST /api/groups/join { code }` (M13.5): `Join <Group>` on `/join/<code>`, for a session that is
 * already linked to a player. Adds `member`, or keeps the role they had; never mints a companion
 * token. 403 for an unlinked session (the page shows them the pairing code instead), 404 with the
 * dead-link sentence for a rotated or unknown code.
 */
export function joinGroupRoute(options: SessionRouteOptions = {}) {
  return withSession(async (request, { client, me }): Promise<NextResponse> => {
    const body = await parseJsonBody(request, joinGroupRequestSchema);
    if (!body.ok) return body.response;

    const result = await joinGroup(client, {
      code: body.data.code,
      userId: me.userId,
      playerId: me.player?.playerId ?? null,
    });
    if (!result.ok) return jsonError(result.status, result.error);

    invalidateGroup(result.value.group.id, ['roster']);
    // Tonight's live signal (M19.9): only a join that made the membership.
    await bumpIfWrote(client, result.value.group.id, 'roster', result.value.outcome === 'joined');
    return jsonOk(joinGroupResponseSchema, { ok: true, ...result.value });
  }, options);
}
