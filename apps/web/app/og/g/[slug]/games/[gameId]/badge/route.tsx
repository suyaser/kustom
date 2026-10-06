import { isRemake } from '@/lib/games/remake';
import { resolveGroupParam } from '@/lib/groups/resolve';
import { loadGamePage } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { badgeResponse, ResultBadge } from '../../../../../../_og/Badges';
import { NOT_FOUND } from '../../../../../../_og/Cards';

/**
 * `/og/g/<slug>/games/<gameId>/badge`: the result post's thumbnail (M14.61, 05-design 10.11 B2),
 * `RED WINS` or `BLUE WINS` on the page colour. The game card's 404 rules: an unknown group, an
 * unknown or malformed id, or a game of another group is a 404, which leaves Discord laying the
 * post out without the image. So is a remake: it names no winner anywhere (05-design 15).
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
  if (game === null || isRemake(game.result.durationS)) return NOT_FOUND();
  return badgeResponse(
    <ResultBadge side={game.result.winningSide === 100 ? 100 : 200} />,
    'public, max-age=300, s-maxage=300',
  );
}
