import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AiRecap } from '@/components/ai/AiRecap';
import { AI_SCOUTING_LABEL, AI_SCOUTING_TAP } from '@/lib/ai/recapCopy';
import { loadPlayerScoutingOrNone } from '@/lib/ai/scoutingRead';
import { allGamesHref, gameHrefFor, playerHrefFor, playerPath } from '@/lib/board/hrefs';
import { loadPlayerBoard } from '@/lib/board/load';
import { PLAYER_WINDOW, windowOrDefault } from '@/lib/board/window';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import type { WindowKind } from '@/lib/night';
import { loadPlayerHead } from '@/lib/og/heads';
import { playerImagePath, shareMetadata } from '@/lib/og/meta';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { loadPlayerStats } from '@/lib/stats/load';
import { getServiceClient } from '@/lib/supabase';
import { renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import { loadYouVersus, type YouVersusRow, youVsOne } from '@/lib/versus/you';
import { currentViewer } from '@/lib/viewer';
import { PlayerStats } from '../../../../../_board/PlayerStats';
import { PlayerView } from '../../../../../_board/PlayerView';
import { YouVsThemCard } from '../../../../../_board/YouVersus';

/**
 * `/g/<slug>/p/<puuid>`, one player in one group (M14.15; M13.10's move). The public lens, for
 * everyone, your own page included (the Board tab is current; `/g/<slug>/you` is the self lens).
 *
 * **Keyed by PUUID**, read with the anon key, the group's games and ratings only: a person's page in
 * group A says nothing about group B, and a PUUID with nothing in this group is this group's 404
 * even if they play in another. Default window `All time`; an unknown `?window=` falls back to it.
 *
 * `/p/<puuid>` 308s here for the original group (`next.config.ts`).
 */
export const dynamic = 'force-dynamic';

interface PlayerPageProps {
  params: Promise<{ slug: string; puuid: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
}

const loadPlayer = cache(async (puuid: string, groupId: string, window: WindowKind) =>
  loadPlayerBoard(createPublicClient(), puuid, { window, groupId, timeZone: nightTimeZone() }),
);

/** The records, `lib/stats`' own fold over the same window and group (M5.20). */
const loadSections = cache(async (puuid: string, groupId: string, window: WindowKind) =>
  loadPlayerStats(createPublicClient(), puuid, { window, groupId, timeZone: nightTimeZone() }),
);

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { slug, puuid } = await params;
  const group = await requirePageGroup(slug);
  // One small read (performance plan, phase 1): every prefetch of this page runs this, never the
  // page's loader.
  const player = await loadPlayerHead(decode(puuid));
  if (player === null) return { title: groupPageTitle(group) };
  const title = groupPageTitle(group, renderWebName(player.name));
  // The card is always the all-time numbers (M11.4), whatever window this page was opened on.
  return { title, ...shareMetadata(playerImagePath(group.slug, player.puuid), title) };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const [{ slug, puuid: raw }, query] = await Promise.all([params, searchParams]);
  const group = await requirePageGroup(slug);
  const puuid = decode(raw);
  const window = windowOrDefault(query.window, PLAYER_WINDOW);

  const [player, stats, viewer, scouting] = await Promise.all([
    loadPlayer(puuid, group.id, window),
    loadSections(puuid, group.id, window),
    currentViewer(group.id),
    // M16.6: the stored scouting report, read only (a page view never writes one); nothing for a
    // group without Premium.
    loadPlayerScoutingOrNone(getServiceClient, { groupId: group.id, puuid, timeZone: nightTimeZone() }),
  ]);
  if (player === null) notFound();
  // You vs them (M14.35): a linked viewer on somebody else's page. A failed read is no card.
  const mine =
    viewer !== null && viewer.puuid !== player.puuid ? await youVersusOrNull(viewer.puuid, group.id) : null;

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-(--gutter) py-6 *:max-w-3xl lg:py-8">
        <PlayerView
          lens="public"
          player={player}
          group={group}
          viewerPuuid={viewer?.puuid ?? null}
          scouting={
            scouting === null ? undefined : (
              <AiRecap
                recap={{ kind: 'line', lineId: scouting.lineId, text: scouting.text }}
                groupId={group.id}
                label={AI_SCOUTING_LABEL}
                tap={AI_SCOUTING_TAP}
                footnote={scouting.written}
                // Admins and the owner only; `POST /api/admin/ai/hide` checks again.
                canHide={viewer?.isAdmin === true}
                hideRedirect={playerPath(group, player.puuid)}
              />
            )
          }
          versus={
            mine === null ? null : (
              <YouVsThemCard name={renderWebName(player.name)} row={youVsOne(mine, player.puuid)} />
            )
          }
          stats={<PlayerStats stats={stats} playerHref={playerHrefFor(group, window)} />}
          path={playerPath(group, player.puuid)}
          gameHref={gameHrefFor(group)}
          allGamesHref={allGamesHref(group, player.puuid)}
          timeZone={nightTimeZone()}
        />
      </div>
    </div>
  );
}

/** The viewer's You-vs-them rows in this group, or `null` (logged) when the read fails. */
async function youVersusOrNull(viewerPuuid: string, groupId: string): Promise<YouVersusRow[] | null> {
  try {
    return await loadYouVersus(createPublicClient(), { groupId, viewerPuuid, timeZone: nightTimeZone() });
  } catch (error) {
    console.error('player: reading you vs them failed', error);
    return null;
  }
}

/** The route segment arrives percent-encoded; a malformed one is nobody (the 404). */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}
