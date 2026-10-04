import { type AdminGroupQuery, adminGroupQuerySchema, adminGroupResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { adminAccess, adminInviteView } from '@/lib/admin/readView';
import { type AdminReadContext, type AdminReadRouteOptions, withAdminRead } from '@/lib/adminRoute';
import { readGroupInvite } from '@/lib/groups/invites';
import { jsonError, jsonOk } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';

/**
 * `GET /api/admin/group?groupId=` (M14.19): the admin home's header read -- the group, how the
 * session reads it, and the invite link as that session may see it. Through the read gate, so a
 * group admin and the operator (`SUPER_ADMIN_USER_IDS`) both pass; the operator's invite is
 * `hidden` and the stored code is never read for them.
 */
export async function handleAdminGroup(
  _query: AdminGroupQuery,
  context: AdminReadContext,
): Promise<NextResponse> {
  const { data: group, error } = await context.client
    .from('groups')
    .select('id, slug, name')
    .eq('id', context.groupId)
    .maybeSingle();
  if (error) throw new Error(`admin group read failed: ${error.message}`);
  if (group === null) return jsonError(404, 'no such group');

  const invite =
    context.reader.kind === 'group_admin' ? await readGroupInvite(context.client, context.groupId) : null;

  return jsonOk(adminGroupResponseSchema, {
    ok: true,
    group: { id: group.id, slug: group.slug, name: group.name },
    access: adminAccess(context.reader),
    invite: adminInviteView(context.reader, invite, siteOrigin(context.request)),
  });
}

export function adminGroupRoute(
  options: AdminReadRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminRead(adminGroupQuerySchema, handleAdminGroup, options);
}
