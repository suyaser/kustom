import { loadPlayerBoard } from '@/lib/board/load';
import { resolveGroupParam } from '@/lib/groups/resolve';
import { playerCardModel } from '@/lib/og/cards';
import { loadPlayerRoles } from '@/lib/og/load';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { cardResponse, NOT_FOUND, PlayerCard } from '../../../../../_og/Cards';

/**
 * `/g/<slug>/p/<puuid>`'s share card (M11.4, moved under the group by M14.15 / M13.10). **Always
 * `All time`, in this group**: the numbers the group's `All time` board row prints for this player.
 * An unknown group, or a PUUID with nothing in it, is a 404. `/og/p/<puuid>` 308s here for the
 * original group (`next.config.ts`).
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; puuid: string }> },
) {
  const { slug, puuid } = await params;
  const client = createPublicClient();
  const resolved = await resolveGroupParam(client, slug);
  if (resolved.kind !== 'group') return NOT_FOUND();

  const [player, roles] = await Promise.all([
    loadPlayerBoard(client, puuid, {
      window: 'all-time',
      groupId: resolved.group.id,
      timeZone: nightTimeZone(),
    }),
    loadPlayerRoles(client, puuid),
  ]);
  if (player === null) return NOT_FOUND();
  return cardResponse(
    <PlayerCard model={playerCardModel(player, roles, resolved.group.name)} />,
    'public, max-age=300, s-maxage=300',
  );
}
