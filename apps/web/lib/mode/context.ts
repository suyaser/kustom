import type { ChampionTable, Rng, StandingModeId, TransitionContext } from '@customs/core';
import { loadFearless } from '../fearless/load';
import type { ServiceClient } from '../supabase';
import { championTable, regionIds } from './champions';
import { serverRng } from './rng';

/**
 * What core's `transition`, `lockTransition` and `take` read (M20.7): the champion table, the
 * region list, the group's Fearless pool and the server's RNG. Core counts the pool only when the
 * target's standing mode is Fearless, so the pool is read only then (one query saved on a Normal
 * night). The browser never chooses (R3): the RNG is `node:crypto`'s unless a test pins it.
 */
export interface ModeContextOptions {
  rng?: Rng;
  table?: ChampionTable;
  /** False for a lock taken at game start: champion select is over, so no ban makes the shown pair short. */
  bans?: boolean;
}

export async function modeContext(
  client: ServiceClient,
  groupId: string,
  standing: StandingModeId,
  options: ModeContextOptions = {},
): Promise<TransitionContext> {
  const fearlessPool =
    standing === 'fearless' && options.bans !== false
      ? (await loadFearless(client, groupId)).champions.map((champion) => champion.id)
      : [];
  return {
    roster: options.table ?? championTable(),
    regions: regionIds(),
    fearlessPool,
    rng: options.rng ?? serverRng,
  };
}
