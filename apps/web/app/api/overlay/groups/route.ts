import { overlayGroupsQuerySchema, overlayGroupsResponseSchema } from '@customs/db/schemas';
import { jsonError, jsonOk } from '@/lib/http';
import { listPuuidGroups } from '@/lib/overlay/groups';
import { getServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/overlay/groups?puuid=` (M13.3): `[{ id, slug, name }]` of every group the PUUID is a
 * member of, oldest membership first. No token, like `GET /api/overlay`: anyone who knows a PUUID
 * can learn its groups' names, and PUUIDs are already in `/p/<puuid>` URLs, so this reveals
 * nothing a link does not. An unknown PUUID is an empty list, not a 404.
 */
export async function GET(request: Request): Promise<Response> {
  const parsed = overlayGroupsQuerySchema.safeParse({
    puuid: new URL(request.url).searchParams.get('puuid') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'puuid is required');

  try {
    const groups = await listPuuidGroups(getServiceClient(), parsed.data.puuid);
    return jsonOk(overlayGroupsResponseSchema, { ok: true, groups });
  } catch (error) {
    console.error('overlay groups: load failed', error);
    return jsonError(500, 'overlay groups load failed');
  }
}
