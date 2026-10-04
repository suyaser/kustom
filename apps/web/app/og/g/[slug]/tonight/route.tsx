import { resolveGroupParam } from '@/lib/groups/resolve';
import { tonightCardModel } from '@/lib/og/cards';
import { createPublicClient } from '@/lib/publicClient';
import { loadTonight } from '@/lib/tonight/load';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { cardResponse, NOT_FOUND, TonightCard } from '../../../../_og/Cards';

/**
 * `/g/<slug>`'s share card (M11.4's, scoped to the group by M13.9): the group's strip at the
 * moment the unfurl bot asked. WhatsApp keeps a card per URL, so one can be a night old; the slug
 * on it says which night. Accepted, not busted.
 *
 * An unknown slug is a 404, never another group's night. `/og/tonight` 308s here for the
 * original group (`next.config.ts`).
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const client = createPublicClient();
  const resolved = await resolveGroupParam(client, (await params).slug);
  if (resolved.kind !== 'group') return NOT_FOUND();
  const snapshot = await loadTonight(client, {
    nightStart: tonightStart(),
    timeZone: nightTimeZone(),
    groupId: resolved.group.id,
  });
  return cardResponse(
    <TonightCard model={tonightCardModel(snapshot, resolved.group.name)} />,
    'public, max-age=60, s-maxage=60',
  );
}
