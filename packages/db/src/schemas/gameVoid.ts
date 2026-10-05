import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * `POST /api/admin/void-game` (M23.1): an admin's `Void game` (take a game out of ratings) or
 * `Restore` (put it back). The group is the body's, checked against the session's admin-or-owner
 * membership by the route gate; the game must be that group's. `redirectTo` is where a no-JS form
 * post goes back to.
 */
export const gameVoidRequestSchema = z.object({
  groupId: groupIdSchema,
  gameId: z.guid(),
  action: z.enum(['void', 'restore']),
  redirectTo: z.string().max(500).optional(),
});

export type GameVoidRequest = z.infer<typeof gameVoidRequestSchema>;

/**
 * `voided` is the game's state after the request. `changed` is false when it already was (a second
 * tap). `folded` is whether the group's ratings were rebuilt after the change.
 */
export const gameVoidResponseSchema = z.object({
  ok: z.literal(true),
  voided: z.boolean(),
  changed: z.boolean(),
  folded: z.boolean(),
});

export type GameVoidResponse = z.infer<typeof gameVoidResponseSchema>;
