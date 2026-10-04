import 'server-only';
import type { Calibration } from '@customs/core';
import { unstable_cache } from 'next/cache';
import { groupTag } from '../cache/tags';
import { createPublicClient } from '../publicClient';
import { readGroupCalibration } from './read';

/**
 * The group's calibration line, cached across requests (app-perf, 2026-10-04). It is the same for
 * every viewer (anon reads only, no session, no filter) and moves only when a game lands, is
 * re-rated or its lobby is re-rolled, yet it reads the group's whole history in four rounds, on
 * every Games list and every game page.
 *
 * Tagged `games:<groupId>` (the ingest, the rebuild and the rated switch drop it through
 * `invalidateGroup`), and five minutes at most in any case, the landing's rule: nobody needs the
 * line fresher than a game takes to play.
 */
export const CALIBRATION_TTL_S = 300;

export function cachedGroupCalibration(groupId: string): Promise<Calibration> {
  return unstable_cache(
    () => readGroupCalibration(createPublicClient(), groupId),
    ['group-calibration-v1', groupId],
    { tags: [groupTag('games', groupId)], revalidate: CALIBRATION_TTL_S },
  )();
}
