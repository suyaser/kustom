import { describe, expect, it } from 'vitest';
import {
  foldLiveTables,
  isTableLive,
  type SeatSeen,
  TABLE_LINGER_MS,
  type TableRow,
  tokenWatches,
  type WatchingToken,
} from './liveTables';

const NOW = new Date('2026-10-05T20:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function row(id: string, party: string, overrides: Partial<TableRow> = {}): TableRow {
  return {
    id,
    lcuPartyId: party,
    status: 'open',
    createdAt: ago(60),
    updatedAt: ago(5),
    reportedByPlayerId: `host-${party}`,
    lobbyName: `name-${party}`,
    ...overrides,
  };
}

function token(id: string, overrides: Partial<WatchingToken> = {}): WatchingToken {
  return { tokenId: id, playerId: `player-${id}`, currentPartyId: null, currentPartyAt: null, ...overrides };
}

describe('isTableLive (M22 D4)', () => {
  it.each(['open', 'balanced', 'in_game'] as const)('%s is live however old', (status) => {
    expect(isTableLive({ status, updatedAt: ago(500) }, NOW)).toBe(true);
  });
  it.each(['abandoned', 'dropped'] as const)('%s has ended', (status) => {
    expect(isTableLive({ status, updatedAt: ago(0) }, NOW)).toBe(false);
  });
  it('finished lingers for exactly TABLE_LINGER_MS', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(isTableLive({ status: 'finished', updatedAt: at(TABLE_LINGER_MS - 1) }, NOW)).toBe(true);
    expect(isTableLive({ status: 'finished', updatedAt: at(TABLE_LINGER_MS) }, NOW)).toBe(false);
  });
});

describe('tokenWatches (M22 D7)', () => {
  const table = { partyId: 'X', lobbyId: 'x1' };
  const seat: SeatSeen = { lobbyId: 'x1', playerId: 'player-t', createdAt: ago(10) };

  it('a token whose current party is the table is in it, seated or not', () => {
    expect(tokenWatches(token('t', { currentPartyId: 'X', currentPartyAt: ago(1) }), table, [])).toBe(true);
  });
  it('a token that has not posted since 0050 is in it by its seat (M22.1)', () => {
    expect(tokenWatches(token('t'), table, [seat])).toBe(true);
    expect(tokenWatches(token('t'), table, [])).toBe(false);
  });
  it('the newest evidence wins: a seat after the token last moved counts, one before does not', () => {
    expect(tokenWatches(token('t', { currentPartyId: 'Y', currentPartyAt: ago(20) }), table, [seat])).toBe(
      true,
    );
    expect(tokenWatches(token('t', { currentPartyId: 'Y', currentPartyAt: ago(5) }), table, [seat])).toBe(
      false,
    );
  });
  it('a seat in another row of the party does not count', () => {
    expect(tokenWatches(token('t'), table, [{ ...seat, lobbyId: 'x0' }])).toBe(false);
  });
  it('seatCounts false: only the current party', () => {
    expect(tokenWatches(token('t'), table, [seat], { seatCounts: false })).toBe(false);
  });
});

describe('foldLiveTables', () => {
  it('one table per party, its newest row, oldest table first', () => {
    const rows = [
      row('y1', 'Y', { createdAt: ago(30) }),
      row('x1', 'X', { createdAt: ago(90), status: 'finished', updatedAt: ago(70) }),
      row('x2', 'X', { createdAt: ago(40), reportedByPlayerId: 'someone-else' }),
    ];
    const tables = foldLiveTables(rows, [], [], NOW);
    expect(tables.map((table) => [table.partyId, table.lobby.id])).toEqual([
      ['X', 'x2'],
      ['Y', 'y1'],
    ]);
  });

  it('a newer ended row ends the table; a lingering finished row keeps it', () => {
    const rows = [
      row('x1', 'X', { createdAt: ago(50) }),
      row('x2', 'X', { createdAt: ago(40), status: 'abandoned' }),
      row('y1', 'Y', { status: 'finished', updatedAt: ago(19) }),
      row('z1', 'Z', { status: 'finished', updatedAt: ago(21) }),
      row('w1', 'W', { status: 'dropped' }),
    ];
    expect(foldLiveTables(rows, [], [], NOW).map((table) => table.partyId)).toEqual(['Y']);
  });

  it('the label host is the first reporter, fixed across cycles; the name is the newest row', () => {
    const rows = [
      row('x0', 'X', { createdAt: ago(100), reportedByPlayerId: null, status: 'abandoned' }),
      row('x1', 'X', {
        createdAt: ago(90),
        reportedByPlayerId: 'ana',
        status: 'finished',
        updatedAt: ago(60),
      }),
      row('x2', 'X', { createdAt: ago(10), reportedByPlayerId: 'bo', lobbyName: 'renamed' }),
    ];
    expect(foldLiveTables(rows, [], [], NOW)[0]?.label).toEqual({
      hostPlayerId: 'ana',
      lobbyName: 'renamed',
    });
  });

  it('watchers: by current party or by a newer seat on the newest row, sorted by token id', () => {
    const rows = [row('x1', 'X'), row('y1', 'Y', { createdAt: ago(30) })];
    const tokens = [
      token('c', { currentPartyId: 'X', currentPartyAt: ago(3) }),
      token('a', { currentPartyId: 'X', currentPartyAt: ago(2) }),
      token('b', { currentPartyId: 'Y', currentPartyAt: ago(20) }),
    ];
    const seats: SeatSeen[] = [{ lobbyId: 'x1', playerId: 'player-b', createdAt: ago(4) }];
    const tables = foldLiveTables(rows, tokens, seats, NOW);
    expect(tables.map((table) => table.watchers.map((watcher) => watcher.tokenId))).toEqual([
      ['a', 'b', 'c'],
      ['b'],
    ]);
  });

  it('no rows, no tables', () => {
    expect(
      foldLiveTables([], [token('a', { currentPartyId: 'X', currentPartyAt: ago(1) })], [], NOW),
    ).toEqual([]);
  });
});
