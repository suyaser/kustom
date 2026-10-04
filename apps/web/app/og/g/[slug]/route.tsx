import { resolveGroupParam } from '@/lib/groups/resolve';
import { gameImagePath } from '@/lib/og/meta';
import { createPublicClient } from '@/lib/publicClient';
import { NOT_FOUND } from '../../../_og/Cards';

/**
 * `/og/g/<gameId>`: M11.4's game card address, kept as a **308** to the card's group address
 * `/og/g/<slug>/games/<gameId>` (M13.11's brief, moved by M14.16), because Discord and WhatsApp
 * cache the image URLs they have already unfurled. A segment that is not a stored game's id is a
 * 404, never a blank card.
 *
 * **The segment is named `slug`** only because Next allows one dynamic name per level and
 * `/og/g/[slug]/tonight` and `/og/g/[slug]/games/[gameId]` share it.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: gameId } = await params;
  const resolved = await resolveGroupParam(createPublicClient(), gameId);
  if (resolved.kind !== 'game') return NOT_FOUND();
  return Response.redirect(new URL(gameImagePath(resolved.slug, resolved.gameId), request.url), 308);
}
