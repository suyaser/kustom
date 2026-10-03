import { myGroupsResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { listMyGroups } from '@/lib/groups/create';
import { type SessionRouteOptions, withSession } from '@/lib/groups/sessionRoute';
import { jsonOk } from '@/lib/http';

/**
 * `GET /api/groups/mine` (M13.5): `[{ id, slug, name, role }]` of the session player's
 * memberships, oldest first. A session with no linked player is in no group: an empty list, not a
 * refusal.
 */
export function myGroupsRoute(options: SessionRouteOptions = {}) {
  return withSession(async (_request, { client, me }): Promise<NextResponse> => {
    const groups = me.player === null ? [] : await listMyGroups(client, me.player.playerId);
    return jsonOk(myGroupsResponseSchema, { ok: true, groups });
  }, options);
}
