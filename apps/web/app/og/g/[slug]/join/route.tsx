import { resolveGroupParam } from '@/lib/groups/resolve';
import { joinCardModel } from '@/lib/og/cards';
import { createPublicClient } from '@/lib/publicClient';
import { cardResponse, NOT_FOUND, PitchCard } from '../../../../_og/Cards';

/**
 * `/og/g/<slug>/join`: a live invite's card (M14.42, scene-walk gap 9), `Join <Group>` and the join
 * page's pitch. Addressed by the group's public slug, **never by the invite code**: the code is
 * service-role only and stays out of every image URL. `/join/<code>` points here only after the
 * code resolved to this group; a dead code points at `/og/kustom` instead. An unknown slug is a
 * 404.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveGroupParam(createPublicClient(), (await params).slug);
  if (resolved.kind !== 'group') return NOT_FOUND();
  return cardResponse(
    <PitchCard model={joinCardModel(resolved.group.name)} />,
    'public, max-age=300, s-maxage=300',
  );
}
