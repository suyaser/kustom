import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingClient } from '../testing/recordingClient';
import {
  CLOCK,
  type CycleSpec,
  currentCycle,
  EARLIER,
  GROUP,
  NIGHT_START,
  NOW,
  night,
} from '../testing/tonightRows';
import { loadTonight } from './load';
import { withSelection } from './selection';
import { tonightState } from './state';
import type { TonightSnapshot } from './types';

/**
 * M22.5 acceptance 1 and M22 D2: **with one live table Tonight is exactly what it was.** The real
 * loader runs over one party's night in every state, and the snapshot's fields from before M22
 * (everything but `lobbies`, `selectedLobbyId` and `severalLobbiesTonight`), the state, and the requests it made (table and
 * round of each; the lobbies read names two more columns since M22.5) are pinned to a file snapshot recorded **with the pre-M22.5 loader**
 * (`__snapshots__/oneTable.test.ts.snap`, first written at the M22.3 head 4c89a108). A change that
 * moves one field, one request or one round on a one-lobby night fails here.
 */

const SCENES: Record<string, readonly CycleSpec[]> = {
  'no lobby tonight': [],
  filling: [...EARLIER, currentCycle('filling')],
  'teams set': [...EARLIER, currentCycle('teams')],
  'in game': [...EARLIER, currentCycle('in-game')],
  result: [...EARLIER, currentCycle('result')],
  'result an hour ago (no live table)': [...EARLIER, currentCycle('result-old')],
  'dropped (idle with the tape)': [...EARLIER, currentCycle('dropped')],
  'newest abandoned (the finished one before it)': [...EARLIER, currentCycle('abandoned')],
  'first lobby filling': [currentCycle('filling')],
};

/** The snapshot as it was before M22.5: the new fields left out. */
function beforeM22(snapshot: TonightSnapshot): TonightSnapshot {
  const {
    lobbies: _lobbies,
    selectedLobbyId: _selected,
    severalLobbiesTonight: _several,
    ...rest
  } = snapshot;
  return rest;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('one table: the snapshot as before M22 (M22.5 acceptance 1)', () => {
  for (const [name, cycles] of Object.entries(SCENES)) {
    it(name, async () => {
      const { client, recording } = recordingClient(night(cycles));
      const snapshot = await loadTonight(client, {
        nightStart: NIGHT_START,
        nightLabel: 'TUESDAY 6 OCTOBER',
        nightClock: CLOCK,
        groupId: GROUP,
        now: NOW,
      });
      expect({
        snapshot: beforeM22(snapshot),
        state: tonightState(snapshot).kind,
        requests: recording.requests.map((request) => `${request.wave} ${request.table}`),
      }).toMatchSnapshot();

      // The new fields on a one-lobby night: one table that is the drawn lobby (the same object),
      // or none at all; never "several lobbies".
      expect(snapshot.severalLobbiesTonight).toBe(false);
      if (snapshot.selectedLobbyId == null) {
        expect(snapshot.lobbies).toEqual([]);
      } else {
        expect(snapshot.lobbies).toHaveLength(1);
        expect(snapshot.lobbies?.[0]?.lobby).toBe(snapshot.lobby);
        expect(snapshot.selectedLobbyId).toBe(snapshot.lobby?.id);
        // A `?lobby=` or a viewer changes nothing with one table.
        expect(withSelection(snapshot, { requested: 'lobby-a1', viewerPuuid: 'puuid-0' })).toBe(snapshot);
      }
    });
  }

  it('which scenes have a live table', async () => {
    const live: Record<string, boolean> = {};
    for (const [name, cycles] of Object.entries(SCENES)) {
      const { client } = recordingClient(night(cycles));
      const snapshot = await loadTonight(client, {
        nightStart: NIGHT_START,
        nightClock: CLOCK,
        groupId: GROUP,
        now: NOW,
      });
      live[name] = snapshot.selectedLobbyId != null;
    }
    expect(live).toEqual({
      'no lobby tonight': false,
      filling: true,
      'teams set': true,
      'in game': true,
      result: true,
      'result an hour ago (no live table)': false,
      'dropped (idle with the tape)': false,
      'newest abandoned (the finished one before it)': false,
      'first lobby filling': true,
    });
  });
});
