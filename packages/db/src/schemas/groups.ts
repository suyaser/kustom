import { z } from 'zod';

/**
 * Groups (M13). A group is its own world -- lobbies, games, ratings, fearless list, daily guess,
 * Discord channel and admins -- while a person stays one `players` row keyed by PUUID across
 * every group they are in (`04-decisions.md`, 2026-10-03).
 *
 * Both schemas here mirror a check constraint in `0018_groups.sql`, and
 * `groups.integration.test.ts` runs one table of cases (`groupSlugCases.ts`) through both so they
 * cannot drift.
 */

/**
 * The group everything that existed before M13 belongs to, with the fixed id `0018_groups.sql`
 * gives it. Its slug is `customs` and its name `Customs Night`.
 *
 * It was the temporary column default of every `group_id` until M13.4's `0020` dropped them; it
 * is still what the pages that have not moved under `/g/<slug>` yet (M13.9 to M13.14) send as
 * their `groupId`.
 */
export const ORIGINAL_GROUP_ID = '00000000-0000-0000-0000-000000000001';

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

/** `group_memberships.role`: the discriminated union, never a boolean. */
export const GROUP_ROLES = ['member', 'admin'] as const;

export const groupRoleSchema = z.enum(GROUP_ROLES);

export type GroupRole = z.infer<typeof groupRoleSchema>;

/**
 * Words the app's own routes use under `/g/` or at the root, refused as slugs. The same list as
 * `groups_slug_not_reserved`. `og` and `g` already fail the length rule; they are listed so the
 * list is the list.
 */
export const RESERVED_GROUP_SLUGS = ['new', 'join', 'admin', 'api', 'og', 'auth', 'ops', 'g'] as const;

/**
 * 3 to 32 lowercase letters, digits and dashes, not starting or ending with a dash -- the same
 * pattern as `groups_slug_shape`. The 32-character cap is load-bearing: a uuid is 36, so a slug
 * can never look like the `/g/<gameId>` links M11.4 already put in Discord.
 */
export const GROUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

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
  .refine((value) => !(RESERVED_GROUP_SLUGS as readonly string[]).includes(value), 'slug is a reserved word');

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
