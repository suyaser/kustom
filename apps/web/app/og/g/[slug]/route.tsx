import { gameCardModel } from '@/lib/og/cards';
import { loadGamePage } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { cardResponse, GameCard, NOT_FOUND } from '../../../_og/Cards';

/**
 * `/og/g/<gameId>`: a game page's share card (M11.4). An unknown or malformed id is a 404, never
 * a blank card that looks like a result.
 *
 * **The segment is a game id, named `slug`** only because Next allows one dynamic name per level
 * and `/og/g/[slug]/tonight` (M13.9) shares this one. A real slug is not a uuid, so it 404s here.
 * M13.11 moves this card to `/og/g/<slug>/games/<gameId>` and turns this address into its 308.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: gameId } = await params;
  const game = await loadGamePage(createPublicClient(), gameId, nightTimeZone());
  if (game === null) return NOT_FOUND();
  return cardResponse(<GameCard model={gameCardModel(game)} />, 'public, max-age=300, s-maxage=300');
}
