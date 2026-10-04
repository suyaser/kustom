import { isOriginalGroup, type PageGroup } from '@/lib/groups/pageGroup';

/**
 * Whether a group's Stats titles carry the Egyptian Arabic roast line (M14.42, scene-walk gap 7).
 * The roasts were the original group's own request (decision row 2026-09-12, narrowed by
 * M14.42), so only `customs` gets them, matched by its fixed id, never by slug or name. Every
 * other group sees the English heading alone. A per-group switch is M15+ if anyone asks; no
 * schema change until then.
 */
export function groupHasRoasts(group: Pick<PageGroup, 'id'>): boolean {
  return isOriginalGroup(group);
}
