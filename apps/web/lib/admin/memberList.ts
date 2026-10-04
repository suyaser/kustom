import type { GroupRole } from '@customs/db/schemas';

/**
 * The Members list's order and `Find someone` filter (M14.52). Pure and client-safe (no zod, no
 * server import): the filter runs in the browser as you type, with no page load and no server call.
 */

interface ListedMember {
  role: GroupRole;
  name: string;
  /** ISO time of their latest game in the group, or null for none yet. */
  lastPlayedAt: string | null;
}

const ROLE_ORDER: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

/**
 * The owner, then admins, then everyone else; inside each, whoever played last first, people with no
 * game yet last, then by name. Returns a new array.
 */
export function sortMembers<T extends ListedMember>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
}

/** Folds case and accents, so `ramzyinhovic` finds `Ramzyinhović`. */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .trim();
}

/** The rows whose name contains the query, in their order; every row for a blank query. */
export function filterMembers<T extends Pick<ListedMember, 'name'>>(rows: readonly T[], query: string): T[] {
  const needle = foldName(query);
  return needle === '' ? [...rows] : rows.filter((row) => foldName(row.name).includes(needle));
}

/**
 * Which rows add a muted `#tag` after their name (design round N5a, admin round 2): a named row
 * whose name another named row shares, **and** whose tag tells them apart. When two rows share both
 * name and tag, the tag would say nothing, so neither shows one. Rows with no name yet (`Someone`)
 * are skipped. Returns their `playerId`s.
 */
export function rowsNeedingTag(
  rows: readonly { playerId: string; name: string; named: boolean; tagLine?: string | null }[],
): Set<string> {
  const byName = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    if (!row.named) continue;
    const key = foldName(row.name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  const tagged = new Set<string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const tagCount = new Map<string, number>();
    for (const row of group) {
      const tag = foldName(row.tagLine ?? '');
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
    for (const row of group) {
      const tag = foldName(row.tagLine ?? '');
      if (tag !== '' && tagCount.get(tag) === 1) tagged.add(row.playerId);
    }
  }
  return tagged;
}
