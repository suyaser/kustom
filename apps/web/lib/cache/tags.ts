import { revalidateTag } from 'next/cache';

/**
 * The cross-request cache's tags, one per group and kind of data (redesign/research/performance.md
 * 5.3). Every cached read of a group's data carries `groupTag(kind, groupId)`, and every writer
 * that changes that data calls {@link expireGroupTag} once, after its last write.
 *
 * - `stats`: the three Stats segments (`lib/stats/cached.ts`). Changes when a game is stored
 *   (live or backfill, ban enrichment included), rated, or re-rated (the daily rebuild, Reset
 *   ratings), and when a stored player's name changes on a game post.
 *
 * Only data that is the same for every viewer is ever cached under these tags (anon reads, no
 * session, no service-role fact).
 */
export type CacheKind = 'stats';

export function groupTag(kind: CacheKind, groupId: string): string {
  return `${kind}:${groupId}`;
}

/**
 * Expire a group's cached `kind` now: `{ expire: 0 }`, so the next viewer reads fresh data
 * (Next 16's `'max'` profile is stale-while-revalidate and would serve the old numbers once).
 *
 * **Never throws.** A writer's job is the write; a cache that could not be told is a stale page
 * until the entry's own `revalidate` runs out, never a failed ingest. Outside a Next request
 * (a CLI script such as `rebuild-ratings`, a vitest that calls a route handler directly) there is
 * no cache to expire and this is a quiet no-op.
 */
export function expireGroupTag(kind: CacheKind, groupId: string): void {
  try {
    revalidateTag(groupTag(kind, groupId), { expire: 0 });
  } catch (error) {
    if (isNoRequestStore(error)) return;
    console.error(`cache: could not expire ${groupTag(kind, groupId)}`, error);
  }
}

/** Next's "no request store" invariant (E263): we are not inside a Next request. */
function isNoRequestStore(error: unknown): boolean {
  return error instanceof Error && error.message.includes('static generation store missing');
}
