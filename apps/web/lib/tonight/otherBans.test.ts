import { describe, expect, it } from 'vitest';
import type { FearlessView } from '../fearless/types';
import { otherLobbyBans } from './otherBans';
import { tableLabels } from './switcher';
import type { TableView, TapeEntry, TonightSnapshot } from './types';

/**
 * 14.5's attribution: Ana's lobby (selected) and Bo's lobby, both live. Times are minutes past 20:00.
 */
const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 20, minute)).toISOString();

function table(id: string, party: string, host: string, rowIds: string[], opened: number): TableView {
  return {
    id,
    partyId: party,
    rowIds,
    openedAt: at(opened),
    changedAt: at(opened),
    host: { puuid: `p-${host}`, name: host },
    watched: true,
    lobby: {
      id,
      status: 'open',
      lobbyName: null,
      lobbyPassword: null,
      startedAt: null,
      members: [],
      teams: null,
      result: null,
    },
    tile: null,
  };
}

function game(lobbyId: string, minute: number, gameId: string, tableHost?: string): TapeEntry {
  return {
    lobbyId,
    createdAt: at(minute),
    clock: '',
    status: 'finished',
    result: { gameId, winningSide: 100, durationS: 1500, aram: false, rated: true, mvp: null },
    blueWinProb: 0.5,
    rank: 1,
    sitters: [],
    ...(tableHost === undefined ? {} : { tableHost }),
  };
}

const ANA = table('ana-2', 'pa', 'Ana', ['ana-1', 'ana-2'], 0);
const BO = table('bo-2', 'pb', 'Bo', ['bo-1', 'bo-2'], 5);
const TABLES = [ANA, BO];
const LABELS = tableLabels(TABLES);

function pool(...games: (string | undefined)[]): FearlessView {
  return {
    resetAt: at(0),
    champions: games.map((gameId, index) => ({
      id: index + 1,
      name: `C${index}`,
      role: null,
      ...(gameId === undefined ? {} : { gameId }),
    })),
  };
}

function read(tape: TapeEntry[], fearless: FearlessView, mode: 'fearless' | 'normal' = 'fearless') {
  const snapshot = { lobbies: TABLES, selectedLobbyId: ANA.id, tape, mode, modeRow: undefined };
  return otherLobbyBans(
    snapshot as Pick<TonightSnapshot, 'lobbies' | 'selectedLobbyId' | 'tape' | 'mode' | 'modeRow'>,
    fearless,
    LABELS,
  );
}

describe('bans another lobby added (14.5)', () => {
  it("counts the other lobby's game after this lobby's last, and names it", () => {
    expect(
      read([game('ana-1', 10, 'g-ana'), game('bo-1', 20, 'g-bo')], pool('g-ana', 'g-bo', 'g-bo')),
    ).toEqual({
      count: 2,
      label: "Bo's lobby",
    });
  });

  it("the selected lobby's own game does not count", () => {
    expect(read([game('ana-1', 30, 'g-ana')], pool('g-ana', 'g-ana'))).toBeNull();
  });

  it("another lobby's game created before this lobby's last game does not count", () => {
    expect(read([game('bo-1', 10, 'g-bo'), game('ana-1', 20, 'g-ana')], pool('g-bo', 'g-ana'))).toBeNull();
  });

  it('a Normal night has no note', () => {
    expect(read([game('bo-1', 20, 'g-bo')], pool('g-bo'), 'normal')).toBeNull();
  });

  it('a pool champion with no game is skipped', () => {
    expect(read([game('bo-1', 20, 'g-bo')], pool(undefined, 'g-bo'))).toEqual({
      count: 1,
      label: "Bo's lobby",
    });
  });

  it('a game of an ended lobby counts under its host; with no host it is left out, never shown as nobody', () => {
    // Cy's table ended (not in `tables`) but the tape knows its host.
    expect(read([game('cy-1', 20, 'g-cy', 'Cy')], pool('g-cy'))).toEqual({ count: 1, label: "Cy's lobby" });
    // No host known: left out of the count, and Bo's own game still shows on its own.
    expect(read([game('x-1', 25, 'g-x'), game('bo-1', 20, 'g-bo')], pool('g-x', 'g-x', 'g-bo'))).toEqual({
      count: 1,
      label: "Bo's lobby",
    });
    expect(read([game('x-1', 25, 'g-x')], pool('g-x'))).toBeNull();
  });
});
