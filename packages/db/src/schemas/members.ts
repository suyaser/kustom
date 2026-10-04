import { z } from 'zod';
import { assignableGroupRoleSchema, groupIdSchema, groupRoleSchema } from './groups';

/**
 * Who runs a group (M14.11, `redesign/STRATEGY.md` §3.5): the three admin writes on a group's
 * people. Every one is session-gated by `/api/admin/*`'s gate (an admin or the owner of the body's
 * `groupId`), and every one is re-checked inside its `security definer` function under the group's
 * row lock (`0023`), which is where the owner-only rules live.
 *
 *   POST /api/admin/members/role       member <-> admin. Admins promote; only the owner demotes an
 *                                      admin (an admin may step down themselves); nobody demotes
 *                                      the owner.
 *   POST /api/admin/members/remove     admins remove members; the owner removes admins; nobody
 *                                      removes the owner. Their tokens in the group stop; their
 *                                      games and rating stay.
 *   POST /api/admin/owner/transfer     the owner hands the group to an admin and stays an admin.
 *
 * `redirectTo` is where an HTML form post is sent back to; the handler only follows a path on this
 * site (`safeNextPath`), so anything else falls back to the route's default page.
 */

/** `players.id`. A player who is not a member of the body's group is a 404, never a 403. */
const memberIdSchema = z.uuid();

// ---------------------------------------------------------------------------
// POST /api/admin/members/role
// ---------------------------------------------------------------------------

/**
 * The **target state**, not a toggle: a form that sat open in a tab cannot flip the wrong way.
 * `owner` is not settable here (`assignableGroupRoleSchema`): ownership moves only by transfer.
 */
export const memberRoleRequestSchema = z.object({
  /** The group. The caller must be an admin or the owner of it. */
  groupId: groupIdSchema,
  playerId: memberIdSchema,
  role: assignableGroupRoleSchema,
  redirectTo: z.string().optional(),
});

export type MemberRoleRequest = z.infer<typeof memberRoleRequestSchema>;

export const memberRoleResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  playerId: z.uuid(),
  /** The member's role now. */
  role: assignableGroupRoleSchema,
  /** False for a repeat press: they already had that role and nothing was written. */
  changed: z.boolean(),
});

export type MemberRoleResponse = z.infer<typeof memberRoleResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/members/remove
// ---------------------------------------------------------------------------

export const memberRemoveRequestSchema = z.object({
  groupId: groupIdSchema,
  playerId: memberIdSchema,
  redirectTo: z.string().optional(),
});

export type MemberRemoveRequest = z.infer<typeof memberRemoveRequestSchema>;

/**
 * A repeat press (the player is already gone) is the 404 of a non-member, not a second success:
 * the membership is the thing named, and it no longer exists.
 */
export const memberRemoveResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  playerId: z.uuid(),
});

export type MemberRemoveResponse = z.infer<typeof memberRemoveResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/owner/transfer
// ---------------------------------------------------------------------------

export const ownerTransferRequestSchema = z.object({
  groupId: groupIdSchema,
  /** The admin who becomes the owner. A member must be made an admin first (409). */
  playerId: memberIdSchema,
  redirectTo: z.string().optional(),
});

export type OwnerTransferRequest = z.infer<typeof ownerTransferRequestSchema>;

export const ownerTransferResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  /** The owner now. */
  ownerId: z.uuid(),
  /** The caller's role now: `admin` after a handover, `owner` when they named themselves. */
  role: groupRoleSchema,
  /** False when the owner named themselves: nothing was written. */
  changed: z.boolean(),
});

export type OwnerTransferResponse = z.infer<typeof ownerTransferResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/members/unlink-discord (M14.60)
// ---------------------------------------------------------------------------

/**
 * Undo a Discord account linked to the wrong player (a mistaken `That's me`). Clears
 * `players.discord_id` and nothing else: ratings, games and memberships stay. A Discord link
 * belongs to the **player**, not the membership, so it is gone in every group they are in.
 *
 * Who may: the owner unlinks anybody; an admin unlinks members and themselves, never the owner,
 * and never another admin in a group that has an owner (mirroring remove and demote). In a group
 * with no owner yet (M13.4's rules) admins unlink admins.
 */
export const memberUnlinkDiscordRequestSchema = z.object({
  groupId: groupIdSchema,
  playerId: memberIdSchema,
  redirectTo: z.string().optional(),
});

export type MemberUnlinkDiscordRequest = z.infer<typeof memberUnlinkDiscordRequestSchema>;

export const memberUnlinkDiscordResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  playerId: z.uuid(),
  /** False for a repeat press: the player had no Discord linked and nothing was written. */
  changed: z.boolean(),
});

export type MemberUnlinkDiscordResponse = z.infer<typeof memberUnlinkDiscordResponseSchema>;
