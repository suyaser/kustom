import { z } from 'zod';
import { groupIdSchema, groupRoleSchema } from './groups';
import { groupSummarySchema, inviteCodeSchema } from './invites';
import { groupPremiumSchema } from './premium';

/**
 * The operator (M13.6, folded into M14.19) and the admin reads it shares with group admins.
 *
 * The operator is a session whose verified auth user id is in the web server's
 * `SUPER_ADMIN_USER_IDS`. Nothing here names who that is: there is no column, row or migration for
 * it, only the env list. These schemas are the contract `/ops` and the read-only admin pages are
 * built against (Lane D, M14.23).
 */

/** The roles that pass the admin gate (`isAtLeast(role, 'admin')`). */
export const adminRoleSchema = groupRoleSchema.extract(['admin', 'owner']);

export type AdminRole = z.infer<typeof adminRoleSchema>;

/**
 * How the session reads this group's admin data.
 *
 * - `group_admin`: an admin or owner of the group (`role` says which); `readOnly` false.
 * - `operator`: on `SUPER_ADMIN_USER_IDS` and not an admin of this group; `readOnly` true -- the
 *   page renders every write control absent, with the read-only line.
 */
export const adminAccessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group_admin'), role: adminRoleSchema, readOnly: z.literal(false) }),
  z.object({ kind: z.literal('operator'), readOnly: z.literal(true) }),
]);

export type AdminAccess = z.infer<typeof adminAccessSchema>;

/**
 * The invite link as an admin read shows it (STRATEGY §3.3).
 *
 * - `shown`: the group's admins only. `url` is the absolute `/join/<code>` link.
 * - `none`: the group has no live code (an admin sees this; `New link` mints one).
 * - `hidden`: the operator, always -- whether a code exists or not, so the masked read does not
 *   even say that much. `message` is the sentence to print in the code's place.
 */
export const adminInviteViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('shown'), code: inviteCodeSchema, url: z.url(), rotatedAt: z.string() }),
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('hidden'), message: z.string().min(1) }),
]);

export type AdminInviteView = z.infer<typeof adminInviteViewSchema>;

/** `GET /api/admin/group?groupId=`: the admin home's header read. */
export const adminGroupQuerySchema = z.object({ groupId: groupIdSchema });

export type AdminGroupQuery = z.infer<typeof adminGroupQuerySchema>;

export const adminGroupResponseSchema = z.object({
  ok: z.literal(true),
  group: groupSummarySchema,
  access: adminAccessSchema,
  invite: adminInviteViewSchema,
});

export type AdminGroupResponse = z.infer<typeof adminGroupResponseSchema>;

/** One row of `GET /api/ops/groups`. Counts, timestamps and a flag; never the webhook itself. */
export const opsGroupSchema = z.object({
  id: groupIdSchema,
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
  /** Every membership row, whatever its role. */
  memberCount: z.number().int().nonnegative(),
  /** Memberships at `admin` or above (the owner counts). */
  adminCount: z.number().int().nonnegative(),
  /** `started_at` of the group's latest game, or null when it has none. */
  lastGameAt: z.string().nullable(),
  /** True when `discord_config.webhook_url` is set. The URL never leaves the server. */
  webhookSet: z.boolean(),
  /** Kustom Premium (M16.2), read-only here: the flag, when it last changed, the monthly cap. */
  premium: groupPremiumSchema,
  /**
   * M16.10: AI is on for the group and this month's budget no longer fits a call
   * (`aiPausedUntil` over `ai_month_spend`). Absent or false otherwise.
   */
  aiCapReached: z.boolean().optional(),
});

export type OpsGroup = z.infer<typeof opsGroupSchema>;

/** `GET /api/ops/groups`: every group, oldest first. */
export const opsGroupsResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(opsGroupSchema),
});

export type OpsGroupsResponse = z.infer<typeof opsGroupsResponseSchema>;
