import { revalidateTag } from 'next/cache';
import { groupTag } from './tags';

/**
 * Drops a group's cached `kind` data now (app-perf, 2026-10-04), from a writer: one line after the
 * write. The tag is `groupTag(kind, groupId)` (`./tags.ts`, kept to that one function so parallel
 * lanes merge it trivially), the same string the reader's `unstable_cache` entry carries:
 * `games:<groupId>` is everything a finished, re-rated or re-rolled game can move. `{ expire: 0 }`, not Next 16's `'max'`: `'max'` is stale-while-revalidate, so the next
 * viewer would still see the old numbers once.
 *
 * Never throws. Outside a Next request (a script such as `rebuild-ratings`, a vitest process)
 * there is no cache to drop and `revalidateTag` throws an invariant; the cached readers also expire
 * on their own (`revalidate` on each entry), so a write from a script shows within that window.
 */
export function invalidateGroup(kind: string, groupId: string): void {
  try {
    revalidateTag(groupTag(kind, groupId), { expire: 0 });
  } catch {
    // No request store: nothing cached here to drop.
  }
}
