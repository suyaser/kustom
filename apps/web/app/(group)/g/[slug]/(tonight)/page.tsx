import type { Metadata } from 'next';
import { AiRecap } from '@/components/ai/AiRecap';
import { loadGameRecapOrNone } from '@/lib/ai/recap';
import { loadTopBoardOrNone } from '@/lib/board/load';
import { LEADERBOARD_WINDOW } from '@/lib/board/window';
import { loadGameBreakdownOrNone } from '@/lib/breakdown/load';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { loadMysteryOrNone } from '@/lib/mystery/load';
import { loadRosterLabels } from '@/lib/names/roster';
import { groupHref } from '@/lib/nav';
import { formatDayMonth, formatDayName, nightStart } from '@/lib/night';
import { shareMetadata, tonightImagePath } from '@/lib/og/meta';
import { groupPageTitle, tonightShareTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { TONIGHT_TITLE } from '@/lib/shellCopy';
import { getServiceClient } from '@/lib/supabase';
import { loadAdminNamesOrNone } from '@/lib/tonight/admins';
import { loadCalibrationOrNone } from '@/lib/tonight/calibration';
import { loadHostPresenceOrNone, withHostPresence } from '@/lib/tonight/hosts';
import { labelSnapshot, lobbyPeople } from '@/lib/tonight/labels';
import { loadLastGameOrNone } from '@/lib/tonight/lastGame';
import { loadTonight } from '@/lib/tonight/load';
import { loadLobbyPassword, maySeeLobbyPassword, withLobbyPassword } from '@/lib/tonight/lobbyPassword';
import { loadLobbyStartOrNone } from '@/lib/tonight/lobbyStart';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { loadSitOutPreviewOrNone, loadSitOutRuleOrNone } from '@/lib/tonight/sitOutPreview';
import { hasNamelessRow, tonightHeader, tonightState } from '@/lib/tonight/state';
import { loadYourNightOrNone } from '@/lib/tonight/yourNight';
import { currentViewerState } from '@/lib/viewer';
import { TonightLive } from '../../../../_tonight/TonightLive';
import { TonightView } from '../../../../_tonight/TonightView';

/**
 * A group's tonight page (M3.4; under `/g/<slug>` since M13.9; Kustom 2.0 since M14.9). The link
 * somebody pastes in WhatsApp at 21:40.
 *
 * **Server-rendered, every state, every time.** The first paint answers "is the night happening and
 * am I in it" with no spinner and no login; `TonightLive` then subscribes to this group's Realtime
 * changes and asks for this render again (`router.refresh()`) on each one. So everything here is the
 * one definition of the page, first paint and live update alike, and the receipt, poster, tape and
 * rail are server components that never ship to the phone.
 *
 * **Everything here is the group's** (M13.9). Reads go through the **anon key** and RLS, except
 * the server-only facts: who the viewer is (the session), tonight's lobby password and `Start a
 * lobby` press (`lobbies.lobby_password` and `companion_commands`, service role, linked members of
 * this group only, M14.28), who the rotation would sit before a roll past ten, and why the
 * sitters sit once the teams are up (M14.41) (the balancer's own read, service role, read only). The controls each draw post
 * to routes that check the session and the group again.
 */
export const dynamic = 'force-dynamic';

interface TonightPageProps {
  params: Promise<{ slug: string }>;
  /** A no-JS mode or reset post comes back with `?notice=` / `?error=` (M14.30). */
  searchParams?: Promise<{ notice?: string | string[]; error?: string | string[] }>;
}

function one(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === undefined || raw.trim() === '' ? null : raw.slice(0, 200);
}

/**
 * The WhatsApp link's picture (M11.4): the group's strip as it was when the unfurl bot asked. The
 * tab reads `Tonight · <Group> · Kustom` and the preview `<Group> tonight · Kustom` (M14.42).
 */
export async function generateMetadata({ params }: TonightPageProps): Promise<Metadata> {
  const group = await requirePageGroup((await params).slug);
  const share = tonightShareTitle(group);
  return {
    title: groupPageTitle(group, TONIGHT_TITLE),
    ...shareMetadata(tonightImagePath(group.slug), share, { title: share }),
  };
}

/** This week's top five: Tonight's idle stack and the desktop rail. */
const TOP_ROWS = 5;

export default async function TonightPage({ params, searchParams }: TonightPageProps) {
  const group = await requirePageGroup((await params).slug);
  const query = (await searchParams) ?? {};
  const client = createPublicClient();
  const timeZone = nightTimeZone();
  const hasDailyPage = groupHref(group, { page: 'mystery' }) !== null;

  const [anonSnapshot, viewer, top, mystery, admins, hostPresence] = await Promise.all([
    loadTonight(client, { nightStart: tonightStart(), timeZone, groupId: group.id }),
    currentViewerState(group.id),
    loadTopBoardOrNone(client, {
      limit: TOP_ROWS,
      window: LEADERBOARD_WINDOW,
      timeZone,
      groupId: group.id,
    }),
    hasDailyPage ? loadMysteryOrNone(new Date(), group.id) : Promise.resolve(null),
    loadAdminNamesOrNone(group.id),
    // M14.66: who hosts and whether any is up, so idle can name who to ask before a tap.
    loadHostPresenceOrNone(group.id),
  ]);
  // The password only for a linked member of this group, read with the service role (M14.28).
  // M14.69: the lobby list and the team cards print the same same-name labels as the board.
  const labels = await loadRosterLabels(client, group.id, lobbyPeople(anonSnapshot));
  const snapshot = await withLobbyPassword(
    labelSnapshot(withHostPresence(anonSnapshot, hostPresence), labels),
    viewer,
    group.id,
    (lobbyId, groupId) => loadLobbyPassword(getServiceClient(), lobbyId, groupId),
  );
  const state = tonightState(snapshot);
  const header = tonightHeader(state, admins);

  // What only some states draw, read only for them.
  const showsReceipt = state.kind === 'teams' || state.kind === 'result';
  const overTen =
    state.kind === 'filling' && state.lobby.status === 'open' && state.lobby.members.length > 10
      ? state.lobby.id
      : null;
  // M14.41 (gap 4): why tonight's sitters sit, while the teams are up (the rotation's own read).
  const sitOutLobby =
    state.kind === 'teams' &&
    (state.lobby.status === 'balanced' || state.lobby.status === 'in_game') &&
    state.teams.sitters.length > 0
      ? {
          id: state.lobby.id,
          ten: new Set([...state.teams.blue, ...state.teams.red].map((seat) => seat.puuid)),
        }
      : null;
  // M16.4: the finished game's AI recap, read beside the rest (nothing for a group without Premium).
  const recapRead =
    state.kind === 'result'
      ? loadGameRecapOrNone(getServiceClient, {
          groupId: group.id,
          gameId: state.result.gameId,
          now: new Date(),
        })
      : Promise.resolve(null);
  // M14.58 / M14.59: the finished game's stored breakdown, read beside the rest; a failure is null.
  const breakdownRead =
    state.kind === 'result' ? loadGameBreakdownOrNone(client, state.result.gameId) : Promise.resolve(null);
  const night = new Date(snapshot.nightStart);
  const showsYourNight = viewer.kind === 'linked' && (state.kind === 'idle' || state.kind === 'result');
  const [lobbyStart, lastGame, calibration, wouldSitOut, yourNight, sitOutRule] = await Promise.all([
    // The pending `create_lobby` carries the new lobby's password: members only (M14.28).
    maySeeLobbyPassword(viewer)
      ? loadLobbyStartOrNone(getServiceClient(), { timeZone, groupId: group.id })
      : Promise.resolve(null),
    state.kind === 'idle' ? loadLastGameOrNone(client, group.id) : Promise.resolve(undefined),
    showsReceipt ? loadCalibrationOrNone(client, group.id) : Promise.resolve(null),
    overTen === null ? Promise.resolve(null) : loadSitOutPreviewOrNone(overTen, group.id, timeZone),
    showsYourNight && viewer.kind === 'linked'
      ? loadYourNightOrNone(client, { groupId: group.id, nightStart: night, puuid: viewer.puuid })
      : Promise.resolve(null),
    sitOutLobby === null
      ? Promise.resolve(null)
      : loadSitOutRuleOrNone(sitOutLobby.id, group.id, timeZone, sitOutLobby.ten),
  ]);
  const [recap, breakdown] = await Promise.all([recapRead, breakdownRead]);
  const lastNight = lastGame ? nightStart(new Date(lastGame.startedAt), timeZone) : null;
  const startPending = lobbyStart?.status === 'pending' || lobbyStart?.status === 'sent';

  return (
    <>
      <TonightView
        snapshot={snapshot}
        viewer={viewer}
        group={group}
        topPlayers={top.rows}
        topFallback={top.fallback}
        lobbyStart={lobbyStart}
        mystery={mystery}
        admins={admins}
        lastGame={lastGame}
        lastGameDate={
          lastNight === null
            ? undefined
            : `${formatDayName(lastNight, timeZone)} ${formatDayMonth(lastNight, timeZone)}`
        }
        calibration={calibration}
        wouldSitOut={wouldSitOut}
        sitOutRule={sitOutRule}
        renderedAt={Date.now()}
        modeNotice={{ notice: one(query.notice), error: one(query.error) }}
        yourNight={yourNight}
        aiRecap={recap === null ? null : <AiRecap recap={recap} groupId={group.id} />}
        breakdown={breakdown}
      />
      <TonightLive
        groupId={group.id}
        lobbyLive={header.live}
        nameless={hasNamelessRow(state, snapshot.tape)}
        startPending={startPending}
      />
    </>
  );
}
