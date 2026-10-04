import type { RoleValue } from './schemas/common';

/**
 * `@customs/db/constants` (M14.44): the values a browser may import from this package, with **no
 * zod**. Everything else here reaches zod through `./schemas`, and one client import of
 * `@customs/db` or `@customs/db/schemas` once put zod and every schema (87 KB gzip) on every
 * route of the web app (`redesign/quality/REPORT.md` P2).
 *
 * Each value is defined here once and re-exported unchanged from where it always lived
 * (`./schemas/groups`, `./schemas/companion`), so no existing import moves. This file may import
 * types and zod-free modules only; `apps/web/lib/clientGraph.test.ts` fails if a client component
 * reaches zod through it.
 */

export { rosterKey } from './rosterKey';

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

/** True when `value` is one of {@link RESERVED_GROUP_SLUGS}. */
export function isReservedGroupSlug(value: string): boolean {
  return (RESERVED_GROUP_SLUGS as readonly string[]).includes(value);
}

/**
 * True for exactly the strings `groupSlugSchema` accepts: the pattern, and not a reserved word.
 * `groupSlugSchema` is built from the same two checks, so the two cannot drift.
 */
export function isGroupSlug(value: string): boolean {
  return GROUP_SLUG_PATTERN.test(value) && !isReservedGroupSlug(value);
}

/**
 * `detectedTeamPosition` (end-of-game block) to our role vocabulary. Anything else — `""`,
 * missing, `NONE`, a value we have not seen — is `null`, and `role` is nullable everywhere
 * for exactly that reason. A role is **never** inferred from the champion (M2.10, point 7).
 *
 * Exported so the mapper in `packages/lcu` uses this table rather than a second copy of it.
 */
export const DETECTED_TEAM_POSITION_ROLES: Readonly<Record<string, RoleValue>> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  UTILITY: 'support',
};

/** The role for a `detectedTeamPosition`, or null for anything we do not recognise. */
export function roleFromDetectedTeamPosition(position: string | null | undefined): RoleValue | null {
  if (typeof position !== 'string') return null;
  return DETECTED_TEAM_POSITION_ROLES[position.trim().toUpperCase()] ?? null;
}
