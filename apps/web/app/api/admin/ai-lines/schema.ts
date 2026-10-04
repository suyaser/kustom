import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * `POST /api/admin/ai-lines` (M16.3b; brief 1.5): the admins' `AI lines` switch for the body's group.
 * JSON from the admin home's switch; the group must be Premium.
 */
export const aiLinesRequestSchema = z.object({
  groupId: groupIdSchema,
  enabled: z.boolean(),
});

export type AiLinesRequest = z.infer<typeof aiLinesRequestSchema>;

export const aiLinesResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  enabled: z.boolean(),
});

export type AiLinesResponse = z.infer<typeof aiLinesResponseSchema>;
