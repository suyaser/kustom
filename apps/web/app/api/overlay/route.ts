import { jsonError, jsonOk } from '@/lib/http';
import { loadOverlay } from '@/lib/overlay/load';
import { createPublicClient } from '@/lib/publicClient';
import { overlayQuerySchema, overlayResponseSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Champ-select overlay payload (M12). Public: fearless pool plus the viewer's posted
 * lobby with same-side and against records. Query: `?puuid=`.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = overlayQuerySchema.safeParse({
    puuid: url.searchParams.get('puuid') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'puuid is required');
  }

  try {
    const view = await loadOverlay(createPublicClient(), { puuid: parsed.data.puuid });
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
