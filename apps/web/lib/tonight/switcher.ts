import { ruleOf } from '@customs/core';
import { formatLobbyLabel, lobbyLabels } from '../lobbyLabel';
import { MODE_NAMES } from '../mode/copy';
import { ruleLabel } from '../mode/ruleNotices';
import { renderWebName } from './copy';
import { shortNightLabel } from './screenCopy';
import { lobbyAround, tonightState } from './state';
import type { TableView, TapeEntry, TonightSnapshot } from './types';

/**
 * Tonight with several lobbies (M22.6, 05-design.md 14): the switcher's chips, the labels, the
 * date line and the announcer's lines, pure. **With at most one live lobby nothing here is drawn**
 * (M22 D2): {@link lobbyChips} answers the chips of every live table, and the page draws the
 * switcher only while it has two or more.
 */

/** 14.11: the switcher's nav name and the YOU sticker's words for a screen reader. */
export const LOBBIES_NAV = 'Lobbies';
export const YOU_IN_THIS_LOBBY = ", you're in this lobby";

/** A chip's status (14.4), before the minute it is read at. */
export type ChipStatus =
  | { kind: 'filling'; count: number }
  | { kind: 'teams' }
  | { kind: 'in-game'; startedAt: string | null }
  | { kind: 'won'; side: 'blue' | 'red' }
  | { kind: 'no-kustom' };

export interface LobbyChip {
  /** The table's id (its newest row), the value `?lobby=` carries; it moves with each game. */
  id: string;
  /** The table's party: the same chip across game cycles (React's key, the announcer's identity). */
  key: string;
  label: string;
  status: ChipStatus;
  /** `Region wars`, `Fearless`: the mode this lobby's game plays, at most two words. */
  mode: string;
  /** The signed-in viewer is on this table's roster (the `YOU` sticker). */
  you: boolean;
}

/** Every live table's label (14.1), by table id: `Ana's lobby`, `Ana's lobby 2`, `Lobby 2`. */
export function tableLabels(tables: readonly TableView[]): Map<string, string> {
  const labels = lobbyLabels(
    tables.map((table) => ({ key: table.id, hostName: table.host?.name ?? null, openedAt: table.openedAt })),
    renderWebName,
  );
  return new Map([...labels].map(([id, label]) => [id, formatLobbyLabel(label, renderWebName)]));
}

/** The chips, oldest opened first (the order is the night's, fixed: `lobbies` is already so). */
export function lobbyChips(snapshot: TonightSnapshot, viewerPuuid: string | null): LobbyChip[] {
  const tables = snapshot.lobbies ?? [];
  const labels = tableLabels(tables);
  return tables.map((table) => ({
    id: table.id,
    key: table.partyId,
    label: labels.get(table.id) ?? '',
    status: chipStatus(snapshot, table),
    mode: chipMode(snapshot, table),
    you: viewerPuuid !== null && table.lobby.members.some((member) => member.puuid === viewerPuuid),
  }));
}

function chipStatus(snapshot: TonightSnapshot, table: TableView): ChipStatus {
  const { lobby } = table;
  const preGame = lobby.status === 'open' || lobby.status === 'balanced';
  if (preGame && table.watched === false) return { kind: 'no-kustom' };
  if (lobby.status === 'in_game') return { kind: 'in-game', startedAt: lobby.startedAt };
  if (lobby.status === 'finished' && lobby.result !== null) {
    return { kind: 'won', side: lobby.result.winningSide === 100 ? 'blue' : 'red' };
  }
  const state = tonightState(snapshot, table.id);
  if (state.kind === 'filling') return { kind: 'filling', count: lobbyAround(lobby.members) };
  return { kind: 'teams' };
}

/** 14.4 "Mode": this game's rule once Roll locked it, else the pending rule, else the standing mode. */
function chipMode(snapshot: TonightSnapshot, table: TableView): string {
  const { lobby } = table;
  const standing = snapshot.modeRow?.standing ?? snapshot.mode;
  if ((lobby.status === 'balanced' || lobby.status === 'in_game') && lobby.lock != null) {
    const rule = ruleOf(lobby.lock.mode);
    return rule === null ? MODE_NAMES[lobby.lock.standing] : ruleLabel(rule);
  }
  const pending = table.card != null ? table.card.pending : (snapshot.modeRow?.pending ?? null);
  return pending === null ? MODE_NAMES[standing] : ruleLabel(pending);
}

/** The chip's status words at `now` (`In game · 12 min` ticks once a minute, never `mm:ss`). */
export function chipStatusText(status: ChipStatus, now: number): string {
  switch (status.kind) {
    case 'filling':
      return `${status.count} in`;
    case 'teams':
      return 'Teams set';
    case 'no-kustom':
      return 'No Kustom';
    case 'won':
      return status.side === 'blue' ? 'Blue won' : 'Red won';
    case 'in-game': {
      const ms = status.startedAt === null ? Number.NaN : now - Date.parse(status.startedAt);
      if (!Number.isFinite(ms)) return 'In game';
      const minutes = Math.floor(ms / 60_000);
      return minutes < 1 ? 'In game · just started' : `In game · ${minutes} min`;
    }
  }
}

/** 14.3: `Sat 3 Oct, 2 lobbies` in place of `Sat 3 Oct, game 4 tonight` while two or more are live. */
export function lobbiesDateLine(nightLabel: string, count: number): string {
  return `${shortNightLabel(nightLabel)}, ${count} lobbies`;
}

/** `both` for exactly two live lobbies, `every` for three or more (14.11). */
export function bothOrEvery(count: number): 'both' | 'every' {
  return count === 2 ? 'both' : 'every';
}

/** 14.5: the Mode card's lines while two or more are live. */
export function banListLine(count: number): string {
  return `One ban list for ${bothOrEvery(count)} lobb${count === 2 ? 'ies' : 'y'}.`;
}

export function banListInGameLine(count: number): string {
  return `This game's ten join the ban list for ${count === 2 ? 'both lobbies' : 'every lobby'} when it ends.`;
}

export function adminFootLines(label: string): string {
  return `A rule or Rated here is for ${label} only. Normal or Fearless is for every lobby.`;
}

export function panelHeadLine(count: number): string {
  return count === 2 ? 'Both lobbies add to this list.' : 'Every lobby adds to this list.';
}

/** `/g/<slug>/mode?lane=top` with `lobby=<id>` added (14.5: the panel keeps the selection). */
export function withLobby<T extends string>(href: T, lobbyId: string): T {
  return `${href}${href.includes('?') ? '&' : '?'}lobby=${encodeURIComponent(lobbyId)}` as T;
}

/** 14.8: a live table nobody's Kustom is watching any more. */
export const UNWATCHED_LEAD = 'Nobody with Kustom is in this lobby any more.';
export const UNWATCHED_REST = 'It closes in a few minutes unless someone with Kustom joins.';
export const UNWATCHED_IN_GAME =
  'Nobody with Kustom is in this game any more, so its result may not come in.';

/**
 * 14.6: the tape tile's lobby line, only on a night two tables overlapped: a live table's label,
 * else the tile's table's host (`tableHost`, `loadTonight`). Null: no line.
 */
export function tileLabel(
  entry: TapeEntry,
  tables: readonly TableView[],
  labels: Map<string, string>,
): string | null {
  const live = tables.find((table) => table.rowIds.includes(entry.lobbyId));
  if (live !== undefined) return labels.get(live.id) ?? null;
  if (entry.tableHost === undefined) return null;
  return formatLobbyLabel({ kind: 'host', name: entry.tableHost ?? '', repeat: 1 }, renderWebName);
}

/**
 * The announcer's line for a change of chips between two renders (14.9), or null. `tapped`: the
 * selection changed because this page's viewer tapped a chip.
 */
export function switcherAnnouncement(
  before: { chips: readonly LobbyChip[]; selected: string | null },
  after: { chips: readonly LobbyChip[]; selected: string | null },
  tapped: boolean,
): string | null {
  const keyOf = (chips: readonly LobbyChip[], id: string | null) => chips.find((chip) => chip.id === id)?.key;
  const shownBefore = keyOf(before.chips, before.selected);
  const shownAfter = after.chips.find((chip) => chip.id === after.selected);
  const ended = before.chips.find((chip) => !after.chips.some((next) => next.key === chip.key));
  if (ended !== undefined) {
    return ended.key === shownBefore && shownAfter !== undefined
      ? `${ended.label} has ended. Showing ${shownAfter.label}.`
      : `${ended.label} has ended.`;
  }
  const opened = after.chips.find((chip) => !before.chips.some((prev) => prev.key === chip.key));
  if (opened !== undefined && before.chips.length > 0) return `${opened.label} is open too.`;
  if (tapped && shownAfter !== undefined && shownAfter.key !== shownBefore)
    return `Showing ${shownAfter.label}.`;
  const mine = after.chips.find((chip) => chip.you && chip.id !== after.selected);
  const was = mine === undefined ? undefined : before.chips.find((chip) => chip.key === mine.key);
  if (mine !== undefined && was !== undefined && was.status.kind !== mine.status.kind) {
    if (mine.status.kind === 'teams') return 'Teams are set in your lobby.';
    if (mine.status.kind === 'won') return "Your lobby's game is over.";
  }
  return null;
}
