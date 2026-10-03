import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { gameCardModel } from '@/lib/og/cards';
import { loadGamePage } from '@/lib/og/load';
import { gameImagePath, shareMetadata } from '@/lib/og/meta';
import { createPublicClient } from '@/lib/publicClient';
import { HEAD_SEPARATOR } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import { currentViewer } from '@/lib/viewer';
import { ResultPoster } from '../../../../../_tonight/ResultPoster';
import '../../../../../tonight.css';

/**
 * One stored game, at an address that does not move on when the next lobby opens (M11.4). The
 * Discord result post's title and the night tape's rows link here.
 *
 * **M11.4's page, mounted under the group by M13.9** so that the old `/g/<gameId>` links have a
 * target to 308 to (`requirePageGroup`). M13.11 owns this page from here: the games list beside
 * it, the share card's new address and the Discord links. A game of another group under this
 * slug is a 404, never a redirect across groups.
 *
 * M11.3's poster, from the same `resultOfGame` the tonight page's result block reads, so the
 * odds, MVP and deltas are the ones the game had. Anon key, nothing written.
 */
export const dynamic = 'force-dynamic';

interface GamePageProps {
  params: Promise<{ slug: string; gameId: string }>;
}

const loadGame = cache(async (gameId: string, groupId: string) =>
  loadGamePage(createPublicClient(), gameId, nightTimeZone(), groupId),
);

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { slug, gameId } = await params;
  const group = await requirePageGroup(slug);
  const game = await loadGame(gameId, group.id);
  if (game === null) return { title: 'Kustom' };
  const card = gameCardModel(game);
  const verdict = `${card.verdict.join(' ')} ${HEAD_SEPARATOR} ${card.duration}`;
  return {
    title: `${verdict} · Kustom`,
    ...shareMetadata(gameImagePath(game.gameId), `${verdict} ${HEAD_SEPARATOR} ${card.slug}`),
  };
}

export default async function GamePage({ params }: GamePageProps) {
  const { slug, gameId } = await params;
  const group = await requirePageGroup(slug);
  const [game, viewer] = await Promise.all([loadGame(gameId, group.id), currentViewer(group.id)]);
  if (game === null) notFound();

  const note = gameCardModel(game).note;
  return (
    <div className="cn-grid">
      <main className="cn-col">
        <header className="cn-strip">
          <p className="cn-num cn-slug">
            {note === null ? game.nightLabel : `${game.nightLabel} ${HEAD_SEPARATOR} ${note}`}
          </p>
        </header>
        <ResultPoster
          result={game.result}
          explanation={game.explanation}
          viewerPuuid={viewer?.puuid ?? null}
        />
      </main>
    </div>
  );
}
