import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { PlayerView } from '@/app/_board/PlayerView';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { AiRecap } from '@/components/ai/AiRecap';
import { Shell } from '@/components/shell/Shell';
import { AI_SCOUTING_LABEL, AI_SCOUTING_TAP } from '@/lib/ai/recapCopy';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedPlayer } from '@/lib/testing/boardFixtures';

/**
 * Dev-only (M16.6): a player page with the AI scouting report, for the screenshots the local data
 * cannot reach without a model key. `?viewer=lead` draws the admin's `Hide` (the real page decides
 * it from the session); `?report=none` is the page with no report; `?lens=self` is the top of `/you` (no Hide there). A 404 in production.
 */

const KIT_REPORT = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000003',
  text: 'Hana lives in the mid lane: 24 games there at 58 percent, with Ahri the go-to pick on 11 games. Over the week Hana went 4 wins in 6 games, and the form held.',
};

export default async function KitAiPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ viewer?: string; report?: string; lens?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { viewer, report, lens } = await searchParams;
  const self = lens === 'self';
  const admin = viewer === 'lead';
  const group = ORIGINAL_GROUP;
  const player = workedPlayer();
  const path = `/g/customs/p/${player.puuid}`;
  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={admin} account={admin ? 'signed-in' : 'anonymous'}>
        <div className="flex-1">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
            <PlayerView
              lens={self ? 'self' : 'public'}
              player={player}
              group={group}
              viewerPuuid={self ? player.puuid : null}
              path={path}
              gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
              allGamesHref={`/g/customs/games?player=${player.puuid}` as Route}
              timeZone="Africa/Cairo"
              scouting={
                report === 'none' ? undefined : (
                  <AiRecap
                    recap={KIT_REPORT}
                    groupId={group.id}
                    label={AI_SCOUTING_LABEL}
                    tap={AI_SCOUTING_TAP}
                    footnote="Written Sunday 4 Oct"
                    canHide={admin && !self}
                    hideRedirect="/kit/ai/player"
                  />
                )
              }
            />
          </div>
        </div>
      </Shell>
    </PageGroupProvider>
  );
}
