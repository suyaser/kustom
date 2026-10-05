import { describe, expect, it } from 'vitest';
import type { TableRow } from '../liveTables';
import { drawableLobbyIds } from '../me/claimable';
import { nightTables, seatsFromRosters, type TokenSeen, tablesOverlapped } from './tables';

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

describe('a finished table whose Kustoms moved on ends at once (lead ruling 2026-10-05)', () => {
  // Party A finished five minutes ago; the host (token-host, player host) sat in it.
  const finishedA = row('a1', 'party-a', 'finished', 50, 5);
  const openB = row('b1', 'party-b', 'open', 3);
  const seat = (lobbyId: string, playerId: string, minutes: number) => ({
    lobbyId,
    playerId,
    createdAt: ago(minutes),
  });
  const token = (
    tokenId: string,
    playerId: string,
    party: string | null,
    minutes: number | null,
  ): TokenSeen => ({
    tokenId,
    playerId,
    puuid: `puuid-${playerId}`,
    currentPartyId: party,
    currentPartyAt: minutes === null ? null : ago(minutes),
  });

  it('the host moves to a new party: the old finished table is gone now, not in twenty minutes', () => {
    const tokens = [token('token-host', 'host', 'party-b', 3)];
    const seats = [seat('a1', 'host', 50), seat('b1', 'host', 3)];
    expect(nightTables([finishedA, openB], NOW, tokens, seats).map((t) => t.partyId)).toEqual(['party-b']);
    // The anon fold (no tokens) cannot know and keeps the linger; Tonight refolds with the tokens.
    expect(nightTables([finishedA, openB], NOW).map((t) => t.partyId)).toEqual(['party-a', 'party-b']);
  });

  it('a co-host still sits in the old post-game lobby: it lingers, and is watched', () => {
    const tokens = [token('token-host', 'host', 'party-b', 3), token('token-co', 'co', 'party-a', 50)];
    const seats = [seat('a1', 'host', 50), seat('a1', 'co', 50), seat('b1', 'host', 3)];
    const tables = nightTables([finishedA, openB], NOW, tokens, seats);
    expect(tables.map((t) => [t.partyId, t.watchers.map((w) => w.tokenId)])).toEqual([
      ['party-a', ['token-co']],
      ['party-b', ['token-host']],
    ]);
  });

  it('a Kustom that has posted nothing since the game (players still in the post-game lobby): it lingers', () => {
    const tokens = [token('token-host', 'host', 'party-a', 50)];
    expect(nightTables([finishedA], NOW, tokens, [seat('a1', 'host', 50)])).toHaveLength(1);
    // Offline Kustoms (no token seen) say nothing either way: the linger holds.
    expect(nightTables([finishedA], NOW, [], [])).toHaveLength(1);
  });

  it('a token that moved before the game ended, or was never in the table, does not end it', () => {
    const before = [token('token-x', 'x', 'party-b', 30)];
    expect(nightTables([finishedA, openB], NOW, before, [seat('a1', 'x', 50)])).toHaveLength(2);
    const stranger = [token('token-y', 'y', 'party-b', 3)];
    expect(nightTables([finishedA, openB], NOW, stranger, [])).toHaveLength(2);
  });

  it('a live (pre-game or in-game) table is never ended by a move: the M22.1 let-go owns that', () => {
    const inGame = row('a1', 'party-a', 'in_game', 50, 40);
    const tokens = [token('token-host', 'host', 'party-b', 3)];
    expect(nightTables([inGame, openB], NOW, tokens, [seat('a1', 'host', 50)])).toHaveLength(2);
  });

  it('seatsFromRosters maps the tokens onto the rosters Tonight already has', () => {
    const tokens = [token('token-host', 'host', 'party-b', 3)];
    expect(
      seatsFromRosters(
        [
          {
            id: 'a1',
            members: [
              { puuid: 'puuid-host', joinedAt: ago(50) },
              { puuid: 'other', joinedAt: ago(9) },
            ],
          },
        ],
        tokens,
      ),
    ).toEqual([seat('a1', 'host', 50)]);
  });

  it("the night's overlap flag: the host's own next custom inside the walk back is not an overlap", () => {
    const hostA = { ...finishedA, reportedByPlayerId: 'host' };
    const hostB = { ...openB, reportedByPlayerId: 'host' };
    expect(tablesOverlapped([hostA, hostB], NOW)).toBe(false);
    expect(tablesOverlapped([hostA, { ...hostB, reportedByPlayerId: 'bo' }], NOW)).toBe(true);
  });
});
