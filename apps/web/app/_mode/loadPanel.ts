import type { RoleValue } from '@customs/db';
import type { GroupMode } from '@customs/db/schemas';
import type { FearlessView } from '@/lib/fearless/types';
import type { PageGroup } from '@/lib/groups/pageGroup';
import { requirePageGroup } from '@/lib/groups/requirePageGroup';
import type { ModeCardView } from '@/lib/mode/card';
import { loadModePanelView } from '@/lib/mode/panelView';
import { type LaneChoice, parseLane, poolSinceLabel } from '@/lib/mode/view';
import { createPublicClient } from '@/lib/publicClient';
import { loadTonight } from '@/lib/tonight/load';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { viewerSeat } from '@/lib/tonight/screen';
import { currentViewerState } from '@/lib/viewer';

/**
 * Everything the mode panel shows, for the overlay and the direct page alike (M14.30, M15.5): the
 * group's standing mode and pool (anon key, `loadFearless`, the same read Tonight makes), what the
 * Mode card is about (`modeCardView`: the lobby's lock after Roll, else the next game, so the panel
 * and the card never disagree), the lane to open on (`?lane=`, an unknown value is `All`), and who
 * is looking: an admin gets the line pointing at the card; a viewer seated in tonight's set teams
 * gets `Your lane this game` and, in region wars, their side first.
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
}

export async function loadModePanel(
  slug: string,
  laneParam: string | string[] | undefined,
): Promise<ModePanelData> {
  const group = await requirePageGroup(slug);
  const client = createPublicClient();
  const timeZone = nightTimeZone();
  const nightStart = tonightStart();
  const [{ mode, fearless, view, lobbyStatus }, viewer] = await Promise.all([
    loadModePanelView(client, group.id, nightStart),
    currentViewerState(group.id),
  ]);
  const pooled = view.shown.id === 'fearless' || view.shown.id === 'class' || view.shown.id === 'region';
  let seat: { side: 'blue' | 'red'; role: RoleValue } | null = null;
  if (viewer.kind === 'linked' && pooled && lobbyStatus === 'balanced') {
    try {
      const snapshot = await loadTonight(client, { nightStart, timeZone, groupId: group.id });
      const live = snapshot.lobby;
      if (live !== null && live.status === 'balanced') seat = viewerSeat(live.teams, viewer.puuid);
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
    viewerLane: seat?.role ?? null,
    viewerSide: seat?.side ?? null,
    isAdmin: viewer.kind === 'linked' && viewer.isAdmin,
    poolSince: poolSinceLabel(fearless.resetAt, timeZone),
  };
}
