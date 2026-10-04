import type { Metadata, Route } from 'next';
import { permanentRedirect } from 'next/navigation';
import { GAMES_LABEL, GAMES_MODE_LABELS, GAMES_WINDOW_LABELS } from '@/lib/games/copy';
import { type GamesSearchParams, gamesListHref, parseGamesFilters } from '@/lib/games/filters';
import { loadGamesList } from '@/lib/games/list';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { groupHref } from '@/lib/nav';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { nightTimeZone } from '@/lib/tonight/night';
import { currentViewer } from '@/lib/viewer';
import { GamesList } from '../../../../_games/GamesList';

/**
 * `/g/<slug>/games` (M14.16, folding in M13.11's list): the group's games only, 25 a page, newest
 * first, filtered by date, mode and player in the URL, each row a link to its game page. Anon key
 * through RLS; the viewer's session only adds their own line to the rows they played.
 *
 * The 1.0 `/games` 308s here for the original group (next.config), its `?p=` / `?queue=` 308 once
 * more to this page's own spelling.
 */
export const dynamic = 'force-dynamic';

interface GamesPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<GamesSearchParams>;
}

export async function generateMetadata({ params, searchParams }: GamesPageProps): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  const { filters } = parseGamesFilters(await searchParams);
  const parts = [GAMES_WINDOW_LABELS[filters.window]];
  if (filters.mode === 'aram') parts.push(GAMES_MODE_LABELS.aram);
  return { title: groupPageTitle(group, ...parts, GAMES_LABEL) };
}

export default async function GamesPage({ params, searchParams }: GamesPageProps) {
  const group = await requirePageGroup((await params).slug);
  const base = groupHref(group, { page: 'games' }) ?? `/g/${encodeURIComponent(group.slug)}/games`;
  const { filters, legacy } = parseGamesFilters(await searchParams);
  if (legacy) permanentRedirect(gamesListHref(base, filters) as Route);

  const viewer = await currentViewer(group.id);
  const view = await loadGamesList(createPublicClient(), {
    groupId: group.id,
    filters,
    viewerPuuid: viewer?.puuid ?? null,
    timeZone: nightTimeZone(),
  });
  return <GamesList view={view} base={base} />;
}
