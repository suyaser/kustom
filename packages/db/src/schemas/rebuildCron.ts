import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * `GET /api/cron/rebuild` (M14.63): the daily fold that rates backfilled games.
 *
 * One line per group that had an unrated backfilled game when the cron looked; a group with
 * nothing waiting is not listed.
 *
 * - `rated`: the group was folded (after at most two re-runs on the fence).
 * - `blocked`: the guard said no (a live lobby, or a game in the last 15 minutes); tomorrow's run
 *   tries again.
 * - `fenced`: games kept landing through every re-run; tomorrow's run tries again.
 * - `deferred`: the run was out of time before this group's turn; tomorrow's run tries again.
 * - `failed`: the fold threw; the next group still ran.
 *
 * A `rated` line with a `reason` is a fold that wrote and also named a data problem (the
 * command's exit 1), such as the same player twice on a scoreboard.
 */
export const rebuildCronGroupSchema = z.object({
  groupId: groupIdSchema,
  status: z.enum(['rated', 'blocked', 'fenced', 'deferred', 'failed']),
  /** Games the fold rated, when it ran to the end. */
  ratedGames: z.number().int().nonnegative().nullable(),
  /** Unrated backfilled games the cron found waiting in this group. */
  pendingGames: z.number().int().positive(),
  /** Why it did not finish, when it did not. */
  reason: z.string().nullable(),
});

export const rebuildCronResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(rebuildCronGroupSchema),
});

export type RebuildCronGroup = z.infer<typeof rebuildCronGroupSchema>;
export type RebuildCronResponse = z.infer<typeof rebuildCronResponseSchema>;
