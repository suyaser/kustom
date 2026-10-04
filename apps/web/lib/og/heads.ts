import { cache } from 'react';
import { formatMinutes } from '../games/duration';
import { formatNightLabel, nightStart } from '../night';
import { createPublicClient } from '../publicClient';
import type { PlayerName } from '../tonight/types';
import { isGameId } from './load';

/**
 * What the player and game pages' `<title>` and share card need, and nothing else (performance
 * plan, phase 1): one small anon read each, React-cached per request.
 *
 * `generateMetadata` runs on every prefetch of those pages, and it used to run the page's whole
 * loader (11 and 8 queries). A link on a live page was prefetched again on every refresh, so the
 * title alone cost more than the page that showed the link. Now a prefetch costs one query, and
 * the page's own render pays for its loader once.
 *
 * Same words as before: the player's newest name (`display_name`, then `game_name`, the board's
 * `selectPlayer` rule, no same-name suffix, as the title never had one), and a game's
 * `Blue won · 32 min` with its night, from the same helpers `loadGameDetail` uses. Null means
 * "no such row": the caller falls back to the group's own title, as it did. A failed read is null
 * too, logged; a title never fails a page.
 */

export interface PlayerHead {
  puuid: string;
  name: PlayerName;
}

export const loadPlayerHead = cache(async (puuid: string): Promise<PlayerHead | null> => {
  const { data, error } = await createPublicClient()
    .from('players_public')
    .select('puuid, display_name, game_name')
    .eq('puuid', puuid)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('heads: player title lookup failed', error.message);
    return null;
  }
  if (data === null || data.puuid === null) return null;
  return { puuid: data.puuid, name: data.display_name ?? data.game_name ?? null };
});

export interface GameHead {
  gameId: string;
  winningSide: 100 | 200;
  durationLabel: string;
  nightLabel: string;
}

export const loadGameHead = cache(
  async (gameId: string, groupId: string, timeZone: string): Promise<GameHead | null> => {
    if (!isGameId(gameId)) return null;
    const { data, error } = await createPublicClient()
      .from('games')
      .select('id, started_at, duration_s, winning_side')
      .eq('id', gameId)
      .eq('group_id', groupId)
      .maybeSingle();
    if (error) {
      console.error('heads: game title lookup failed', error.message);
      return null;
    }
    if (data === null || (data.winning_side !== 100 && data.winning_side !== 200)) return null;
    const started = new Date(data.started_at);
    return {
      gameId: data.id,
      winningSide: data.winning_side,
      durationLabel: formatMinutes(data.duration_s),
      nightLabel: formatNightLabel(nightStart(started, timeZone), timeZone),
    };
  },
);
