import { describe, expect, it } from 'vitest';
import { lobbyView, snapshot } from '../testing/tonightFixtures';
import { pickTable, selectedTable, selectTonightLobby, type TableChoice, withSelection } from './selection';
import { tonightState } from './state';
import type { LobbyView, TableView, TapeEntry, TonightSnapshot } from './types';

/**
 * M22.5 acceptance 3: which table Tonight opens on (05-design.md 14.4): `?lobby=`, else the
 * viewer's table, else the most recently changed; a stale `?lobby=` is ignored.
 */

const seat = (puuid: string, joinedAt: string) => ({ puuid, joinedAt });

function choice(id: string, over: Partial<TableChoice> = {}): TableChoice {
  return {
    id,
    rowIds: [`${id}-old`, id],
    openedAt: '2026-10-06T18:00:00.000Z',
    changedAt: '2026-10-06T19:00:00.000Z',
    lobby: { members: [] },
    ...over,
  };
}

const ANA = choice('ana', {
  openedAt: '2026-10-06T18:50:00.000Z',
  changedAt: '2026-10-06T19:40:00.000Z',
  lobby: { members: [seat('you', '2026-10-06T19:35:00.000Z'), seat('ana', '2026-10-06T18:50:00.000Z')] },
});
const BO = choice('bo', {
  openedAt: '2026-10-06T19:29:00.000Z',
  changedAt: '2026-10-06T19:50:00.000Z',
  lobby: { members: [seat('bo', '2026-10-06T19:29:00.000Z')] },
});

describe('pickTable (M22.5 acceptance 3)', () => {
  it('no live table: null', () => {
    expect(pickTable([], { requested: 'ana', viewerPuuid: 'you' })).toBeNull();
  });

  it('one live table: that table, whatever the URL or viewer', () => {
    expect(pickTable([ANA])).toBe('ana');
    expect(pickTable([ANA], { requested: 'garbage', viewerPuuid: 'nobody' })).toBe('ana');
  });

  it('?lobby= naming a live table wins over the viewer and the newest change', () => {
    expect(pickTable([ANA, BO], { requested: 'ana', viewerPuuid: 'bo' })).toBe('ana');
  });

  it('?lobby= naming an earlier cycle of a live table lands on the table', () => {
    expect(pickTable([ANA, BO], { requested: 'bo-old', viewerPuuid: 'you' })).toBe('bo');
  });

  it('a stale ?lobby= (ended table, another group, garbage) is ignored as if absent', () => {
    expect(pickTable([ANA, BO], { requested: 'ended-lobby', viewerPuuid: 'you' })).toBe('ana');
    expect(pickTable([ANA, BO], { requested: '', viewerPuuid: null })).toBe('bo');
    expect(pickTable([ANA, BO], { requested: null })).toBe('bo');
  });

  it("the viewer's table when there is no usable ?lobby=, even when the other changed later", () => {
    expect(pickTable([ANA, BO], { viewerPuuid: 'you' })).toBe('ana');
    expect(pickTable([ANA, BO], { viewerPuuid: 'bo' })).toBe('bo');
  });

  it('a viewer on two rosters (a stale seat) gets the one they joined last', () => {
    const stale = choice('stale', {
      changedAt: '2026-10-06T19:59:00.000Z',
      lobby: { members: [seat('you', '2026-10-06T19:00:00.000Z')] },
    });
    expect(pickTable([stale, ANA], { viewerPuuid: 'you' })).toBe('ana');
  });

  it('a viewer on no roster, or nobody signed in: the most recently changed', () => {
    expect(pickTable([ANA, BO], { viewerPuuid: 'stranger' })).toBe('bo');
    expect(pickTable([BO, ANA])).toBe('bo');
  });

  it('ties on the change break on the later opened, then the id, so the answer never flickers', () => {
    const a = choice('a', { changedAt: '2026-10-06T19:00:00.000Z', openedAt: '2026-10-06T18:00:00.000Z' });
    const b = choice('b', { changedAt: '2026-10-06T19:00:00.000Z', openedAt: '2026-10-06T18:30:00.000Z' });
    const c = choice('c', { changedAt: '2026-10-06T19:00:00.000Z', openedAt: '2026-10-06T18:30:00.000Z' });
    expect(pickTable([a, b])).toBe('b');
    expect(pickTable([c, b, a])).toBe('c');
  });
});

function tile(lobbyId: string, createdAt: string): TapeEntry {
  return {
    lobbyId,
    createdAt,
    clock: createdAt.slice(11, 16),
    status: 'finished',
    result: null,
    blueWinProb: null,
    rank: null,
    sitters: [],
  };
}

function table(lobby: LobbyView, over: Partial<TableView> = {}): TableView {
  return {
    id: lobby.id,
    partyId: `party-${lobby.id}`,
    rowIds: [lobby.id],
    openedAt: '2026-10-06T18:00:00.000Z',
    changedAt: '2026-10-06T19:00:00.000Z',
    host: null,
    watched: null,
    lobby,
    tile: null,
    ...over,
  };
}

describe('selectTonightLobby: the snapshot drawing another table', () => {
  const filling = lobbyView({ id: 'ana', status: 'open' });
  const finished = lobbyView({ id: 'bo', status: 'finished', members: [] });
  const earlier = tile('earlier', '2026-10-06T17:00:00.000Z');
  const boTile = tile('bo', '2026-10-06T18:30:00.000Z');
  const two: TonightSnapshot = {
    ...snapshot(filling),
    lobbies: [table(filling), table(finished, { tile: boTile })],
    selectedLobbyId: 'ana',
    tape: [earlier, boTile],
  };

  it("switching to Bo's finished lobby draws its poster and takes its tile off the tape", () => {
    const bo = selectTonightLobby(two, 'bo');
    expect(bo.lobby).toBe(finished);
    expect(bo.selectedLobbyId).toBe('bo');
    expect(bo.tape.map((entry) => entry.lobbyId)).toEqual(['earlier']);
    expect(selectedTable(bo)?.id).toBe('bo');
  });

  it("switching back puts Bo's tile back in the tape's order", () => {
    const back = selectTonightLobby(selectTonightLobby(two, 'bo'), 'ana');
    expect(back.lobby).toBe(filling);
    expect(back.tape).toEqual(two.tape);
  });

  it('the same object for the selected id, an unknown id, or a snapshot with no tables', () => {
    expect(selectTonightLobby(two, 'ana')).toBe(two);
    expect(selectTonightLobby(two, 'nope')).toBe(two);
    expect(selectTonightLobby(two, null)).toBe(two);
    const old = snapshot(filling);
    expect(selectTonightLobby(old, 'ana')).toBe(old);
  });

  it("withSelection opens on the viewer's table", () => {
    const viewer = filling.members[0]?.puuid ?? '';
    const onBo = { ...two, selectedLobbyId: 'bo', lobby: finished, tape: [earlier] };
    expect(withSelection(onBo, { viewerPuuid: viewer }).selectedLobbyId).toBe('ana');
    expect(withSelection(onBo, { requested: 'bo', viewerPuuid: viewer })).toBe(onBo);
  });

  it('tonightState draws a given table, and the selected one for an id that is not a table', () => {
    expect(tonightState(two).kind).toBe('filling');
    expect(tonightState(two, 'bo')).toEqual(tonightState({ ...two, lobby: finished }));
    expect(tonightState(two, 'nope')).toEqual(tonightState(two));
  });
});
