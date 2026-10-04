import { revalidateTag } from 'next/cache';

/**
 * The server cache's tags (performance plan, 5.3): one per slow-changing slice of one group, plus
 * two global ones. Every cached read names its tags here and every writer invalidates through
 * {@link invalidateGroup} / {@link invalidateNames}, so a reader and its writer can never spell a
 * tag two ways.
 *
 * | Kind      | Covers                                                        | Invalidated by                               |
 * |-----------|---------------------------------------------------------------|----------------------------------------------|
 * | `games`   | top five, last game, daily game, roster label inputs          | eog ingest, backfill, rebuild, ratings reset |
 * | `roster`  | roster label inputs, admin names                              | member removal and role routes               |
 * | `admins`  | admin names                                                   | member role, owner transfer                  |
 * | `hosts`   | host tokens and their last-seen times (plus a 30 s lifetime)  | token routes, pairing                        |
 * | `mystery` | the anonymous daily game card                                 | (its day is in the key; `games` covers new games) |
 * | `stats`   | the Stats tab's slices (the stats lane)                       | that lane's writers                          |
 *
 * {@link NAMES_TAG} is on everything that prints a name, because a rename is global (a player is
 * in several groups) and rare. {@link GROUPS_TAG} is the slug-to-group lookup.
 *
 * **`{ expire: 0 }` always.** Next 16's recommended `'max'` profile is stale-while-revalidate: the
 * next viewer after a game would still see the old top five once, which is wrong for live data.
 */
export type GroupTagKind = 'games' | 'roster' | 'admins' | 'hosts' | 'mystery' | 'stats';

/** `games:<groupId>`: the tag of one slice of one group. */
export function groupTag(kind: GroupTagKind, groupId: string): string {
  return `${kind}:${groupId}`;
}

/** Every player name (a rename anywhere). */
export const NAMES_TAG = 'names';

/** The slug-to-group lookup (`requirePageGroup`). */
export const GROUPS_TAG = 'groups';

/** Drop these slices of one group from the server cache, now. Never throws (see {@link invalidate}). */
export function invalidateGroup(groupId: string, kinds: readonly GroupTagKind[]): void {
  for (const kind of kinds) invalidate(groupTag(kind, groupId));
}

/** A player was renamed (or their tag line moved): every cached slice that prints a name. */
export function invalidateNames(): void {
  invalidate(NAMES_TAG);
}

/** A group was created: a slug that was looked up before and found nothing now names it. */
export function invalidateGroups(): void {
  invalidate(GROUPS_TAG);
}

/**
 * `revalidateTag(tag, { expire: 0 })`, and never a reason for a write to fail: the write has
 * landed, and the slice's lifetime bounds how stale it can be. Outside a Next request (a script,
 * an integration test calling a handler or an ingest function directly) there is no cache to
 * invalidate, which is not worth a line in the log; anything else is.
 */
export function invalidate(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('static generation store missing')) return;
    console.warn(`cache: invalidating ${tag} failed`, error);
  }
}
