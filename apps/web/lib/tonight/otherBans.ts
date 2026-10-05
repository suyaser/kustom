import type { FearlessView } from '../fearless/types';
import { selectedTable } from './selection';
import { tileLabel } from './switcher';
import type { TapeEntry, TonightSnapshot } from './types';

/** 14.5: bans another lobby's games added since the selected lobby's own last game. */
export interface OtherBans {
  count: number;
  /** The lobby of the newest of those games. */
  label: string;
}

/**
 * The dashed note's facts (05-design.md 14.5, `‹10› more banned from a game in ‹label›.`), or null.
 * Only with two or more live lobbies on a Fearless night.
 *
 * Attribution: each pool champion carries the `games.id` that first locked it (`FearlessChampion.gameId`),
 * and each finished row of tonight (the tape and every live table's tile) carries its game and its
 * lobby row, so a ban belongs to the lobby whose row played that game. Games of other lobbies whose
 * row was created after the selected lobby's newest finished row (else after it opened) count.
 * ponytail: ordered by the lobby row's `created_at`, not the game's end; a game that started before
 * this lobby's last one and ended after it is missed. Order by `games.ended_at` if that ever matters.
 */
export function otherLobbyBans(
  snapshot: Pick<TonightSnapshot, 'lobbies' | 'selectedLobbyId' | 'tape' | 'mode' | 'modeRow'>,
  fearless: FearlessView,
  labels: Map<string, string>,
): OtherBans | null {
  const tables = snapshot.lobbies ?? [];
  const shown = selectedTable(snapshot as TonightSnapshot);
  if (tables.length < 2 || shown === undefined) return null;
  if ((snapshot.modeRow?.standing ?? snapshot.mode) !== 'fearless') return null;
  const played = new Map<string, TapeEntry>();
  for (const entry of [
    ...snapshot.tape,
    ...tables.flatMap((table) => (table.tile === null ? [] : [table.tile])),
  ]) {
    if (entry.result !== null) played.set(entry.lobbyId, entry);
  }
  const mine = [...played.values()].filter((entry) => shown.rowIds.includes(entry.lobbyId));
  const since = Math.max(Date.parse(shown.openedAt), ...mine.map((entry) => Date.parse(entry.createdAt)));
  const others = [...played.values()]
    .filter((entry) => !shown.rowIds.includes(entry.lobbyId) && Date.parse(entry.createdAt) > since)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const games = new Set(others.map((entry) => entry.result?.gameId));
  const count = fearless.champions.filter(
    (champion) => champion.gameId !== undefined && games.has(champion.gameId),
  ).length;
  const newest = others.at(-1);
  const label = newest === undefined ? null : tileLabel(newest, tables, labels);
  return count === 0 || label === null ? null : { count, label };
}
