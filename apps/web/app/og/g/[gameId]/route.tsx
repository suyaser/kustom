import { gameCardModel } from '@/lib/og/cards';
import { loadGamePage } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { cardResponse, GameCard, NOT_FOUND } from '../../../_og/Cards';

/**
 * `/g/[gameId]`'s share card (M11.4). An unknown or malformed id is a 404, never a blank card
 * that looks like a result.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = await loadGamePage(createPublicClient(), gameId, nightTimeZone());
  if (game === null) return NOT_FOUND();
  return cardResponse(<GameCard model={gameCardModel(game)} />, 'public, max-age=300, s-maxage=300');
}
