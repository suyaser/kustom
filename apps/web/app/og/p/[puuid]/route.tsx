import { loadPlayerBoard } from '@/lib/board/load';
import { playerCardModel } from '@/lib/og/cards';
import { loadPlayerRoles } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { cardResponse, NOT_FOUND, PlayerCard } from '../../../_og/Cards';

/**
 * `/p/[puuid]`'s share card (M11.4). **Always `All time`**: an image request never sees the
 * page's `?window=`, and the week and all-time numbers disagree on purpose, so the card prints
 * the pair that never resets — `loadPlayerBoard`'s all-time read, the board row's digits.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ puuid: string }> }) {
  const { puuid } = await params;
  const client = createPublicClient();
  const [player, roles] = await Promise.all([
    loadPlayerBoard(client, puuid, { window: 'all-time', timeZone: nightTimeZone() }),
    loadPlayerRoles(client, puuid),
  ]);
  if (player === null) return NOT_FOUND();
  return cardResponse(
    <PlayerCard model={playerCardModel(player, roles)} />,
    'public, max-age=300, s-maxage=300',
  );
}
