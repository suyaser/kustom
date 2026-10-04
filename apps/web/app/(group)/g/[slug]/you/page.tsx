import type { Metadata, Route } from 'next';
import { AiRecap } from '@/components/ai/AiRecap';
import { AiLinesAboutYou } from '@/components/premium/AiLinesAboutYou';
import { YouPage } from '@/components/shell/YouPage';
import { isUnlinkedCreator } from '@/lib/admin/groupAdminPage';
import { AI_SCOUTING_LABEL, AI_SCOUTING_TAP } from '@/lib/ai/recapCopy';
import { loadPlayerScoutingOrNone } from '@/lib/ai/scoutingRead';
import { loadWriteAboutMe } from '@/lib/ai/switches';
import { tonightDelta } from '@/lib/board/explain';
import { allGamesHref, gameHrefFor, playerPath } from '@/lib/board/hrefs';
import { loadPlayerBoard } from '@/lib/board/load';
import type { PlayerBoardView } from '@/lib/board/types';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { currentDiscordName } from '@/lib/me/discordName';
import { groupHome, groupHref, YOU_TAB_LABEL } from '@/lib/nav';
import { groupPageTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { loadYourNightOrNone } from '@/lib/tonight/yourNight';
import { loadYouVersus, pickTwoHref } from '@/lib/versus/you';
import { currentViewerState } from '@/lib/viewer';
import { PlayerView } from '../../../../_board/PlayerView';
import { YouVsEveryone } from '../../../../_board/YouVersus';
import { yourNightFirstLine } from '../../../../_tonight/YourNight';

export const dynamic = 'force-dynamic';

interface YouRouteProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ welcome?: string | string[] }>;
}

/** `You · <Group> · Kustom` (M14.42: every group page's title names the group). */
export async function generateMetadata({ params }: Pick<YouRouteProps, 'params'>): Promise<Metadata> {
  return { title: groupPageTitle(await requirePageGroup((await params).slug), YOU_TAB_LABEL) };
}

/**
 * `/g/<slug>/you`, the You tab (M14.7b; redesign/nav/proposal.md option A). Signed in and linked: the
 * Admin card first for admins, then **your player page in the self lens** (M14.15: the header with
 * three tiles, the trend, the games), the way to your public page, Daily, and the account. Signed in
 * with no player row: a line saying so, and the account. Signed out: the sign-in pitch.
 *
 * Every number comes from `loadPlayerBoard` **in this group** (the same loader and the same call
 * `/g/<slug>/p/<you>` makes on `All time`), so the two can never disagree and group B's numbers never
 * show under "You in A". M14.33 and M14.35 fill out the rest.
 */
export default async function YouRoute({ params, searchParams }: YouRouteProps) {
  const group = await requirePageGroup((await params).slug);
  // `?welcome=1` only means something to a linked viewer (M14.33): everyone else sees their state.
  const welcome = (await searchParams)?.welcome === '1';
  const viewer = await currentViewerState(group.id);
  const here = groupHref(group, { page: 'you' }) ?? '/';
  const daily = groupHref(group, { page: 'mystery' });

  if (viewer.kind === 'anonymous') {
    return <YouPage kind="anonymous" group={group} here={here} daily={daily} />;
  }
  if (viewer.kind === 'unlinked') {
    // M14.51: the group's creator before they link keeps a way back to the admin home.
    const admin = (await isUnlinkedCreator(group)) ? groupHref(group, { page: 'admin' }) : null;
    return (
      <YouPage
        kind="unlinked"
        group={group}
        here={here}
        daily={daily}
        admin={admin}
        discordName={await currentDiscordName()}
      />
    );
  }

  const [player, versus, night, aiLines, scouting] = await Promise.all([
    loadSelf(viewer.puuid, group),
    loadYouVersus(createPublicClient(), {
      groupId: group.id,
      viewerPuuid: viewer.puuid,
      timeZone: nightTimeZone(),
    }).catch((error: unknown) => {
      console.error('you: reading you vs them failed', error);
      return null;
    }),
    // M14.36: Your night's first line, the same loader as Tonight's card.
    loadYourNightOrNone(createPublicClient(), {
      groupId: group.id,
      nightStart: tonightStart(),
      puuid: viewer.puuid,
    }),
    // M16.3b: `AI lines about you`, for a member of a Premium group with AI lines on only.
    viewer.isMember === true
      ? loadWriteAboutMe(getServiceClient(), { groupId: group.id, puuid: viewer.puuid })
      : null,
    // M16.6 (lead ruling, design round 1): your own scouting report, read only, same rules as
    // your player page; no Hide here.
    loadPlayerScoutingOrNone(getServiceClient, {
      groupId: group.id,
      puuid: viewer.puuid,
      timeZone: nightTimeZone(),
    }),
  ]);
  return (
    <YouPage
      kind="linked"
      group={group}
      here={here}
      discordName={await currentDiscordName()}
      daily={daily}
      admin={viewer.isAdmin ? groupHref(group, { page: 'admin' }) : null}
      owner={viewer.isOwner === true}
      playerPage={groupHref(group, { page: 'player', puuid: viewer.puuid })}
      aiLines={
        aiLines === null ? null : (
          <AiLinesAboutYou groupId={group.id} groupName={group.name} writeAboutMe={aiLines.writeAboutMe} />
        )
      }
      versus={
        versus === null ? null : (
          <YouVsEveryone rows={versus} pickTwo={(them) => pickTwoHref(group, viewer.puuid, them) as Route} />
        )
      }
      self={
        player === null ? null : (
          <PlayerView
            lens="self"
            player={player}
            group={group}
            viewerPuuid={viewer.puuid}
            tonightDelta={tonightDelta(player, tonightStart())}
            path={playerPath(group, player.puuid)}
            gameHref={gameHrefFor(group)}
            allGamesHref={allGamesHref(group, player.puuid)}
            timeZone={nightTimeZone()}
            welcome={welcome ? { home: groupHome(group) } : null}
            nightLine={night === null ? null : yourNightFirstLine(night)}
            scouting={
              scouting === null ? undefined : (
                <AiRecap
                  recap={{ kind: 'line', lineId: scouting.lineId, text: scouting.text }}
                  groupId={group.id}
                  label={AI_SCOUTING_LABEL}
                  tap={AI_SCOUTING_TAP}
                  footnote={scouting.written}
                />
              )
            }
          />
        )
      }
    />
  );
}

/** The viewer's `All time` page in this group, or `null` (logged) when it cannot be read. */
async function loadSelf(puuid: string, group: PageGroup): Promise<PlayerBoardView | null> {
  try {
    return await loadPlayerBoard(createPublicClient(), puuid, {
      window: 'all-time',
      groupId: group.id,
      timeZone: nightTimeZone(),
    });
  } catch (error) {
    // The self lens is the page's body, but a failed read still shows the account and the links.
    console.error('you: reading the player page failed', error);
    return null;
  }
}
