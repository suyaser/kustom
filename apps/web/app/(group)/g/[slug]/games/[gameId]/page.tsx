import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AiRecap } from '@/components/ai/AiRecap';
import { loadGameRecapOrNone } from '@/lib/ai/recap';
import { welcomeHref } from '@/lib/board/hrefs';
import { loadGameBreakdownOrNone } from '@/lib/breakdown/load';
import { resultForWinner } from '@/lib/games/copy';
import { loadGameDetail } from '@/lib/games/detail';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { claimableSeats } from '@/lib/me/claimable';
import { groupHref } from '@/lib/nav';
import { loadGameHead } from '@/lib/og/heads';
import { gameImagePath, shareMetadata } from '@/lib/og/meta';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { getServiceClient } from '@/lib/supabase';
import { HEAD_SEPARATOR, renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { viewerIsAdmin } from '@/lib/tonight/viewer';
import { currentViewerState } from '@/lib/viewer';
import { VersusPitch } from '../../../../../_board/VersusPitch';
import { GameDetail } from '../../../../../_games/GameDetail';
import { ThatsMe } from '../../../../../_games/ThatsMe';

/**
 * One stored game (M11.4's address, rebuilt by M14.16): the result, the full receipt and both
 * scoreboards. The Discord result post's title (M14.10), the night tape and every Games row link
 * here. A game of another group under this slug is a 404, never a redirect across groups
 * (M13.11). Anon key, nothing written.
 */
export const dynamic = 'force-dynamic';

interface GamePageProps {
  params: Promise<{ slug: string; gameId: string }>;
}

const loadGame = cache(async (gameId: string, groupId: string, viewerPuuid: string | null) =>
  loadGameDetail(createPublicClient(), { gameId, groupId, viewerPuuid, timeZone: nightTimeZone() }),
);

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { slug, gameId } = await params;
  const group = await requirePageGroup(slug);
  // One small read (performance plan, phase 1): every prefetch of this page runs this, never the
  // page's loader (and never the session).
  const game = await loadGameHead(gameId, group.id, nightTimeZone());
  if (game === null) return { title: groupPageTitle(group) };
  const verdict = `${resultForWinner(game.winningSide)} ${HEAD_SEPARATOR} ${game.durationLabel}`;
  return {
    title: groupPageTitle(group, verdict),
    ...shareMetadata(
      gameImagePath(group.slug, game.gameId),
      `${verdict} ${HEAD_SEPARATOR} ${game.nightLabel}`,
    ),
  };
}

export default async function GamePage({ params }: GamePageProps) {
  const { slug, gameId } = await params;
  const group = await requirePageGroup(slug);
  const viewer = await currentViewerState(group.id);
  const game = await loadGame(gameId, group.id, viewer.kind === 'linked' ? viewer.puuid : null);
  if (game === null) notFound();
  // M16.4: the AI recap, if any (nothing for a group without Premium); `Hide` for admins only.
  // M14.58 / M14.59: the fold's stored breakdown, beside it (a failed read is plain numbers).
  const [recap, breakdown] = await Promise.all([
    loadGameRecapOrNone(getServiceClient, {
      groupId: group.id,
      gameId: game.gameId,
      now: new Date(),
    }),
    game.aram ? Promise.resolve(null) : loadGameBreakdownOrNone(createPublicClient(), game.gameId),
  ]);

  const here =
    groupHref(group, { page: 'game', gameId: game.gameId }) ??
    `/g/${encodeURIComponent(group.slug)}/games/${game.gameId}`;
  const seats = [...game.blue.seats, ...game.red.seats];
  // M14.34: a signed-in visitor with no player row may say `That's me` for a seat of this game.
  const claim =
    viewer.kind === 'unlinked'
      ? claimableSeats(
          viewer.claimable,
          seats.map((seat) => seat.puuid),
        ).map((puuid) => ({
          puuid,
          name: renderWebName(seats.find((seat) => seat.puuid === puuid)?.name ?? null),
        }))
      : [];

  return (
    <GameDetail
      game={game}
      backHref={groupHref(group, { page: 'games' }) ?? `/g/${encodeURIComponent(group.slug)}/games`}
      howHref="/how"
      group={group}
      breakdown={breakdown}
      recap={
        recap === null ? null : (
          <AiRecap recap={recap} groupId={group.id} canHide={viewerIsAdmin(viewer)} hideRedirect={here} />
        )
      }
      afterScoreboard={
        claim.length > 0 ? (
          <ThatsMe seats={claim} groupId={group.id} welcome={welcomeHref(group)} />
        ) : (
          // M14.35: the You-vs-them line under a finished game, once a night per browser.
          <VersusPitch
            viewer={viewer.kind === 'linked' ? 'linked' : 'not-linked'}
            nightKey={tonightStart().toISOString()}
            here={here}
            you={groupHref(group, { page: 'you' }) ?? (`/g/${encodeURIComponent(group.slug)}/you` as Route)}
          />
        )
      }
    />
  );
}
