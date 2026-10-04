import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { BoardView } from '@/app/_board/BoardView';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { AiRecap } from '@/components/ai/AiRecap';
import { Shell } from '@/components/shell/Shell';
import { AI_STORYLINE_TAP } from '@/lib/ai/recapCopy';
import { DEFAULT_BOARD_SORT } from '@/lib/board/order';
import type { BoardView as BoardModel } from '@/lib/board/types';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { workedWindowBoard } from '@/lib/testing/boardFixtures';

/**
 * Dev-only (M16.5): the board's Last week with the weekly storyline, for the screenshots the local
 * data cannot reach without a model key. `?viewer=lead` draws the admin's `Hide` (the real page
 * decides it from the session); `?storyline=none` is the board with no line. A 404 in production.
 */

/**
 * The worked ten's Last week with varied rows (the fixture gives everyone `+58 · 4W 2L`): six rated
 * games, everyone in all six, 30 wins between them, ranked by net points as the week board is.
 */
const VARIED: Readonly<Record<string, { wins: number; points: number }>> = {
  Lena: { wins: 5, points: 96 },
  Bilal: { wins: 5, points: 80 },
  Rami: { wins: 4, points: 44 },
  Iris: { wins: 3, points: 12 },
  Karim: { wins: 3, points: 6 },
  Omar: { wins: 3, points: -4 },
  Hana: { wins: 2, points: -30 },
  Theo: { wins: 2, points: -38 },
  Nadia: { wins: 2, points: -52 },
  Yuki: { wins: 1, points: -88 },
};

function kitBoard(): BoardModel {
  const board = workedWindowBoard('last-week');
  const rows = board.rows
    .map((row) => {
      const varied = typeof row.name === 'string' ? VARIED[row.name] : undefined;
      return varied === undefined
        ? row
        : { ...row, wins: varied.wins, losses: 6 - varied.wins, points: varied.points };
    })
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  return { ...board, rows };
}

/** Written from the board above: every number in it is one the board prints. */
const KIT_STORYLINE = {
  kind: 'line' as const,
  lineId: '10000000-0000-4000-8000-000000000002',
  text: "Lena finished first on the week's board with 5 wins from 6 games and 96 points. Bilal matched the 5 wins and took 2nd place with 80 points, and Rami held 3rd with 4 wins. 6 rated games in the week, and all ten played every one.",
};

export default async function KitAiBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ viewer?: string; storyline?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { viewer, storyline } = await searchParams;
  const admin = viewer === 'lead';
  const group = ORIGINAL_GROUP;
  const path = '/g/customs/leaderboard';
  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={admin} account={admin ? 'signed-in' : 'anonymous'}>
        <BoardView
          board={kitBoard()}
          viewerPuuid={null}
          sort={DEFAULT_BOARD_SORT}
          page={1}
          path={path}
          playerHref={(puuid: string) => `/g/customs/p/${puuid}` as Route}
          storyline={
            storyline === 'none' ? undefined : (
              <AiRecap
                recap={KIT_STORYLINE}
                groupId={group.id}
                tap={AI_STORYLINE_TAP}
                canHide={admin}
                hideRedirect="/kit/ai/board"
              />
            )
          }
        />
      </Shell>
    </PageGroupProvider>
  );
}
