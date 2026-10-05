import type { ModeLock } from '@customs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import { modeCardView } from '@/lib/mode/card';
import { championTable } from '@/lib/mode/champions';
import {
  lobbyView,
  seatedOnTheirSides,
  snapshot,
  workedKickoff,
  workedMembers,
  workedTeams,
} from '@/lib/testing/tonightFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import type { LobbyView, TonightSnapshot } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';

/**
 * M21.9: the mode panel's `viewerSide` (the region pool that goes first) is where the client has
 * the viewer while the lobby is balanced, else the split's side; in game it is the kickoff side.
 * The lane stays the split's. The page group, the viewer and the two reads are stubbed.
 */

const THEO = workedPuuid('Theo');
const REGION = { id: 'region', blue: 'ionia', red: 'noxus' } as const;

const state = vi.hoisted(() => ({
  viewer: { kind: 'anonymous' } as ViewerState,
  lobbyStatus: null as string | null,
  shown: { id: 'region', blue: 'ionia', red: 'noxus' } as { id: string; blue?: string; red?: string },
  snapshot: null as unknown,
}));

vi.mock('@/lib/groups/requirePageGroup', () => ({ requirePageGroup: async () => ORIGINAL_GROUP }));
vi.mock('@/lib/publicClient', () => ({ createPublicClient: () => ({}) }));
vi.mock('@/lib/viewer', () => ({ currentViewerState: async () => state.viewer }));
vi.mock('@/lib/tonight/load', () => ({ loadTonight: async () => state.snapshot }));
vi.mock('@/lib/mode/panelView', () => ({
  loadModePanelView: async () => {
    const lock = { standing: 'fearless', mode: state.shown, rated: false } as ModeLock;
    return {
      mode: 'fearless',
      fearless: { champions: [], resetAt: null, games: 0 },
      view: modeCardView({
        row: { standing: 'fearless', pending: null, rated: null },
        lobbyStatus: state.lobbyStatus as 'balanced',
        lock,
        bans: [],
        table: championTable(),
      }),
      lobbyStatus: state.lobbyStatus,
    };
  },
}));

const { loadModePanel } = await import('./loadPanel');

function balancedWithTheoAt(side: 100 | 200 | null): TonightSnapshot {
  const members = workedMembers();
  const teams = workedTeams({ members });
  if (!teams.blue.some((seat) => seat.puuid === THEO)) throw new Error('fixture: Theo is not on blue');
  return snapshot(
    lobbyView({ status: 'balanced', members, teams: seatedOnTheirSides(teams, { [THEO]: side }) }),
  );
}

function inGame(kind: 'custom' | 'rolled'): TonightSnapshot {
  const { members, teams, kickoff } = workedKickoff(kind);
  const lobby: LobbyView = lobbyView({ status: 'in_game', members, teams, kickoff });
  return snapshot(lobby);
}

beforeEach(() => {
  state.viewer = { kind: 'linked', puuid: THEO, isAdmin: false, isMember: true };
  state.lobbyStatus = 'balanced';
  state.shown = { ...REGION };
});

describe('the mode panel viewer side (M21.9)', () => {
  it('balanced: a blue seat sitting on red gets red first, then blue after moving; the lane is the split', async () => {
    const lane = workedTeams().blue.find((seat) => seat.puuid === THEO)?.role;
    state.snapshot = balancedWithTheoAt(200);
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: 'red', viewerLane: lane });
    state.snapshot = balancedWithTheoAt(100);
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: 'blue', viewerLane: lane });
    state.snapshot = balancedWithTheoAt(null);
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: 'blue', viewerLane: lane });
  });

  it('in game, region wars: the kickoff side (teams changed after Roll), with no lane line', async () => {
    state.lobbyStatus = 'in_game';
    state.snapshot = inGame('custom');
    const split = workedTeams().blue.some((seat) => seat.puuid === THEO) ? 'blue' : 'red';
    const data = await loadModePanel('customs', undefined);
    expect(data.viewerSide).not.toBe(split);
    expect(data).toMatchObject({ viewerSide: split === 'blue' ? 'red' : 'blue', viewerLane: null });
    state.snapshot = inGame('rolled');
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: split, viewerLane: null });
  });

  it('in game, Fearless: unchanged (no seat read, no lane line)', async () => {
    state.lobbyStatus = 'in_game';
    state.shown = { id: 'fearless' };
    state.snapshot = inGame('custom');
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: null, viewerLane: null });
  });

  it('a visitor never gets a side', async () => {
    state.viewer = { kind: 'anonymous' };
    state.snapshot = balancedWithTheoAt(200);
    expect(await loadModePanel('customs', undefined)).toMatchObject({ viewerSide: null, viewerLane: null });
  });
});
