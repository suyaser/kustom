import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * `POST /api/me/ai-opt-out` (M16.3b; brief 1.4, D6): the signed-in player's own `Write about me` in
 * the body's group. The player is the session's, never the body's. Stored inverted as
 * `group_memberships.ai_opt_out`.
 */
export const meAiOptOutRequestSchema = z.object({
  groupId: groupIdSchema,
  writeAboutMe: z.boolean(),
});

export type MeAiOptOutRequest = z.infer<typeof meAiOptOutRequestSchema>;

export const meAiOptOutResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  writeAboutMe: z.boolean(),
});

export type MeAiOptOutResponse = z.infer<typeof meAiOptOutResponseSchema>;
