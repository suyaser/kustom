import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { BoardView } from '@/app/_board/BoardView';
import { PlayerView } from '@/app/_board/PlayerView';
import { PageGroupProvider } from '@/app/_shell/PageGroup';
import { Shell } from '@/components/shell/Shell';
import { boardSlotLine, WINDOW_LABELS } from '@/lib/board/copy';
import { DEFAULT_BOARD_SORT } from '@/lib/board/order';
import { resultEmbed, windowSummaryEmbed } from '@/lib/discord/embeds';
import { boardPostEntries } from '@/lib/discord/post';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { kitAllTimeRows, kitPlayer, kitPuuid, kitResultInput, kitWeekRows } from '@/lib/testing/kustomKit';
import { DiscordPreview } from './DiscordPreview';

/**
 * Dev-only: every M18.7 surface on one consistent Kustom week (`lib/testing/kustomKit.ts`, the
 * 05-design 11.8 roster folded by core on both tracks), for the designer's M18.8 review at 375 and
 * 1440. `?state=board` (All time, default), `board-week`, `player` / `player-week`
 * (`&name=` any roster name, default Ramzyinhović), `discord` (the result post and the Sunday post).
 * A 404 in production builds.
 */
const RANGE = 'Sunday 4 Oct to Saturday 10 Oct';

export default async function KitKustomPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; name?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state = 'board', name = 'Ramzyinhović' } = await searchParams;
  const group = ORIGINAL_GROUP;
  const playerHref = (puuid: string) => `/g/customs/p/${puuid}` as Route;
  const allTime = kitAllTimeRows();
  const week = kitWeekRows();
  const weekGames = 6;

  const body = (() => {
    if (state === 'board-week') {
      return (
        <BoardView
          board={{
            window: 'this-week',
            rows: week,
            range: RANGE,
            games: weekGames,
            everRated: true,
            notPlayed: 0,
          }}
          viewerPuuid={kitPuuid('XETA')}
          sort={DEFAULT_BOARD_SORT}
          page={1}
          path="/kit/kustom"
          playerHref={playerHref}
        />
      );
    }
    if (state === 'player' || state === 'player-week') {
      return (
        <div className="flex-1">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
            <PlayerView
              lens="public"
              player={kitPlayer(name, state === 'player-week' ? 'this-week' : 'all-time')}
              group={group}
              viewerPuuid={kitPuuid(name)}
              path="/kit/kustom"
              gameHref={(gameId) => `/g/customs/games/${gameId}` as Route}
              allGamesHref={null}
              timeZone="Africa/Cairo"
            />
          </div>
        </div>
      );
    }
    if (state === 'discord') {
      const identity = { groupName: 'Customs Night' };
      const { entries } = boardPostEntries(week, 'week', null);
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-(--gutter) py-6">
          <DiscordPreview label="Result post" payload={resultEmbed({ identity, ...kitResultInput() })} />
          <DiscordPreview
            label="Sunday post"
            payload={windowSummaryEmbed({
              identity,
              windowLabel: WINDOW_LABELS['last-week'],
              description: boardSlotLine(RANGE, weekGames),
              track: 'week',
              entries,
            })}
          />
        </div>
      );
    }
    return (
      <BoardView
        board={{
          window: 'all-time',
          rows: allTime,
          range: 'first game 8 Sep 2025',
          games: 109,
          everRated: true,
          notPlayed: 0,
        }}
        viewerPuuid={kitPuuid('XETA')}
        sort={DEFAULT_BOARD_SORT}
        page={1}
        path="/kit/kustom"
        playerHref={playerHref}
      />
    );
  })();

  return (
    <PageGroupProvider group={group}>
      <Shell group={group} isAdmin={false} account="signed-in">
        {body}
      </Shell>
    </PageGroupProvider>
  );
}
