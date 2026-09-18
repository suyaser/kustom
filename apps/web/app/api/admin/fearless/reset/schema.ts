import { z } from 'zod';
import { internalPathSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/fearless/reset`: move the fearless cursor to now (M10).
 *
 * No body is required. `redirectTo` is only for the no-JS form path, same as reroll.
 */
export const fearlessResetRequestSchema = z.object({
  redirectTo: internalPathSchema.optional(),
});

export type FearlessResetRequest = z.infer<typeof fearlessResetRequestSchema>;

export const fearlessResetResponseSchema = z.object({
  ok: z.literal(true),
  resetAt: z.string(),
  post: z.enum(['posted', 'skipped', 'failed']),
});

export type FearlessResetResponse = z.infer<typeof fearlessResetResponseSchema>;
