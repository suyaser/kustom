import { foldLiveTables, type LiveTable, TABLE_LINGER_MS, type TableRow, tokenWatches } from '../liveTables';
import type { TonightSnapshot } from './types';

/**
 * Tonight with several lobbies (M22.5): which tables are live, and who watches them. Pure; the
 * selection (which table the page draws) is `./selection.ts`, which the browser may import too.
 *
 * "Live" is `lib/liveTables.ts`' rule and nobody else's: {@link nightTables} folds tonight's rows
 * through `foldLiveTables`, the same fold `liveTables` uses. Tonight reads the rows with the anon
 * key, so it folds with no tokens; who is watching is added on the server ({@link withWatchers}).
 */

/** A live table with what Tonight needs beyond the fold: its rows, when it opened, when it changed. */
export interface NightTable extends LiveTable {
  /** Every row of the party tonight, oldest first. */
  rowIds: string[];
  /** The party's first row tonight: the switcher's order. */
  openedAt: string;
  /** The newest row's `updated_at`, or its `created_at` when later. */
  changedAt: string;
}

/**
 * Tonight's live tables from tonight's rows of the group (`abandoned` ones included: a newest
 * abandoned row ends its table), oldest opened first, with no watchers. One per live party.
 */
export function nightTables(rows: readonly TableRow[], now: Date): NightTable[] {
  const byParty = new Map<string, TableRow[]>();
  for (const row of [...rows].sort(byCreated)) {
    const list = byParty.get(row.lcuPartyId) ?? [];
    list.push(row);
    byParty.set(row.lcuPartyId, list);
  }
  return foldLiveTables(rows, [], [], now)
    .map((table) => {
      const own = byParty.get(table.partyId) ?? [table.lobby];
      return {
        ...table,
        rowIds: own.map((row) => row.id),
        openedAt: own[0]?.createdAt ?? table.lobby.createdAt,
        changedAt: later(table.lobby.updatedAt, table.lobby.createdAt),
      };
    })
    .sort(
      (a, b) =>
        Date.parse(a.openedAt) - Date.parse(b.openedAt) ||
        (a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0),
    );
}

/**
 * Were two tables live at the same time at any point tonight? (14.6: the tape then names each
 * tile's lobby for the rest of the night.) Each row is live from its `created_at` to: the next
 * row of its party or `now` while `open`, `balanced` or `in_game`; the end of the walk back
 * ({@link TABLE_LINGER_MS} after `updated_at`, cut by the next row and `now`) once `finished`;
 * its `updated_at` once `abandoned` or `dropped`. Two parties overlap when two such spans do.
 */
export function tablesOverlapped(rows: readonly TableRow[], now: Date): boolean {
  const byParty = new Map<string, TableRow[]>();
  for (const row of [...rows].sort(byCreated)) {
    const list = byParty.get(row.lcuPartyId) ?? [];
    list.push(row);
    byParty.set(row.lcuPartyId, list);
  }
  if (byParty.size < 2) return false;
  const end = now.getTime();
  const spans: { party: string; from: number; to: number }[] = [];
  for (const [party, list] of byParty) {
    list.forEach((row, index) => {
      const next = list[index + 1];
      const nextAt = next === undefined ? Number.POSITIVE_INFINITY : Date.parse(next.createdAt);
      const from = Date.parse(row.createdAt);
      let to: number;
      switch (row.status) {
        case 'open':
        case 'balanced':
        case 'in_game':
          to = Math.min(nextAt, end);
          break;
        case 'finished':
          to = Math.min(Date.parse(row.updatedAt) + TABLE_LINGER_MS, nextAt, end);
          break;
        case 'abandoned':
        case 'dropped':
          to = Math.min(Date.parse(row.updatedAt), end);
          break;
      }
      if (to > from) spans.push({ party, from, to });
    });
  }
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i];
      const b = spans[j];
      if (a === undefined || b === undefined || a.party === b.party) continue;
      if (Math.max(a.from, b.from) < Math.min(a.to, b.to)) return true;
    }
  }
  return false;
}

/** A token as {@link withWatchers} reads it: `liveTables`' `WatchingToken` plus its player's puuid. */
export interface TokenSeen {
  tokenId: string;
  playerId: string;
  puuid: string | null;
  currentPartyId: string | null;
  currentPartyAt: string | null;
}

/**
 * The snapshot with each table's `watched` filled from the group's watching tokens (M22.3's
 * `tokenWatches`, with the seats taken off the table's own roster), or unchanged for `null` (a
 * failed or skipped read keeps "unknown"). `lobby` is untouched: watching is a table fact.
 */
export function withWatchers(
  snapshot: TonightSnapshot,
  tokens: readonly TokenSeen[] | null,
): TonightSnapshot {
  const tables = snapshot.lobbies ?? [];
  if (tokens === null || tables.length === 0) return snapshot;
  const playerOf = new Map(
    tokens.flatMap((token) => (token.puuid === null ? [] : [[token.puuid, token.playerId] as const])),
  );
  return {
    ...snapshot,
    lobbies: tables.map((table) => {
      const seats = table.lobby.members.flatMap((member) => {
        const playerId = playerOf.get(member.puuid);
        return playerId === undefined ? [] : [{ lobbyId: table.id, playerId, createdAt: member.joinedAt }];
      });
      const watched = tokens.some((token) =>
        tokenWatches(token, { partyId: table.partyId, lobbyId: table.id }, seats),
      );
      return { ...table, watched };
    }),
  };
}

function byCreated(a: TableRow, b: TableRow): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function later(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
