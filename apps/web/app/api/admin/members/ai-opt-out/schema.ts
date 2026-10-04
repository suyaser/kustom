import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * `POST /api/admin/members/ai-opt-out` (M16.3b; brief 1.4, D6): an admin's `Don't write about <Name>`
 * for a member of the body's group. `optOut` is in the body so the one-way rule is the server's to
 * refuse (`setAiOptOut`: an admin may set true, never false), not a shape the client could forget.
 */
export const memberAiOptOutRequestSchema = z.object({
  groupId: groupIdSchema,
  playerId: z.uuid(),
  optOut: z.boolean(),
});

export type MemberAiOptOutRequest = z.infer<typeof memberAiOptOutRequestSchema>;

export const memberAiOptOutResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  playerId: z.uuid(),
  optOut: z.literal(true),
});

export type MemberAiOptOutResponse = z.infer<typeof memberAiOptOutResponseSchema>;
