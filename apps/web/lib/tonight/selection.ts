import type { TableView, TapeEntry, TonightSnapshot } from './types';

/**
 * Which live table Tonight draws (M22.5, 05-design.md 14.4), and the snapshot re-pointed at another
 * one. Pure and free of server imports, so the browser can switch lobbies with no request (14.4,
 * "Speed") and every rule here is a unit test. The tables themselves come from `./tables.ts`.
 */

/** What {@link pickTable} reads of a table; a `TableView`, or a `NightTable` with an id. */
export interface TableChoice {
  id: string;
  rowIds: readonly string[];
  openedAt: string;
  changedAt: string;
  lobby?: { members: readonly { puuid: string; joinedAt: string }[] };
}

/**
 * Which table the page opens on (05-design.md 14.4, M22.5), or null when none is live:
 *
 * 1. `requested` (`?lobby=`) if it names a row of a live table here: any cycle of the table, so
 *    an old Discord link lands on the lobby. Anything else (an ended table, another group's id,
 *    garbage) is ignored as if absent.
 * 2. Else the table the signed-in viewer is on (a linked player on its roster); on two rosters
 *    (a stale seat), the one they joined last.
 * 3. Else the table that changed most recently.
 */
export function pickTable(
  tables: readonly TableChoice[],
  options: { requested?: string | null; viewerPuuid?: string | null } = {},
): string | null {
  const requested = options.requested ?? null;
  if (requested !== null) {
    const named = tables.find((table) => table.rowIds.includes(requested));
    if (named !== undefined) return named.id;
  }
  const viewer = options.viewerPuuid ?? null;
  if (viewer !== null) {
    let best: { id: string; joinedAt: number; table: TableChoice } | null = null;
    for (const table of tables) {
      const seat = table.lobby?.members.find((member) => member.puuid === viewer);
      if (seat === undefined) continue;
      const joinedAt = Date.parse(seat.joinedAt);
      if (
        best === null ||
        joinedAt > best.joinedAt ||
        (joinedAt === best.joinedAt && changedLater(table, best.table))
      ) {
        best = { id: table.id, joinedAt, table };
      }
    }
    if (best !== null) return best.id;
  }
  let newest: TableChoice | null = null;
  for (const table of tables) if (newest === null || changedLater(table, newest)) newest = table;
  return newest?.id ?? null;
}

/**
 * The snapshot drawing table `tableId` instead (a chip tap, the viewer's table): `lobby` is that
 * table's, the tape gives back the previously selected table's tile and drops this one's (the
 * poster above shows it, 14.6). The same object when the id is already selected or not a table.
 */
export function selectTonightLobby(snapshot: TonightSnapshot, tableId: string | null): TonightSnapshot {
  const tables = snapshot.lobbies ?? [];
  const next = tables.find((table) => table.id === tableId);
  if (next === undefined || snapshot.selectedLobbyId === next.id) return snapshot;
  const previous = tables.find((table) => table.id === snapshot.selectedLobbyId);
  const tape = snapshot.tape.filter((entry) => entry.lobbyId !== next.lobby.id);
  if (previous?.tile != null && !tape.some((entry) => entry.lobbyId === previous.tile?.lobbyId)) {
    tape.push(previous.tile);
  }
  return { ...snapshot, lobby: next.lobby, selectedLobbyId: next.id, tape: tape.sort(byTapeOrder) };
}

/** {@link selectTonightLobby} on {@link pickTable}'s answer: the page's selection once it knows the viewer. */
export function withSelection(
  snapshot: TonightSnapshot,
  options: { requested?: string | null; viewerPuuid?: string | null },
): TonightSnapshot {
  return selectTonightLobby(snapshot, pickTable(snapshot.lobbies ?? [], options));
}

/** The table the snapshot draws, or undefined (no live table). */
export function selectedTable(snapshot: TonightSnapshot): TableView | undefined {
  return (snapshot.lobbies ?? []).find((table) => table.id === snapshot.selectedLobbyId);
}

/** The tape's order: `pickTapeLobbies`' (created, then id). */
function byTapeOrder(a: TapeEntry, b: TapeEntry): number {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    (a.lobbyId < b.lobbyId ? -1 : a.lobbyId > b.lobbyId ? 1 : 0)
  );
}

function changedLater(a: TableChoice, b: TableChoice): boolean {
  const at = Date.parse(a.changedAt);
  const bt = Date.parse(b.changedAt);
  if (at !== bt) return at > bt;
  const ao = Date.parse(a.openedAt);
  const bo = Date.parse(b.openedAt);
  if (ao !== bo) return ao > bo;
  return a.id > b.id;
}
