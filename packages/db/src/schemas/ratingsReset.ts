import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * `POST /api/admin/ratings/reset` (M14.18, STRATEGY §3.6): the owner's `Reset ratings`.
 *
 * Session-gated by `/api/admin/*`'s gate (an admin or the owner of `groupId`); the owner check is
 * repeated inside `reset_group_ratings()` (`0027`) under the group's row lock. `confirmSlug` is
 * what the owner typed into the confirm dialog and must equal the group's slug, **checked on the
 * server**, not only in the page.
 */
export const ratingsResetRequestSchema = z.object({
  groupId: groupIdSchema,
  /** Typed by hand; compared exactly (after trimming) with `groups.slug`. */
  confirmSlug: z.string().trim().max(64),
  redirectTo: z.string().optional(),
});

export type RatingsResetRequest = z.infer<typeof ratingsResetRequestSchema>;

export const ratingsResetResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  /** The new epoch (`groups.ratings_since`), ISO. */
  ratingsSince: z.string(),
  /** Whether the Discord post landed (`posted`), had nowhere to go (`skipped`) or failed. */
  post: z.enum(['posted', 'skipped', 'failed']),
});

export type RatingsResetResponse = z.infer<typeof ratingsResetResponseSchema>;
