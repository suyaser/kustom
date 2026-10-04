import { notFound } from 'next/navigation';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { AiRecap } from '@/components/ai/AiRecap';
import { Shell } from '@/components/shell/Shell';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { gameDetailFixture } from '@/lib/testing/gameDetailFixture';
import { GameDetail } from '../../../../_games/GameDetail';

/**
 * Dev-only (M16.4): the game page with an AI recap, for the screenshots the local data cannot
 * reach without a model key. `?viewer=lead` draws the admin's `Hide` (the tonight kit's word for an admin) (the real page decides it
 * from the session); `?recap=none` is the page with no line. A 404 in production.
 */
const KIT_RECAP = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
  text: 'Ayasofya-Kebab-Enjoyer went 9 and 0 on Lee Sin, and Red closed it out in 31 minutes with 31 kills.',
};

export default async function KitAiGamePage({
  searchParams,
}: {
  searchParams: Promise<{ viewer?: string; recap?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { viewer, recap } = await searchParams;
  const admin = viewer === 'lead';
  const group = ORIGINAL_GROUP;
  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={admin} account={admin ? 'signed-in' : 'anonymous'}>
        <GameDetail
          game={gameDetailFixture()}
          backHref={`/g/${group.slug}/games`}
          howHref="/how"
          group={group}
          recap={
            recap === 'none' ? null : (
              <AiRecap recap={KIT_RECAP} groupId={group.id} canHide={admin} hideRedirect="/kit/ai/game" />
            )
          }
        />
      </Shell>
    </PageGroupProvider>
  );
}
