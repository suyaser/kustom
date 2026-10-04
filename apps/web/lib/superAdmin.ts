import { z } from 'zod';

/**
 * The operator (M13.6, folded into M14.19): the person who runs the deployment and needs to see
 * any group to help it.
 *
 * **An env var of Supabase auth user ids, nothing else.** `SUPER_ADMIN_USER_IDS` is a
 * comma-separated list of `auth.users.id`, checked server-side after `auth.getUser()` has verified
 * the session. It is not a `players` row, not a membership and not a table, so no group can see it
 * and no bug in a write path can grant it; changing it is a deploy.
 *
 * What it opens is **read-only**: every admin GET and admin page read in any group (the read gate,
 * `authorizeAdminRead` in `adminAuth.ts`) and `GET /api/ops/groups`. It never opens a write: the
 * write gate (`authorizeAdmin`) does not read this list at all.
 *
 * Not part of `readServerEnv`: a typo in this list must cost the operator their view, not take
 * every route of the deployment down with a `ServerEnvError`. An entry that is not an id is dropped
 * and logged once per distinct raw value.
 */

export const SUPER_ADMIN_ENV = 'SUPER_ADMIN_USER_IDS';

/** `auth.users.id` is a Postgres uuid; `guid()` for the same reason as `groupIdSchema`. */
const authUserIdSchema = z.guid();

/** The ids in a raw `SUPER_ADMIN_USER_IDS` value, lower-cased. Empty for unset, empty or junk. */
export function parseSuperAdminIds(raw: string | undefined | null): ReadonlySet<string> {
  const ids = new Set<string>();
  if (typeof raw !== 'string') return ids;
  const dropped: string[] = [];
  for (const part of raw.split(',')) {
    const candidate = part.trim();
    if (candidate.length === 0) continue;
    if (authUserIdSchema.safeParse(candidate).success) ids.add(candidate.toLowerCase());
    else dropped.push(candidate);
  }
  if (dropped.length > 0) warnOnce(raw, dropped.length);
  return ids;
}

let warnedFor: string | null = null;

function warnOnce(raw: string, count: number): void {
  if (warnedFor === raw) return;
  warnedFor = raw;
  // The count only: the entries are user ids, which have no business in a log.
  console.warn(
    `${SUPER_ADMIN_ENV}: ignored ${count} entr${count === 1 ? 'y' : 'ies'} that are not auth user ids`,
  );
}

/** The configured super-admin ids, read from the process environment at call time. */
export function superAdminIds(source: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  return parseSuperAdminIds(source[SUPER_ADMIN_ENV]);
}

/**
 * True when the **verified** session user id is on the list. Only ever called with the id
 * `auth.getUser()` returned, never with anything a request carried.
 */
export function isSuperAdmin(
  userId: string | null | undefined,
  source: Record<string, string | undefined> = process.env,
): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false;
  return superAdminIds(source).has(userId.toLowerCase());
}
