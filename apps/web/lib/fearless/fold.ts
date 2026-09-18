import type { SideValue } from '@customs/db';
import { NO_BAN } from '../champs/names';
import { matchesQueue } from '../games/queue';
import { gateGame } from '../ingest/fold';

/**
 * Unique champion ids from counted Summoner's Rift games, first-appearance order (M10).
 *
 * No I/O, no clock: the loader walks `started_at > reset_at` and hands this the rows. ARAM
 * is dropped here (`matchesQueue(..., 'sr')`), remakes and short games by {@link gateGame}.
 * A missing `champion_id` is a skipped seat, not a skipped game.
 *
 * The companion never writes this list. Nothing here touches champion select.
 */

export interface FearlessSeat {
  /** Uniqueness key for {@link gateGame}. `game_players.player_id` is enough. */
  puuid: string;
  side: SideValue;
  championId: number | null;
}

export interface FearlessGame {
  durationS: number;
  /** Client `gameMode` off `games.raw`, already uppercased by the loader, or null. */
  gameMode: string | null;
  players: readonly FearlessSeat[];
}

export function foldFearless(games: readonly FearlessGame[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];

  for (const game of games) {
    if (!matchesQueue(game.gameMode, 'sr')) continue;
    if (!gateGame(game.players, game.durationS).ok) continue;

    for (const player of game.players) {
      const id = player.championId;
      if (id === null || id === NO_BAN) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}
