import { isSettling } from '@customs/core';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { PlayerView } from '@/app/_board/PlayerView';
import { YouVsEveryone } from '@/app/_board/YouVersus';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { AiLinesAboutYou } from '@/components/premium/AiLinesAboutYou';
import { Shell } from '@/components/shell/Shell';
import { YouPage } from '@/components/shell/YouPage';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedPlayer, workedRecentGame } from '@/lib/testing/boardFixtures';
import { KIT_VERSUS } from '@/lib/testing/versusKit';

/**
 * Dev-only preview of the You tab's signed-in states (M14.7b; the self lens since M14.15) inside the
 * real shell, with the worked example's numbers: a real signed-in view needs a Discord session,
 * which the local stack cannot mint without writing auth rows. `?state=linked` (default, an admin
 * with games tonight), `?state=settling` (4 rated games), `?state=new` (no games yet) or
 * `?state=unlinked`; add `&welcome=1` for the welcome card (M14.33), `&creator=1` (with `state=unlinked`) for M14.51's creator before linking, `&ai=on|off` for M16.3b's `AI lines about you` card. Like `/kit`, a 404 in production builds.
 */
export default async function KitYouPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; welcome?: string; ai?: string; creator?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state, welcome, ai, creator } = await searchParams;
  const group = ORIGINAL_GROUP;
  const common = { group, here: '/g/customs/you', daily: '/mystery', discordName: 'shadowreaper' } as const;

  const base = workedPlayer('Hana', {
    name: 'TheSHADOWREAPER',
    recent: [
      workedRecentGame({ gameId: 'g3', won: true, side: 200, rBefore: 1392, rAfter: 1434, award: 'mvp' }),
      workedRecentGame({ gameId: 'g2', blueWinProb: null, pickRank: null, ratingsBefore: null }),
      workedRecentGame({ gameId: 'g1', won: true, side: 200, rBefore: 1356, rAfter: 1392, pickRank: 2 }),
    ],
  });
  const player =
    state === 'new'
      ? {
          ...base,
          // No rated game: the Rating is the seed the first fold will start from.
          rating: base.reference,
          games: 0,
          wins: 0,
          losses: 0,
          ratedGames: 0,
          settling: true,
          rank: null,
          history: [],
          recent: [],
        }
      : state === 'settling'
        ? { ...base, games: 4, wins: 3, losses: 1, ratedGames: 4, settling: isSettling(4), rank: null }
        : base;

  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={state !== 'unlinked' || creator === '1'} account="signed-in">
        {state === 'unlinked' ? (
          <YouPage kind="unlinked" {...common} admin={creator === '1' ? '/g/customs/admin' : null} />
        ) : (
          <YouPage
            kind="linked"
            {...common}
            admin="/admin"
            playerPage={'/g/customs/p/audit-p10' as Route}
            owner
            aiLines={
              ai === undefined ? null : (
                <AiLinesAboutYou groupId={group.id} groupName={group.name} writeAboutMe={ai !== 'off'} />
              )
            }
            versus={
              <YouVsEveryone
                rows={state === 'new' ? [] : KIT_VERSUS}
                pickTwo={(them) => `/g/customs/stats/1v1?a=audit-p10&b=${them}` as Route}
              />
            }
            self={
              <PlayerView
                lens="self"
                player={player}
                group={group}
                viewerPuuid={player.puuid}
                tonightDelta={state === 'new' ? null : 38}
                path="/g/customs/p/audit-p10"
                gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
                allGamesHref={'/g/customs/games?player=audit-p10' as Route}
                timeZone="Africa/Cairo"
                welcome={welcome === '1' ? { home: '/g/customs' as Route } : null}
              />
            }
          />
        )}
      </Shell>
    </PageGroupProvider>
  );
}
