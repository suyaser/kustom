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
  PUUID,
} from '../testing/tonightRows';
import { loadTonight } from './load';
import { selectTonightLobby, withSelection } from './selection';
import { tonightState } from './state';

/**
 * M22.5 with two live tables, through the real loader: every table's view in one snapshot, still
 * three rounds and the requests of a one-lobby night (acceptance 2), and the owner's M22.1 scene
 * with Bo still in the lobby the owner left (acceptance 4).
 */

const read = async (cycles: readonly CycleSpec[], lobbyId?: string) => {
  const { client, recording } = recordingClient(night(cycles));
  const snapshot = await loadTonight(client, {
    nightStart: NIGHT_START,
    nightLabel: 'TUESDAY 6 OCTOBER',
    nightClock: CLOCK,
    groupId: GROUP,
    now: NOW,
    lobbyId: lobbyId ?? null,
  });
  return { snapshot, recording };
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The owner's night (M22.1 step 0, shortened): Bo's custom (party B) opened at 18:50 and the owner's
 * (party A) at 19:29, newer. The owner then left A for B; Bo is still in A (his Kustom keeps it), so
 * A is not let go and **both tables are live**. Before M22.5 Tonight drew A (newest by created_at)
 * for everyone, the owner included.
 */
const OWNER = 0;
const BO = 12;
const SCENE: readonly CycleSpec[] = [
  {
    id: 'lobby-b',
    party: 'party-b',
    status: 'open',
    created: 70,
    updated: 2,
    reporter: 13,
    members: [13, 14, 15, 1, 2, 3, OWNER],
    joins: { [OWNER]: 2 },
  },
  {
    id: 'lobby-a',
    party: 'party-a',
    status: 'open',
    created: 31,
    updated: 31,
    reporter: OWNER,
    // The owner's stale seat in A (nobody's post removed it yet), from when he opened it.
    members: [OWNER, BO, 4, 5, 6, 7],
  },
];

describe("the owner's M22.1 scene, Bo still in A (acceptance 4)", () => {
  it('shows both tables, oldest opened first, each drawn as its own lobby', async () => {
    const { snapshot } = await read(SCENE);
    expect(snapshot.lobbies?.map((table) => [table.id, table.partyId, table.lobby.members.length])).toEqual([
      ['lobby-b', 'party-b', 7],
      ['lobby-a', 'party-a', 6],
    ]);
    expect(snapshot.lobbies?.map((table) => table.host?.puuid)).toEqual([PUUID(13), PUUID(OWNER)]);
    expect(snapshot.severalLobbiesTonight).toBe(true);
  });

  it("selects the owner's table (B, where he joined last), not the newest row", async () => {
    const { snapshot } = await read(SCENE);
    const owner = withSelection(snapshot, { viewerPuuid: PUUID(OWNER) });
    expect(owner.selectedLobbyId).toBe('lobby-b');
    expect(owner.lobby?.id).toBe('lobby-b');
    expect(tonightState(owner).kind).toBe('filling');
  });

  it("selects Bo's table for Bo, and the most recently changed for a visitor", async () => {
    const { snapshot } = await read(SCENE);
    expect(withSelection(snapshot, { viewerPuuid: PUUID(BO) }).selectedLobbyId).toBe('lobby-a');
    // B changed two minutes ago (the owner's arrival), A thirty-one: B.
    expect(snapshot.selectedLobbyId).toBe('lobby-b');
    expect(withSelection(snapshot, {}).selectedLobbyId).toBe('lobby-b');
  });

  it('a ?lobby= link to A opens A for the owner too; a stale one is ignored', async () => {
    const linked = await read(SCENE, 'lobby-a');
    expect(linked.snapshot.selectedLobbyId).toBe('lobby-a');
    expect(
      withSelection(linked.snapshot, { requested: 'lobby-a', viewerPuuid: PUUID(OWNER) }).selectedLobbyId,
    ).toBe('lobby-a');
    const stale = await read(SCENE, 'lobby-from-last-week');
    expect(stale.snapshot.selectedLobbyId).toBe('lobby-b');
  });
});

/** Party A's night as in the one-table scenes, plus Bo's custom (party B) finished two minutes ago. */
const TWO: readonly CycleSpec[] = [
  ...EARLIER,
  {
    id: 'lobby-b1',
    party: 'party-b',
    status: 'finished',
    created: 50,
    updated: 2,
    reporter: 12,
    members: [10, 11, 12, 13, 14, 15, 1, 2, 3, 4],
    split: { blue: [10, 11, 12, 13, 14], red: [15, 1, 2, 3, 4] },
    game: { id: 'game-b1', winner: 100, started: 45 },
  },
  currentCycle('teams'),
];

describe('two live tables through the loader (acceptance 2)', () => {
  it('the same requests in the same three rounds as a one-lobby night: more tables only lengthen the in lists', async () => {
    const one = await read([...EARLIER, currentCycle('teams')]);
    const two = await read(TWO);
    const shape = (recording: typeof one.recording) =>
      recording.requests.map((request) => `${request.wave} ${request.table}`);
    expect(shape(two.recording)).toEqual(shape(one.recording));
    expect(two.recording.waves()).toBe(3);
  });

  it("draws the table that changed last (B's result), and A's teams are a whole view too", async () => {
    const { snapshot } = await read(TWO);
    expect(snapshot.lobbies?.map((table) => [table.id, table.lobby.status])).toEqual([
      ['lobby-a3', 'balanced'],
      ['lobby-b1', 'finished'],
    ]);
    expect(snapshot.selectedLobbyId).toBe('lobby-b1');
    expect(tonightState(snapshot).kind).toBe('result');
    expect(tonightState(snapshot, 'lobby-a3').kind).toBe('teams');
  });

  it("the tape covers both tables; the selected table's result is the poster, never a tile", async () => {
    const { snapshot } = await read(TWO);
    expect(snapshot.tape.map((entry) => entry.lobbyId)).toEqual(['lobby-a1', 'lobby-a2']);
    const onA = selectTonightLobby(snapshot, 'lobby-a3');
    expect(onA.tape.map((entry) => entry.lobbyId)).toEqual(['lobby-a1', 'lobby-a2', 'lobby-b1']);
    expect(onA.tape[2]?.result?.gameId).toBe('game-b1');
  });

  it("reading on A gives the same snapshot as switching to A (the browser's switch needs no request)", async () => {
    const onA = await read(TWO, 'lobby-a3');
    const { snapshot } = await read(TWO);
    expect(selectTonightLobby(snapshot, 'lobby-a3')).toEqual(onA.snapshot);
  });
});
