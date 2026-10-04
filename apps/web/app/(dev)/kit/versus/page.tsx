import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { PlayerView } from '@/app/_board/PlayerView';
import { VersusPitch } from '@/app/_board/VersusPitch';
import { YouVsThemCard } from '@/app/_board/YouVersus';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { Shell } from '@/components/shell/Shell';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedPlayer } from '@/lib/testing/boardFixtures';
import { KIT_VERSUS } from '@/lib/testing/versusKit';

/**
 * Dev-only preview of You vs them on someone else's player page (M14.35), with the pitch lines a
 * finished Tonight and the game page mount. `?state=met` (default), `?state=never`, `?state=tied`.
 * A real view needs a Discord session. A 404 in production builds.
 */
export default async function KitVersusPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state } = await searchParams;
  const group = ORIGINAL_GROUP;
  const player = workedPlayer('Hana', { name: 'Baron Nashor Lover' });
  const base = KIT_VERSUS[1] ?? null;
  const row =
    state === 'never'
      ? null
      : state === 'tied' && base !== null
        ? { ...base, lanes: [{ role: 'adc' as const, you: 3, them: 3 }] }
        : base;

  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={false} account="signed-in">
        <div className="flex-1">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
            <PlayerView
              lens="public"
              player={player}
              group={group}
              viewerPuuid="someone-else"
              versus={<YouVsThemCard name="Baron Nashor Lover" row={row} />}
              path="/g/customs/p/kit"
              gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
              allGamesHref={'/g/customs/games?player=kit' as Route}
              timeZone="Africa/Cairo"
            />
            <VersusPitch
              viewer="not-linked"
              nightKey="kit"
              here="/kit/versus"
              you={'/g/customs/you' as Route}
            />
            <VersusPitch viewer="linked" nightKey="kit" here="/kit/versus" you={'/g/customs/you' as Route} />
          </div>
        </div>
      </Shell>
    </PageGroupProvider>
  );
}
