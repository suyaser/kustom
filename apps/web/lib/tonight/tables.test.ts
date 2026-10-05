import { describe, expect, it } from 'vitest';
import type { TableRow } from '../liveTables';
import { drawableLobbyIds } from '../me/claimable';
import { lobbyView, snapshot } from '../testing/tonightFixtures';
import { nightTables, type TokenSeen, tablesOverlapped, withWatchers } from './tables';
import type { TableView } from './types';

/** M22.5: tonight's live tables from tonight's rows, the night-wide overlap flag, and the watchers. */

const NOW = new Date('2026-10-06T20:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function row(
  id: string,
  party: string,
  status: TableRow['status'],
  created: number,
  updated = created,
): TableRow {
  return {
    id,
    lcuPartyId: party,
    status,
    createdAt: ago(created),
    updatedAt: ago(updated),
    reportedByPlayerId: `reporter-${id}`,
    lobbyName: null,
  };
}

describe('nightTables', () => {
  it('one per live party, oldest opened first, with every row of the party and the first reporter', () => {
    const rows = [
      row('b1', 'party-b', 'open', 50),
      row('a1', 'party-a', 'finished', 120, 80),
      row('a2', 'party-a', 'balanced', 70, 10),
    ];
    const tables = nightTables(rows, NOW);
    expect(tables.map((table) => [table.partyId, table.lobby.id, table.rowIds])).toEqual([
      ['party-a', 'a2', ['a1', 'a2']],
      ['party-b', 'b1', ['b1']],
    ]);
    expect(tables[0]?.openedAt).toBe(ago(120));
    expect(tables[0]?.changedAt).toBe(ago(10));
    expect(tables[0]?.label.hostPlayerId).toBe('reporter-a1');
  });

  it('a finished table lingers twenty minutes, then ends; abandoned and dropped end it at once', () => {
    expect(nightTables([row('a', 'p', 'finished', 60, 19)], NOW)).toHaveLength(1);
    expect(nightTables([row('a', 'p', 'finished', 60, 21)], NOW)).toHaveLength(0);
    expect(nightTables([row('a', 'p', 'finished', 60, 5), row('b', 'p', 'abandoned', 4)], NOW)).toHaveLength(
      0,
    );
    expect(nightTables([row('a', 'p', 'dropped', 200, 1)], NOW)).toHaveLength(0);
  });

  it('a newer finished cycle of another table never hides a live one (M22.1 gap)', () => {
    const rows = [row('a', 'party-a', 'open', 90, 90), row('b', 'party-b', 'finished', 60, 30)];
    expect(nightTables(rows, NOW).map((table) => table.lobby.id)).toEqual(['a']);
  });
});

describe('drawableLobbyIds (claimable seats, M22.5)', () => {
  it("every live table's newest row", () => {
    const rows = [
      row('a1', 'a', 'finished', 120, 80),
      row('a2', 'a', 'open', 70),
      row('b1', 'b', 'in_game', 50),
    ];
    expect(drawableLobbyIds(rows, NOW)).toEqual(['a2', 'b1']);
  });

  it('with no live table, the newest non-abandoned row, as before M22', () => {
    const rows = [row('a1', 'a', 'finished', 120, 80), row('a2', 'a', 'abandoned', 70)];
    expect(drawableLobbyIds(rows, NOW)).toEqual(['a1']);
    expect(drawableLobbyIds([], NOW)).toEqual([]);
  });
});

describe('tablesOverlapped (the tape names its lobbies, 14.6)', () => {
  it('one party all night: false', () => {
    const rows = [
      row('a1', 'a', 'finished', 200, 150),
      row('a2', 'a', 'finished', 140, 90),
      row('a3', 'a', 'open', 80),
    ];
    expect(tablesOverlapped(rows, NOW)).toBe(false);
  });

  it('two parties live at once: true, and it stays true after one ends', () => {
    const both = [row('a', 'a', 'open', 90), row('b', 'b', 'open', 60)];
    expect(tablesOverlapped(both, NOW)).toBe(true);
    const ended = [row('a', 'a', 'abandoned', 90, 30), row('b', 'b', 'open', 60)];
    expect(tablesOverlapped(ended, NOW)).toBe(true);
  });

  it('a host who closes a custom and opens another later, with no overlap: false', () => {
    const rows = [row('a', 'a', 'finished', 200, 150), row('b', 'b', 'open', 100)];
    expect(tablesOverlapped(rows, NOW)).toBe(false);
  });

  it('a new custom inside the walk back of a finished one overlaps (both were live, M22 D4)', () => {
    const rows = [row('a', 'a', 'finished', 200, 110), row('b', 'b', 'open', 100)];
    expect(tablesOverlapped(rows, NOW)).toBe(true);
  });
});

describe('withWatchers (No Kustom, 14.8)', () => {
  const ana = lobbyView({ id: 'ana', status: 'open' });
  const bo = lobbyView({ id: 'bo', status: 'open', members: [] });
  const table = (lobby: typeof ana, partyId: string): TableView => ({
    id: lobby.id,
    partyId,
    rowIds: [lobby.id],
    openedAt: ago(60),
    changedAt: ago(30),
    host: null,
    watched: null,
    lobby,
    tile: null,
  });
  const two = {
    ...snapshot(ana),
    lobbies: [table(ana, 'party-ana'), table(bo, 'party-bo')],
    selectedLobbyId: 'ana',
  };
  const someone = ana.members[0];
  const token = (over: Partial<TokenSeen>): TokenSeen => ({
    tokenId: 't1',
    playerId: 'p1',
    puuid: someone?.puuid ?? null,
    currentPartyId: null,
    currentPartyAt: null,
    ...over,
  });

  it("a token whose current party is the table's watches it; a table with none is unwatched", () => {
    const watched = withWatchers(two, [token({ currentPartyId: 'party-bo', currentPartyAt: ago(1) })]);
    expect(watched.lobbies?.map((t) => t.watched)).toEqual([false, true]);
    expect(watched.lobby).toBe(two.lobby);
  });

  it('a token that has posted nothing since 0050 watches the table its player sits in', () => {
    const watched = withWatchers(two, [token({})]);
    expect(watched.lobbies?.map((t) => t.watched)).toEqual([true, false]);
  });

  it('a failed or skipped read keeps unknown', () => {
    expect(withWatchers(two, null)).toBe(two);
  });
});
