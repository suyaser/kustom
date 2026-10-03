import { jsonError, jsonOk } from '@/lib/http';
import { listPuuidGroups, overlayGroupFor } from '@/lib/overlay/groups';
import { loadOverlay } from '@/lib/overlay/load';
import { createPublicClient } from '@/lib/publicClient';
import { getServiceClient } from '@/lib/supabase';
import { emptyOverlay, overlayQuerySchema, overlayResponseSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Champ-select overlay payload (M12). Public: fearless pool plus the viewer's posted
 * lobby with same-side and against records. Query: `?puuid=&group=`.
 *
 * **One group's view** (M13.3): the fearless pool, tonight's lobby, the ratings and the records
 * are all the group's. The answer is only given when the PUUID is a member of that group; a
 * PUUID asking for a group it is not in -- or an unknown PUUID, or one in several groups that
 * named none -- gets the same empty answer: no champions, no lobby.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = overlayQuerySchema.safeParse({
    puuid: url.searchParams.get('puuid') ?? undefined,
    group: url.searchParams.get('group') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'puuid is required and group, when given, is a group id');
  }

  try {
    const { puuid } = parsed.data;
    const groupId = overlayGroupFor(
      await listPuuidGroups(getServiceClient(), puuid),
      parsed.data.group ?? null,
    );
    if (groupId === null) return jsonOk(overlayResponseSchema, emptyOverlay(puuid));

    const view = await loadOverlay(createPublicClient(), { puuid, groupId });
    return jsonOk(overlayResponseSchema, {
      ok: true,
      viewerPuuid: view.viewerPuuid,
      fearless: {
        champions: [...view.fearless.champions],
        resetAt: view.fearless.resetAt,
      },
      lobby: view.lobby,
    });
  } catch (error) {
    console.error('overlay: load failed', error);
    return jsonError(500, 'overlay load failed');
  }
}
