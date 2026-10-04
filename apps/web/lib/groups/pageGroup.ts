import { isGroupSlug, ORIGINAL_GROUP_ID } from '@customs/db/constants';

/**
 * The group a page belongs to (M13.9): the one named by its `/g/<slug>` segment, resolved on the
 * server through `groups_public` and handed down to the shell, the loaders and the controls.
 *
 * Client-safe on purpose -- no Supabase, no `next/headers` -- because the shell's top bar and the
 * tonight page's four controls are client components that need the id (every `/api/me/*` and
 * `/api/admin/*` body carries it, M13.4) and the slug (every in-app link starts with it).
 */
export interface PageGroup {
  id: string;
  /** The `/g/<slug>` segment. Immutable in v1 (decision row 2026-10-03). */
  slug: string;
  /** As somebody typed it, printed as text in the shell's group line (05-design.md, M13.7). */
  name: string;
}

/**
 * The group everything before M13 belongs to: `0018_groups.sql`'s fixed id, its slug and its
 * name. The slug is what `/` sends a signed-out visitor to; the whole record is the shell's
 * group on the pages that have not moved under `/g/<slug>` yet (they are this group's), and the
 * fallback when reading its row fails -- renames are out of scope in v1, so the literal cannot
 * drift from the row.
 */
export const ORIGINAL_GROUP_SLUG = 'customs';

export const ORIGINAL_GROUP: PageGroup = {
  id: ORIGINAL_GROUP_ID,
  slug: ORIGINAL_GROUP_SLUG,
  name: 'Customs Night',
};

export function isOriginalGroup(group: Pick<PageGroup, 'id'>): boolean {
  return group.id === ORIGINAL_GROUP_ID;
}

/**
 * The cookie the shell leaves behind (M13.9): the slug of the last group page this browser
 * opened, so `/` can send a signed-in member back to it. Read only by `/`, and only for a
 * session whose player is a member of that group -- a cookie naming any other group is
 * ignored -- so it is a hint, never a credential.
 */
export const GROUP_COOKIE_NAME = 'kustom_group';

/** A year: it is "the group you open", and that changes about never. */
export const GROUP_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/**
 * The slug of a `/g/<slug>/...` path, or `null` for anything that is not one -- a `/g/<uuid>`
 * game link (M11.4) above all, which names a game and not a group.
 */
export function groupSlugFromPath(pathname: string): string | null {
  const match = /^\/g\/([^/]+)/.exec(pathname);
  if (match?.[1] === undefined) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isGroupSlug(segment) ? segment : null;
}
