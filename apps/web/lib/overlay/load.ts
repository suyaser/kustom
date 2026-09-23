/**
 * Overlay snapshot for one viewer (M12), read with the anon key.
 *
 * Composes {@link loadFearless}, tonight's posted teams, and all-time counted games for
 * with/against records. No companion token, no new tables.
 */

import { loadFearless } from '../fearless/load';
import type { PublicClient } from '../publicClient';
import { loadWindowGames } from '../stats/load';
import { loadTonight } from '../tonight/load';
import { nightTimeZone, tonightStart } from '../tonight/night';
import { overlayView, seatsFromTonight } from './fold';
import type { OverlayView } from './types';

export interface LoadOverlayOptions {
  puuid: string;
  now?: Date;
}

export async function loadOverlay(
  client: PublicClient,
  options: LoadOverlayOptions,
): Promise<OverlayView> {
  const now = options.now ?? new Date();
  const nightStart = tonightStart(now);
  const timeZone = nightTimeZone();

  const [fearless, tonight, window] = await Promise.all([
    loadFearless(client),
    loadTonight(client, { nightStart, timeZone }),
    loadWindowGames(client, { window: 'all-time', now, timeZone }),
  ]);

  const lobbyRow = tonight.lobby;
  const posted = lobbyRow?.teams ?? null;
  const seats = posted === null ? null : seatsFromTonight(posted.blue, posted.red);

  return overlayView({
    viewerPuuid: options.puuid,
    fearless: fearless.champions,
    resetAt: fearless.resetAt,
    lobby:
      lobbyRow === null
        ? null
        : {
            status: lobbyRow.status,
            blue: seats?.blue ?? [],
            red: seats?.red ?? [],
            hasPostedTeams: posted !== null,
          },
    games: window.games,
    players: window.players,
  });
}
