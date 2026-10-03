import { z } from 'zod';
import { puuidSchema } from './common';
import { groupIdSchema, groupRoleSchema, groupSlugSchema } from './groups';

/**
 * Creating a group, its invite link, and pairing a PUUID (M13.5; `0021_invites_and_pairing.sql`).
 *
 * Three ways a person ends up in a group, and these are the payloads of the two the web adds
 * (the third is playing in it, M13.3):
 *
 * - **Create** (`POST /api/groups`): a signed-in person names a group and its link once, and is
 *   its first admin.
 * - **Join** (`POST /api/groups/join`): a signed-in person whose Discord is already on a `players`
 *   row opens the invite link and taps once.
 * - **Pair** (`POST /api/me/pairing`, then Kustom's `POST /api/companion/pair`): a signed-in person
 *   with no `players` row yet gets a six-character code, types it into Kustom, and Kustom sends it
 *   with the PUUID it reads from League. The PUUID always comes from the client, never typed.
 *
 * Joining never mints a companion token (decision 2026-09-23: tokens are for hosts).
 */

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** The pairing code's alphabet: upper case and digits without `0 O 1 I`, so nothing misreads. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 6;

/** How long a pairing code works: 15 minutes, single use. */
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

/** How often the page asks whether its code was used (no Realtime needed). */
export const PAIRING_STATUS_POLL_MS = 3000;

/**
 * Six characters of {@link PAIRING_CODE_ALPHABET}, exactly. Never upper-cased or trimmed here:
 * Kustom upper-cases and drops stray characters as they are typed (M13.7), so anything else
 * reaching the server is not a code.
 */
export const pairingCodeSchema = z
  .string()
  .regex(new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`), 'not a pairing code');

/** A group's invite code: 22 url-safe characters (`new_invite_code()`, 128 random bits). */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const inviteCodeSchema = z.string().regex(INVITE_CODE_PATTERN, 'not an invite code');

// ---------------------------------------------------------------------------
// The group as these routes answer it
// ---------------------------------------------------------------------------

/** The public face of a group: what `groups_public` holds. */
export const groupSummarySchema = z.object({
  id: groupIdSchema,
  slug: z.string(),
  name: z.string(),
});

export type GroupSummary = z.infer<typeof groupSummarySchema>;

// ---------------------------------------------------------------------------
// POST /api/groups
// ---------------------------------------------------------------------------

/**
 * Product's sentence for a slug that is reserved, too short, too long or not lower case (M13.5).
 * The page lower-cases as you type; the server never silently rewrites, so `Abc` is this 400.
 */
export const GROUP_SLUG_RULE = 'Use 3 to 32 lowercase letters, numbers or dashes.';

/**
 * A name that is empty after trimming, or longer than 40 characters. The brief gives the rule and
 * no sentence (`[copy owed]` in 05-design.md); this one is platform's, decision row 2026-10-03.
 */
export const GROUP_NAME_RULE = 'Use 1 to 40 characters.';

/** 1 to 40 characters after trimming, the same rule as `groups_name_length`. Trimmed on the way in. */
export const groupNameSchema = z
  .string({ error: GROUP_NAME_RULE })
  .trim()
  .min(1, GROUP_NAME_RULE)
  .max(40, GROUP_NAME_RULE);

export const createGroupRequestSchema = z.object({
  name: groupNameSchema,
  /** `groupSlugSchema`'s rule, answered with product's one sentence whatever part of it failed. */
  slug: z
    .string({ error: GROUP_SLUG_RULE })
    .refine((value) => groupSlugSchema.safeParse(value).success, GROUP_SLUG_RULE),
});

export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const createGroupResponseSchema = z.object({
  ok: z.literal(true),
  group: groupSummarySchema,
  /**
   * `admin` when the session was already linked to a player, who is now the group's first admin.
   * `null` for an unlinked creator: the group has no admin until they pair (`POST /api/me/pairing`
   * with this `group.id`), and that pairing makes them one.
   */
  role: groupRoleSchema.nullable(),
});

export type CreateGroupResponse = z.infer<typeof createGroupResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/groups/mine
// ---------------------------------------------------------------------------

export const myGroupSchema = groupSummarySchema.extend({ role: groupRoleSchema });

/** The session player's memberships, oldest first. Empty for a session with no linked player. */
export const myGroupsResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(myGroupSchema),
});

export type MyGroupsResponse = z.infer<typeof myGroupsResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/groups/join
// ---------------------------------------------------------------------------

export const joinGroupRequestSchema = z.object({
  /** The `/join/<code>` code. A rotated or unknown one is 404. */
  code: inviteCodeSchema,
});

export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;

export const joinGroupResponseSchema = z.object({
  ok: z.literal(true),
  group: groupSummarySchema,
  /** The caller's role now. An admin who opens the link stays admin. */
  role: groupRoleSchema,
  /** `joined` when this call made the membership; `already_member` when it was there. */
  outcome: z.enum(['joined', 'already_member']),
});

export type JoinGroupResponse = z.infer<typeof joinGroupResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/me/pairing
// ---------------------------------------------------------------------------

/**
 * Exactly one of the two: `groupId` for the group's creator (`/new`, unlinked), `inviteCode` for
 * a holder of the live invite (`/join/<code>`, not linked).
 */
export const pairingRequestSchema = z.union([
  z.strictObject({ groupId: groupIdSchema }),
  z.strictObject({ inviteCode: inviteCodeSchema }),
]);

export type PairingRequest = z.infer<typeof pairingRequestSchema>;

export const pairingResponseSchema = z.object({
  ok: z.literal(true),
  /** Shown once on the page, large. Stored only as its hash. */
  code: pairingCodeSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  /** The group the code joins, for the card's head. */
  group: groupSummarySchema,
});

export type PairingResponse = z.infer<typeof pairingResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/me/pairing/status?code=
// ---------------------------------------------------------------------------

export const pairingStatusQuerySchema = z.object({
  code: pairingCodeSchema,
});

/**
 * What became of a code this session was given. `used` carries the group so the page can move to
 * `/g/<slug>?joined=1` (or `/g/<slug>/admin?joined=1` after `/new`). A code this session was not
 * given, or one replaced by a newer code, is a 404.
 */
export const pairingStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({
    ok: z.literal(true),
    status: z.literal('waiting'),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  z.object({ ok: z.literal(true), status: z.literal('used'), group: groupSummarySchema }),
  z.object({ ok: z.literal(true), status: z.literal('expired') }),
]);

export type PairingStatusResponse = z.infer<typeof pairingStatusResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/companion/pair  (no token)
// ---------------------------------------------------------------------------

export const companionPairRequestSchema = z.object({
  code: pairingCodeSchema,
  /** Read by Kustom from `current-summoner` on the PC it runs on. Never typed by a person. */
  puuid: puuidSchema,
});

export type CompanionPairRequest = z.infer<typeof companionPairRequestSchema>;

export const companionPairResponseSchema = z.object({
  ok: z.literal(true),
  /** The group Kustom adds to its config (M13.8): `You're in <Group>.` */
  group: groupSummarySchema,
});

export type CompanionPairResponse = z.infer<typeof companionPairResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/invite/rotate
// ---------------------------------------------------------------------------

export const inviteRotateRequestSchema = z.object({
  /** The group. The caller must be an admin of it. */
  groupId: groupIdSchema,
  /** Where an HTML form post is sent back to (M13.14's invite card). */
  redirectTo: z.string().optional(),
});

export type InviteRotateRequest = z.infer<typeof inviteRotateRequestSchema>;

export const inviteRotateResponseSchema = z.object({
  ok: z.literal(true),
  groupId: groupIdSchema,
  /** The new code. The old one is a dead link from now on. */
  code: inviteCodeSchema,
});

export type InviteRotateResponse = z.infer<typeof inviteRotateResponseSchema>;
