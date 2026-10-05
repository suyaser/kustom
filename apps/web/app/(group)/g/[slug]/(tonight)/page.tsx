import type { Metadata } from 'next';
import { AiRecap } from '@/components/ai/AiRecap';
import { loadGameRecapOrNone } from '@/lib/ai/recap';
import { LEADERBOARD_WINDOW } from '@/lib/board/window';
import { loadGameBreakdownOrNone } from '@/lib/breakdown/load';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import { loadRosterLabels } from '@/lib/names/roster';
import { groupHref } from '@/lib/nav';
import { formatDayMonth, formatDayName, nightStart } from '@/lib/night';
import { shareMetadata, tonightImagePath } from '@/lib/og/meta';
import { groupPageTitle, tonightShareTitle } from '@/lib/og/titles';
import { createPublicClient } from '@/lib/publicClient';
import { TONIGHT_TITLE } from '@/lib/shellCopy';
import { getServiceClient } from '@/lib/supabase';
import {
  cachedRosterInputs,
  loadAdminNamesCachedOrNone,
  loadHostPresenceCachedOrNone,
  loadLastGameCachedOrNone,
  loadMysteryCachedOrNone,
  loadTopBoardCachedOrNone,
} from '@/lib/tonight/cached';
import { loadCalibrationOrNone } from '@/lib/tonight/calibration';
import { withHostPresence } from '@/lib/tonight/hosts';
import { labelSnapshot, lobbyPeople } from '@/lib/tonight/labels';
import { loadLiveVersionOrNone } from '@/lib/tonight/liveVersion';
import { loadTonight } from '@/lib/tonight/load';
import { loadLobbyPassword, maySeeLobbyPassword, withLobbyPassword } from '@/lib/tonight/lobbyPassword';
import { loadLobbyStartOrNone } from '@/lib/tonight/lobbyStart';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { withSelection } from '@/lib/tonight/selection';
import { loadSitOutPreviewOrNone, loadSitOutRuleOrNone } from '@/lib/tonight/sitOutPreview';
import { hasNamelessRow, tonightHeader, tonightState } from '@/lib/tonight/state';
import { withWatchers } from '@/lib/tonight/tables';
import { viewerPuuid } from '@/lib/tonight/viewer';
import { loadTableWatchersOrNone } from '@/lib/tonight/watchers';
import { loadYourNightOrNone } from '@/lib/tonight/yourNight';
import { readPitchCookie } from '@/lib/versus/pitchCookie';
import { currentViewerState } from '@/lib/viewer';
import { TonightLive } from '../../../../_tonight/TonightLive';
import { TonightView } from '../../../../_tonight/TonightView';

/**
 * A group's tonight page (M3.4; under `/g/<slug>` since M13.9; Kustom 2.0 since M14.9). The link
 * somebody pastes in WhatsApp at 21:40.
 *
 * **Server-rendered, every state, every time.** The first paint answers "is the night happening and
 * am I in it" with no spinner and no login; `TonightLive` then subscribes to this group's live signal
 * (`group_live`, M19.10) and asks for this render again (`router.refresh()`) when it moves. So everything here is the
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
  searchParams?: Promise<{
    notice?: string | string[];
    error?: string | string[];
    lobby?: string | string[];
  }>;
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
  const now = new Date();

  // **Two waves** (performance plan, phase 2). The first starts everything that does not depend on
  // tonight's state at once: the night itself (`loadTonight`, three rounds), the viewer, the roster
  // behind the same-name labels, and the slow slices from the server cache (`lib/tonight/cached.ts`).
  // The second is only what some states draw. Live lobby state and anything about the viewer are
  // read on every render; the cached slices are group facts, dropped by their writers.
  const viewerRead = currentViewerState(group.id);
  const rosterInputs = cachedRosterInputs(group.id);
  // Awaited through `loadRosterLabels`, which turns a failure into plain names; never unhandled.
  rosterInputs.catch(() => undefined);
  // The pending `create_lobby` carries the new lobby's password: members only (M14.28).
  const lobbyStartRead = viewerRead.then((viewer) =>
    maySeeLobbyPassword(viewer)
      ? loadLobbyStartOrNone(getServiceClient(), { timeZone, groupId: group.id })
      : null,
  );
  // Awaited in the second wave; never unhandled if the first wave throws before it gets there.
  lobbyStartRead.catch(() => undefined);
  // M19.10: the group's live version, read beside the night and never newer than it (`liveVersion.ts`).
  const renderStart = Date.now();
  const [anonSnapshot, viewer, top, mystery, admins, hostPresence, liveVersion] = await Promise.all([
    // M22.5: `?lobby=` picks the table when it names a live one; the viewer's table comes after.
    loadTonight(client, {
      nightStart: tonightStart(),
      timeZone,
      groupId: group.id,
      now,
      lobbyId: one(query.lobby),
    }),
    viewerRead,
    loadTopBoardCachedOrNone({
      groupId: group.id,
      window: LEADERBOARD_WINDOW,
      timeZone,
      limit: TOP_ROWS,
      now,
    }),
    hasDailyPage ? loadMysteryCachedOrNone(now, group.id, timeZone) : Promise.resolve(null),
    loadAdminNamesCachedOrNone(group.id),
    // M14.66: who hosts and whether any is up, so idle can name who to ask before a tap.
    loadHostPresenceCachedOrNone(group.id, now),
    loadLiveVersionOrNone(client, group.id, renderStart),
  ]);
  // M14.69: the lobby list and the team cards print the same same-name labels as the board,
  // computed now from the (cached) roster and tonight's people; only a newcomer costs a read.
  // M22.5: the table drawn is `?lobby=`'s, else the viewer's, else the most recently changed.
  const selected = withSelection(anonSnapshot, {
    requested: one(query.lobby),
    viewerPuuid: viewerPuuid(viewer),
  });
  const labels = await loadRosterLabels(client, group.id, lobbyPeople(selected), {
    inputs: rosterInputs,
  });
  const labelled = labelSnapshot(withHostPresence(selected, hostPresence), labels);
  const state = tonightState(labelled);
  const header = tonightHeader(state, admins);

  // What only some states draw, read only for them.
  const showsReceipt = state.kind === 'teams' || state.kind === 'in-game' || state.kind === 'result';
  const overTen =
    state.kind === 'filling' && state.lobby.status === 'open' && state.lobby.members.length > 10
      ? state.lobby.id
      : null;
  // M14.41 (gap 4): why tonight's sitters sit, while the teams are up (the rotation's own read).
  // M21.5: in game with a kickoff record, the sitters are whoever is on neither team that started.
  const sitOutLobby =
    state.kind === 'in-game' && state.game.sitters.length > 0
      ? {
          id: state.lobby.id,
          ten: new Set([...state.game.blue, ...state.game.red].map((seat) => seat.puuid)),
        }
      : state.kind === 'teams' &&
          (state.lobby.status === 'balanced' || state.lobby.status === 'in_game') &&
          state.teams.sitters.length > 0
        ? {
            id: state.lobby.id,
            ten: new Set([...state.teams.blue, ...state.teams.red].map((seat) => seat.puuid)),
          }
        : null;
  const night = new Date(labelled.nightStart);
  const showsYourNight = viewer.kind === 'linked' && (state.kind === 'idle' || state.kind === 'result');
  const [
    passworded,
    lobbyStart,
    lastGame,
    calibration,
    wouldSitOut,
    yourNight,
    sitOutRule,
    recap,
    breakdown,
    watchers,
  ] = await Promise.all([
    // The password only for a linked member of this group, read with the service role (M14.28).
    withLobbyPassword(labelled, viewer, group.id, (lobbyId, groupId) =>
      loadLobbyPassword(getServiceClient(), lobbyId, groupId),
    ),
    lobbyStartRead,
    state.kind === 'idle' ? loadLastGameCachedOrNone(group.id) : Promise.resolve(undefined),
    showsReceipt ? loadCalibrationOrNone(client, group.id) : Promise.resolve(null),
    overTen === null ? Promise.resolve(null) : loadSitOutPreviewOrNone(overTen, group.id, timeZone),
    showsYourNight && viewer.kind === 'linked'
      ? loadYourNightOrNone(client, { groupId: group.id, nightStart: night, puuid: viewer.puuid })
      : Promise.resolve(null),
    sitOutLobby === null
      ? Promise.resolve(null)
      : loadSitOutRuleOrNone(sitOutLobby.id, group.id, timeZone, sitOutLobby.ten),
    // M16.4: the finished game's AI recap (nothing for a group without Premium).
    state.kind === 'result'
      ? loadGameRecapOrNone(getServiceClient, { groupId: group.id, gameId: state.result.gameId, now })
      : Promise.resolve(null),
    // M14.58 / M14.59: the finished game's stored breakdown; a failure is null.
    state.kind === 'result' ? loadGameBreakdownOrNone(client, state.result.gameId) : Promise.resolve(null),
    // M22.5: who watches each table, only with two or more live (no request on a one-lobby night).
    loadTableWatchersOrNone(getServiceClient(), labelled, group.id, now),
  ]);
  const snapshot = withWatchers(passworded, watchers);
  const lastNight = lastGame ? nightStart(new Date(lastGame.startedAt), timeZone) : null;

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
        aiRecap={
          recap === null ? null : (
            <AiRecap
              recap={recap}
              groupId={group.id}
              // M19.17: a linked viewer's waiter asks the small recap read, not the page.
              pollGameId={
                viewer.kind === 'linked' && state.kind === 'result' ? state.result.gameId : undefined
              }
            />
          )
        }
        breakdown={breakdown}
        pitchCookie={state.kind === 'result' ? await readPitchCookie() : undefined}
      />
      <TonightLive
        groupId={group.id}
        liveVersion={liveVersion}
        lobbyLive={header.live}
        nameless={hasNamelessRow(state, snapshot.tape)}
      />
    </>
  );
}
