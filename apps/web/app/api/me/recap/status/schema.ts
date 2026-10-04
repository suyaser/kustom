import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * `GET /api/me/recap/status?groupId=&gameId=` (M19.16): has this game's AI recap line landed? The
 * recap waiter asks this instead of re-rendering the page, and asks for one refresh on `true`
 * (M19.17).
 */
export const recapStatusQuerySchema = z.object({
  /** The group the page is showing. The session's player must be a member of it. */
  groupId: groupIdSchema,
  /** `games.id` of the finished game the page shows. */
  gameId: z.guid(),
});

export type RecapStatusQuery = z.infer<typeof recapStatusQuerySchema>;

export const recapStatusResponseSchema = z.object({
  /**
   * The group's AI gate is open (Premium, AI lines on) and a published line exists for this game in
   * this group. Whether the page then draws it (opt-outs, names) is the page's render; a hidden
   * line is `false`.
   */
  landed: z.boolean(),
});

export type RecapStatusResponse = z.infer<typeof recapStatusResponseSchema>;
