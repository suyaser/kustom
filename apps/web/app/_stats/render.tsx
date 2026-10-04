import type { Metadata } from 'next';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { windowHref as boardWindowHref } from '@/lib/board/window';
import { GAMES_MODE_LABELS } from '@/lib/games/copy';
import { gamesListHref } from '@/lib/games/filters';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { groupBase, groupHref } from '@/lib/nav';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { SEGMENT_LABELS, STATS_LABEL, type StatsSegment } from '@/lib/stats/copy';
import { loadFunFacts, loadRecordsSegment, loadVersusSegment } from '@/lib/stats/load';
import { groupHasRoasts } from '@/lib/stats/roasts';
import {
  modeHref,
  parseStatsParams,
  type StatsSearchParams,
  type StatsUrlState,
  segmentHref,
  segmentPath,
  showAllHref,
  showFewerHref,
  windowHref,
} from '@/lib/stats/segment';
import { nightTimeZone } from '@/lib/tonight/night';
import { ChampionsSegment } from './ChampionsSegment';
import type { StatsLinks } from './parts';
import { RecordsSegment } from './RecordsSegment';
import { StatsFrame } from './StatsFrame';
import { VersusSegment } from './VersusSegment';

/**
 * The three Stats routes (M14.17) share this: resolve the group, parse the URL, read **only this
 * segment's data, only this group's games**, and draw it in the frame. Records reads `/stats`' fold
 * and `/fun`'s records in one read; Champions only `/fun`'s; 1v1 `/1v1`'s plus the duos block.
 */

export interface StatsRouteProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<StatsSearchParams>;
}

export async function statsMetadata(segment: StatsSegment, props: StatsRouteProps): Promise<Metadata> {
  const group = await requirePageGroup((await props.params).slug);
  const state = parseStatsParams(segment, await props.searchParams);
  const parts = [WINDOW_LABELS[state.window]];
  if (state.mode === 'aram') parts.push(GAMES_MODE_LABELS.aram);
  return { title: groupPageTitle(group, ...parts, SEGMENT_LABELS[segment], STATS_LABEL) };
}

function statsLinks(group: PageGroup, base: string, state: StatsUrlState): StatsLinks {
  const gamesBase = groupHref(group, { page: 'games' }) ?? `${groupBase(group)}/games`;
  return {
    // The window follows you onto the player page (M14.42, scene-walk gap 13).
    player: (puuid) => {
      const href = groupHref(group, { page: 'player', puuid });
      return href === null ? null : boardWindowHref(href, state.window);
    },
    game: (gameId) =>
      groupHref(group, { page: 'game', gameId }) ?? `${gamesBase}/${encodeURIComponent(gameId)}`,
    playerGames: (puuid) =>
      gamesListHref(gamesBase, {
        window: 'all-time',
        mode: state.segment === 'versus' ? 'sr' : state.mode,
        player: puuid,
        page: 1,
      }),
    showAll: (listId) => showAllHref(base, state, listId),
    showFewer: (listId) => showFewerHref(base, state, listId),
    expanded: state.all,
    roasts: groupHasRoasts(group),
  };
}

export async function renderStatsSegment(segment: StatsSegment, props: StatsRouteProps) {
  const group = await requirePageGroup((await props.params).slug);
  const base = groupHref(group, { page: 'stats' }) ?? `${groupBase(group)}/stats`;
  const state = parseStatsParams(segment, await props.searchParams);
  const links = statsLinks(group, base, state);
  const client = createPublicClient();
  const options = { window: state.window, timeZone: nightTimeZone(), groupId: group.id };
  const frame = {
    segment,
    segmentHref: (target: StatsSegment) => segmentHref(base, state, target),
    window: state.window,
    windowHref: (window: Parameters<typeof windowHref>[2]) => windowHref(base, state, window),
  };
  const mode = { selected: state.mode, href: (next: typeof state.mode) => modeHref(base, state, next) };

  if (segment === 'records') {
    const { stats, fun } = await loadRecordsSegment(client, { ...options, queue: state.mode });
    return (
      <StatsFrame
        {...frame}
        mode={mode}
        range={fun.range ?? (state.mode === 'sr' ? stats.range : null)}
        games={fun.games}
        capped={fun.capped}
        cap={fun.cap}
        hint={state.mode === 'sr' && stats.awards?.kind === 'running' ? stats.awards.line : null}
        columns
      >
        <RecordsSegment stats={stats} fun={fun} links={links} />
      </StatsFrame>
    );
  }

  if (segment === 'champions') {
    const fun = await loadFunFacts(client, { ...options, queue: state.mode });
    return (
      <StatsFrame
        {...frame}
        mode={mode}
        range={fun.range}
        games={fun.games}
        capped={fun.capped}
        cap={fun.cap}
      >
        <ChampionsSegment fun={fun} links={links} />
      </StatsFrame>
    );
  }

  const { versus, stats, fun } = await loadVersusSegment(client, {
    ...options,
    ...(state.a === undefined ? {} : { leftPuuid: state.a }),
    ...(state.b === undefined ? {} : { rightPuuid: state.b }),
  });
  return (
    <StatsFrame {...frame} range={versus.range} games={versus.games} capped={versus.capped} cap={versus.cap}>
      <VersusSegment
        versus={versus}
        stats={stats}
        fun={fun}
        links={links}
        action={segmentPath(base, 'versus')}
      />
    </StatsFrame>
  );
}
