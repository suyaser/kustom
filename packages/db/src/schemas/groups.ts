import { z } from 'zod';
import { GROUP_SLUG_PATTERN, isReservedGroupSlug } from '../constants';

/**
 * Groups (M13). A group is its own world -- lobbies, games, ratings, fearless list, daily guess,
 * Discord channel and admins -- while a person stays one `players` row keyed by PUUID across
 * every group they are in (`04-decisions.md`, 2026-10-03).
 *
 * Both schemas here mirror a check constraint in `0018_groups.sql`, and
 * `groups.integration.test.ts` runs one table of cases (`groupSlugCases.ts`) through both so they
 * cannot drift.
 */

// `ORIGINAL_GROUP_ID`, `RESERVED_GROUP_SLUGS` and `GROUP_SLUG_PATTERN` are defined in
// `../constants` (M14.44, zod-free so a browser can have them) and re-exported here unchanged.
export { GROUP_SLUG_PATTERN, ORIGINAL_GROUP_ID, RESERVED_GROUP_SLUGS } from '../constants';

/**
 * A `groups.id` in a request (M13.4). Every `/api/me/*` and `/api/admin/*` request carries one
 * -- in the body for a write, in the query for a read -- because a signed-in person can be in
 * several groups and a session alone does not name one. The server checks it against
 * `group_memberships` for the session's player; the id itself grants nothing.
 *
 * **`z.guid()`, not `z.uuid()`.** zod's `uuid()` checks the RFC 9562 version and variant nibbles,
 * and the original group's fixed id `00000000-0000-0000-0000-000000000001` has neither (version
 * 0): `z.uuid()` refuses the one group that exists. `guid()` is the 8-4-4-4-12 hex shape Postgres's
 * `uuid` type itself accepts. Every schema that carries a group id uses this one.
 */
export const groupIdSchema = z.guid();

/**
 * `group_memberships.role`: the discriminated union, never a boolean. Lowest first, so the order
 * is the rank {@link isAtLeast} compares (M14.11: `owner` above `admin`). Exactly one `owner` per
 * group (`group_memberships_one_owner_idx`, `0023`).
 */
export const GROUP_ROLES = ['member', 'admin', 'owner'] as const;

export const groupRoleSchema = z.enum(GROUP_ROLES);

export type GroupRole = z.infer<typeof groupRoleSchema>;

/**
 * True when `role` is `minimum` or above it. `isAtLeast(role, 'admin')` is the admin gate -- an
 * owner is an admin and more -- and replaces every exact `role === 'admin'` (M14.11). `null` (not a
 * member) is never at least anything.
 */
export function isAtLeast(role: GroupRole | null | undefined, minimum: GroupRole): boolean {
  if (role === null || role === undefined) return false;
  return GROUP_ROLES.indexOf(role) >= GROUP_ROLES.indexOf(minimum);
}

/**
 * The roles `POST /api/admin/members/role` may set. Not `owner`: ownership only moves by
 * `POST /api/admin/owner/transfer`, so there is always exactly one.
 */
export const ASSIGNABLE_GROUP_ROLES = ['member', 'admin'] as const;

export const assignableGroupRoleSchema = z.enum(ASSIGNABLE_GROUP_ROLES);

export type AssignableGroupRole = z.infer<typeof assignableGroupRoleSchema>;

/**
 * A group's `/g/<slug>` path segment. No trimming and no lowercasing: the check constraint does
 * neither, and a schema that quietly fixed `Abc` into `abc` would accept a slug the database
 * refuses. Immutable once a group exists (decision row 2026-10-03).
 */
export const groupSlugSchema = z
  .string()
  .regex(
    GROUP_SLUG_PATTERN,
    'slug is 3 to 32 lowercase letters, digits and dashes, not starting or ending with a dash',
  )
  .refine((value) => !isReservedGroupSlug(value), 'slug is a reserved word');

export type GroupSlug = z.infer<typeof groupSlugSchema>;

/**
 * `GET /api/overlay/groups?puuid=` (M13.3): the groups a PUUID is a member of, oldest membership
 * first. No token -- a public read like `GET /api/overlay`. Kustom's overlay mode (M13.8) asks
 * this to know which `group` to pass, and asks nothing when the list has one entry.
 */
export const overlayGroupsQuerySchema = z.object({
  puuid: z.string().min(1).max(128),
});

export const overlayGroupSchema = z.object({
  /** `groupIdSchema`, not `z.uuid()`: the original group's fixed id is not a v1-v8 uuid. */
  id: groupIdSchema,
  slug: z.string(),
  name: z.string(),
});

export const overlayGroupsResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(overlayGroupSchema),
});

export type OverlayGroupsResponse = z.infer<typeof overlayGroupsResponseSchema>;
