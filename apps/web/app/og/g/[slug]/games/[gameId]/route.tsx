import { resolveGroupParam } from '@/lib/groups/resolve';
import { gameCardModel } from '@/lib/og/cards';
import { loadGamePage } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { cardResponse, GameCard, NOT_FOUND } from '../../../../../_og/Cards';

/**
 * `/og/g/<slug>/games/<gameId>`: a game page's share card (M11.4; at its group address since
 * M13.11's brief, moved by M14.16). An unknown group, an unknown or malformed id, or a game of
 * another group is a 404: never a blank card that looks like a result, never another group's game.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; gameId: string }> },
) {
  const { slug, gameId } = await params;
  const client = createPublicClient();
  const resolved = await resolveGroupParam(client, slug);
  if (resolved.kind !== 'group') return NOT_FOUND();
  const game = await loadGamePage(client, gameId, nightTimeZone(), resolved.group.id);
  if (game === null) return NOT_FOUND();
  return cardResponse(
    <GameCard model={gameCardModel(game, resolved.group.name)} />,
    'public, max-age=300, s-maxage=300',
  );
}
