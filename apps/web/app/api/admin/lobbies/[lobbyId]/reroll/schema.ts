import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { idSchema, internalPathSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/lobbies/[lobbyId]/reroll`: promote one of the lobby's stored splits and
 * post it again (M3.2).
 *
 * The body **names the split it means**. Never "next", never "random": naming the target is
 * what makes a double tap on a slow phone harmless, where a `next` endpoint would skip a
 * split the group never saw. There is no random reroll in this product — core returns three
 * ranked splits and an admin promotes one of them.
 */
export const rerollRequestSchema = z.object({
  /**
   * The group the lobby belongs to (M13.4). The caller must be an admin of it, and a lobby of any
   * other group is the same 404 as a lobby that does not exist.
   */
  groupId: groupIdSchema,
  /** `splits.id`. The lobby comes from the path, so a split of another lobby is a 404. */
  splitId: idSchema,
  /**
   * Where an HTML form post is sent back to, when it is not `/admin` (M3.4).
   *
   * There are two reroll controls now — `/admin` and the tonight page — and only the form
   * path needs this: the tonight page normally posts JSON, gets the envelope, and never
   * navigates, because the promoted split arrives over Realtime. Its no-JavaScript fallback
   * is a real form, and landing that friend on `/admin` after pressing a button on `/` would
   * be the page answering a question nobody asked.
   *
   * Validated as a path on this site by `safeNextPath` before it is used, so a body cannot
   * turn this route into an open redirect; anything else falls back to the route's own
   * `redirectTo`. A JSON caller may send it and it changes nothing.
   */
  redirectTo: internalPathSchema.optional(),
});

export type RerollRequest = z.infer<typeof rerollRequestSchema>;

export const rerollResponseSchema = z.object({
  ok: z.literal(true),
  lobbyId: z.uuid(),
  splitId: z.uuid(),
  /** `splits.rank` of the split now on the board: 1 is the balancer's own choice. */
  rank: z.number().int().min(1),
  /** How many splits this lobby stored, so a caller can render "reroll 1 of 2" itself. */
  splitCount: z.number().int().min(1),
  /** False when that split was already chosen: nothing moved, and nothing was posted. */
  promoted: z.boolean(),
  /**
   * What Discord did with the re-post, or `null` when there was nothing to post.
   *
   * The promotion stands whatever this says (M3.2): a webhook that is down costs the group a
   * message, never the teams, and there is no retry loop behind it.
   */
  post: z.enum(['posted', 'skipped', 'failed']).nullable(),
});

export type RerollResponse = z.infer<typeof rerollResponseSchema>;
