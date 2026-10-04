import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * `POST /api/admin/ai/hide` (M16.4; brief m16.1 1.5, D8): an admin's one-tap `Hide` of a published
 * AI line. The group is the body's (checked against the session's admin membership by the route
 * gate); the line must be that group's. `redirectTo` is where a no-JS form post goes back to.
 */
export const hideAiLineRequestSchema = z.object({
  groupId: groupIdSchema,
  lineId: z.guid(),
  redirectTo: z.string().max(500).optional(),
});

export type HideAiLineRequest = z.infer<typeof hideAiLineRequestSchema>;

/**
 * `hidden` is true when this request hid the line, false when there was no published line of the
 * group to hide (already hidden, rejected, not this group's). Either way it is not shown.
 */
export const hideAiLineResponseSchema = z.object({
  ok: z.literal(true),
  hidden: z.boolean(),
});

export type HideAiLineResponse = z.infer<typeof hideAiLineResponseSchema>;
