import type { RoleValue } from '@customs/db';
import { groupBase } from '../nav';
import type { PublicClient } from '../publicClient';
import { loadWindowGames } from '../stats/load';
import type { PlayerRef, StatsGame, StatsPlayer } from '../stats/types';
import { renderWebName } from '../tonight/copy';
import { headToHead, versusGames } from './fold';

/**
 * You vs them (M14.35): your record with and against each person in one group, all time, counted
 * Summoner's Rift games only. **One fold, two placements**: the card on someone else's player page
 * and the everyone list on `/you` both come from {@link youVsEveryone}, which runs the 1v1 page's
 * own `headToHead` (M7.x's Pick two) for every pair, so the card, the list row and Pick two can
 * never disagree.
 */

/** A win-loss pair from the viewer's side. */
export interface WinLoss {
  wins: number;
  losses: number;
}

/** One lane where the two met in the same role, from the viewer's side. */
export interface YouLane {
  role: RoleValue;
  /** The viewer's wins and the other person's wins in that lane. */
  you: number;
  them: number;
}

export interface YouVersusRow {
  them: PlayerRef;
  /** On the same side. */
  together: WinLoss;
  /** On opposite sides. */
  against: WinLoss;
  /** Same role, opposite sides, in lane order. */
  lanes: YouLane[];
  /** Games together plus games against: the list's order. */
  games: number;
}

/**
 * Everyone the viewer has played with or against, most games first (then name, then puuid, so the
 * order is stable). `viewerPuuid` not in the window is an empty list.
 */
export function youVsEveryone(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
  viewerPuuid: string,
): YouVersusRow[] {
  const counted = versusGames(games);
  const viewer = players.find((player) => player.puuid === viewerPuuid);
  if (viewer === undefined) return [];

  const met = new Set<string>();
  for (const game of counted) {
    if (!game.rows.some((row) => row.playerId === viewer.playerId)) continue;
    for (const row of game.rows) if (row.playerId !== viewer.playerId) met.add(row.playerId);
  }

  const rows: YouVersusRow[] = [];
  for (const other of players) {
    if (!met.has(other.playerId)) continue;
    const pair = headToHead(counted, players, viewer.playerId, other.playerId);
    if (pair === null) continue;
    rows.push({
      them: pair.b,
      together: { wins: pair.allyWins, losses: pair.allyLosses },
      against: { wins: pair.aWins, losses: pair.bWins },
      lanes: pair.lanes.map((lane) => ({ role: lane.role, you: lane.aWins, them: lane.bWins })),
      games: pair.allies + pair.enemies,
    });
  }
  return rows
    .filter((row) => row.games > 0)
    .sort(
      (a, b) =>
        b.games - a.games ||
        renderWebName(a.them.name).localeCompare(renderWebName(b.them.name)) ||
        (a.them.puuid < b.them.puuid ? -1 : 1),
    );
}

/** The card's row for one person, from the same list. `null` is "never played with or against". */
export function youVsOne(rows: readonly YouVersusRow[], puuid: string): YouVersusRow | null {
  return rows.find((row) => row.them.puuid === puuid) ?? null;
}

/**
 * The read: the viewer's all-time games in the group (with the mode, so ARAM drops out), and the
 * fold. A failed read is the caller's to handle (the page shows no card rather than failing).
 */
export async function loadYouVersus(
  client: PublicClient,
  options: { groupId: string; viewerPuuid: string; timeZone?: string },
): Promise<YouVersusRow[]> {
  const { games, players } = await loadWindowGames(
    client,
    {
      window: 'all-time',
      groupId: options.groupId,
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    },
    // Only the viewer's games (and every row of them): every row below is a game they played.
    { withGameMode: true, onlyPuuid: options.viewerPuuid },
  );
  return youVsEveryone(games, players, options.viewerPuuid);
}

/** Stats → 1v1 → Pick two with both people filled in (M14.17's `?a=&b=`). */
export function pickTwoHref(group: { slug: string }, you: string, them: string): string {
  return `${groupBase(group)}/stats/1v1?${new URLSearchParams({ a: you, b: them }).toString()}`;
}
