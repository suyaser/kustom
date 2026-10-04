import 'server-only';
import type { Calibration } from '@customs/core';
import { cachedRead } from '../cache/cached';
import { groupTag } from '../cache/tags';
import { createPublicClient } from '../publicClient';
import { readGroupCalibration } from './read';

/**
 * The group's calibration line, cached across requests (app-perf, 2026-10-04). It is the same for
 * every viewer (anon reads only, no session, no filter) and moves only when a game lands, is
 * re-rated or its lobby is re-rolled, yet it reads the group's whole history in four rounds, on
 * every Games list and every game page.
 *
 * Tagged `games:<groupId>`. The writers that move its data drop it through `invalidateGroup`
 * (`lib/cache/tags.ts`): the eog ingest (`lib/ingest/game.ts`), the rating fold
 * (`lib/ingest/rating.ts`), the rebuild (`lib/ingest/rebuild.ts`), Roll (`lib/ingest/balance.ts`)
 * and Reroll (`promoteSplit`, `lib/admin/reroll.ts`). The Rated switch and Reset ratings do not
 * touch its data (Reset ratings drops `games:` for its other slices, which costs this one read).
 * Five minutes at most in any case, the landing's rule: nobody needs the line fresher than a game
 * takes to play.
 */
export const CALIBRATION_TTL_S = 300;

export const cachedGroupCalibration: (groupId: string) => Promise<Calibration> = cachedRead(
  'group-calibration-v1',
  (groupId: string) => readGroupCalibration(createPublicClient(), groupId),
  { tags: (groupId) => [groupTag('games', groupId)], revalidate: CALIBRATION_TTL_S },
);
