import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import type { FearlessView } from '@/lib/fearless/types';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import type { ModeCardView } from '@/lib/mode/card';
import { loadModePanelView } from '@/lib/mode/panelView';
import { type LaneChoice, parseLane, poolSinceLabel } from '@/lib/mode/view';
import { createPublicClient } from '@/lib/publicClient';
import { viewerKickoffSeat } from '@/lib/tonight/kickoff';
import { loadTonight } from '@/lib/tonight/load';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { viewerRegionSide, viewerSeat } from '@/lib/tonight/screen';
import { currentViewerState } from '@/lib/viewer';

/**
 * Everything the mode panel shows, for the overlay and the direct page alike (M14.30, M15.5): the
 * group's standing mode and pool (anon key, `loadFearless`, the same read Tonight makes), what the
 * Mode card is about (`modeCardView`: the lobby's lock after Roll, else the next game, so the panel
 * and the card never disagree), the lane to open on (`?lane=`, an unknown value is `All`), and who
 * is looking: an admin gets the line pointing at the card; a viewer seated in tonight's set teams
 * gets `Your lane this game` and, in region wars, their side first: the side the client has them on
 * while balanced (M21.9), the kickoff side in game.
 */
export interface ModePanelData {
  group: PageGroup;
  mode: GroupMode;
  fearless: FearlessView;
  view: ModeCardView;
  lane: LaneChoice;
  viewerLane: RoleValue | null;
  viewerSide: 'blue' | 'red' | null;
  isAdmin: boolean;
  poolSince: string | null;
  /** M22.6: live lobbies (14.5: `Both lobbies add to this list.` with 2+). */
  liveTables: number;
}

export async function loadModePanel(
  slug: string,
  laneParam: string | string[] | undefined,
  lobbyParam?: string | string[] | undefined,
): Promise<ModePanelData> {
  const group = await requirePageGroup(slug);
  const client = createPublicClient();
  const timeZone = nightTimeZone();
  const nightStart = tonightStart();
  const lobbyId = (Array.isArray(lobbyParam) ? lobbyParam[0] : lobbyParam)?.slice(0, 200) ?? null;
  const [{ mode, fearless, view, lobbyStatus, liveTables }, viewer] = await Promise.all([
    loadModePanelView(client, group.id, nightStart, lobbyId),
    currentViewerState(group.id),
  ]);
  const pooled = view.shown.id === 'fearless' || view.shown.id === 'class' || view.shown.id === 'region';
  let viewerLane: RoleValue | null = null;
  let viewerSide: 'blue' | 'red' | null = null;
  const seatRead = lobbyStatus === 'balanced' || (lobbyStatus === 'in_game' && view.shown.id === 'region');
  if (viewer.kind === 'linked' && pooled && seatRead) {
    try {
      const snapshot = await loadTonight(client, { nightStart, timeZone, groupId: group.id, lobbyId });
      const live = snapshot.lobby;
      if (live !== null && live.status === 'balanced') {
        // The split's lane; the region side is where the client has them (M21.9).
        viewerLane = viewerSeat(live.teams, viewer.puuid)?.role ?? null;
        viewerSide = viewerRegionSide(live.teams, viewer.puuid);
      } else if (live !== null && live.status === 'in_game' && live.kickoff != null) {
        // In game, region wars only: the side they started on (M21.5's kickoff teams), no lane line.
        viewerSide = viewerKickoffSeat(live.kickoff, viewer.puuid)?.side ?? null;
      }
    } catch (error) {
      console.error('mode panel: reading tonight for the viewer lane failed', error);
    }
  }
  return {
    group,
    mode,
    fearless,
    view,
    lane: pooled ? parseLane(laneParam) : 'all',
    viewerLane,
    viewerSide,
    isAdmin: viewer.kind === 'linked' && viewer.isAdmin,
    poolSince: poolSinceLabel(fearless.resetAt, timeZone),
    liveTables,
  };
}
