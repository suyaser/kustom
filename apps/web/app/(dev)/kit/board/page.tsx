import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { BoardView } from '@/app/_board/BoardView';
import { PlayerView } from '@/app/_board/PlayerView';
import { RatingChart } from '@/app/_board/RatingChart';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { Shell } from '@/components/shell/Shell';
import { Card } from '@/components/ui/card';
import { DEFAULT_BOARD_SORT } from '@/lib/board/order';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { distinctNames } from '@/lib/names/distinct';
import { withLabel } from '@/lib/names/roster';
import { workedBoard, workedBoardRows, workedPlayer } from '@/lib/testing/boardFixtures';

/**
 * Dev-only preview of the board after a `Reset ratings` (M14.18, STRATEGY 3.6), with the worked
 * example's rows: `?state=all-time` (default; the chip reads `Since 5 Nov`), `?state=player` (a
 * player page on All time after the reset). The `?state=month` preview went with the month windows
 * (M14.48); it now shows the default. `?state=same-names` (M14.69): two `Ali`s on one tag, numbered by
 * first game, and two `Sara`s on different tags. `?state=chart` (M18.7 re-check): the Rating chart's
 * reference label in each placement (under, over, the gutter). Like `/kit`, a 404 in production builds.
 */
const RESET_DAY = '5 Nov';

/** `?state=chart`: one card per label case, so a collision shows at a glance in both themes and widths. */
const CHART_CASES: readonly {
  title: string;
  history: number[];
  reference: number;
  window: 'all-time' | 'this-week';
}[] = [
  {
    title: 'Monotone up (under)',
    history: [1200, 1214, 1231, 1240, 1262, 1280],
    reference: 1200,
    window: 'all-time',
  },
  {
    title: 'Monotone down (over)',
    history: [1200, 1188, 1171, 1160, 1142, 1130],
    reference: 1200,
    window: 'all-time',
  },
  { title: 'Flat (under)', history: [1200, 1200, 1200], reference: 1200, window: 'all-time' },
  {
    title: 'Dip to the line (over)',
    history: [1300, 1300, 1300, 1100, 1200],
    reference: 1200,
    window: 'all-time',
  },
  {
    title: 'Dip and recover (gutter)',
    history: [1250, 1260, 1270, 1280, 1190, 1230],
    reference: 1200,
    window: 'all-time',
  },
  {
    title: 'Week crossing 0 (gutter)',
    history: [0, 12, 30, 41, 18, -9, 6],
    reference: 0,
    window: 'this-week',
  },
];

/** M14.69's preview: four of the worked rows renamed into two clashes, then told apart. */
function sameNameRows() {
  const renamed = [
    { name: 'Ali', tag: 'EUW', firstGameAt: '2025-09-08T19:00:00Z' },
    { name: 'Ali', tag: 'EUW', firstGameAt: '2025-10-01T19:00:00Z' },
    { name: 'Sara', tag: 'EUW', firstGameAt: null },
    { name: 'Sara', tag: 'TR1', firstGameAt: null },
  ];
  const rows = workedBoardRows().map((row, index) => ({ ...row, name: renamed[index]?.name ?? row.name }));
  const names = distinctNames(
    rows.map((row, index) => ({
      puuid: row.puuid,
      name: row.name,
      tag: renamed[index]?.tag ?? null,
      firstGameAt: renamed[index]?.firstGameAt ?? null,
    })),
  );
  return rows.map((row) => withLabel(row, names));
}

export default async function KitBoardPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const state = (await searchParams).state ?? 'all-time';
  const group = ORIGINAL_GROUP;
  const path = '/g/customs/leaderboard';
  const playerHref = (puuid: string) => `/g/customs/p/${puuid}` as Route;

  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={false} account="signed-in">
        {state === 'chart' ? (
          <div className="flex-1">
            <div className="mx-auto grid w-full max-w-7xl gap-4 px-(--gutter) py-6 sm:grid-cols-2 lg:grid-cols-3 lg:py-8">
              {CHART_CASES.map((chart) => (
                <Card key={chart.title}>
                  <div className="flex flex-col gap-3 p-(--card-pad)">
                    <p className="text-sm font-bold">{chart.title}</p>
                    <RatingChart history={chart.history} reference={chart.reference} window={chart.window} />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : state === 'player' ? (
          <div className="flex-1">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
              <PlayerView
                lens="public"
                player={workedPlayer('Hana', { resetDay: RESET_DAY, range: null, window: 'all-time' })}
                group={group}
                viewerPuuid={null}
                path="/g/customs/p/hana"
                gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
                allGamesHref={'/g/customs/games?player=hana' as Route}
                timeZone="Africa/Cairo"
              />
            </div>
          </div>
        ) : (
          <BoardView
            board={
              state === 'same-names'
                ? workedBoard({ rows: sameNameRows() })
                : workedBoard({ range: null, games: 14, resetDay: RESET_DAY })
            }
            viewerPuuid={null}
            sort={DEFAULT_BOARD_SORT}
            page={1}
            path={path}
            playerHref={playerHref}
          />
        )}
      </Shell>
    </PageGroupProvider>
  );
}
