import { groupIdSchema, groupRoleSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { idSchema, internalPathSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/members/role` (M13.4): make a member of the group an admin of it, or back.
 *
 * The **target state**, not a toggle — the same reason as `/admin/players`' `set-admin`: a form
 * that has sat open in a tab cannot flip the wrong way. A group can never be left with no admin,
 * so demoting the last one is a 409 with product's sentence and nothing is written.
 */
export const memberRoleRequestSchema = z.object({
  /** The group. The caller must be an admin of it. */
  groupId: groupIdSchema,
  /** `players.id` of a member of that group. Anybody else is a 404. */
  playerId: idSchema,
  role: groupRoleSchema,
  /** Where an HTML form post is sent back to, when it is not `/admin/players`. */
  redirectTo: internalPathSchema.optional(),
});

export type MemberRoleRequest = z.infer<typeof memberRoleRequestSchema>;

export const memberRoleResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  playerId: z.uuid(),
  /** The member's role now. */
  role: groupRoleSchema,
  /** False for a repeat press: they already had that role and nothing was written. */
  changed: z.boolean(),
});

export type MemberRoleResponse = z.infer<typeof memberRoleResponseSchema>;
