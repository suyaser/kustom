import type { GroupLiveRow } from '@customs/db/schemas';
import { readPublicSupabaseEnv } from '@/lib/publicEnv';

/**
 * Tonight's side of the per-group live signal (M19.10; `group_live`, M19.9).
 *
 * - **Strict parse, schema loaded late.** Every row, from Realtime or from the version check, goes
 *   through `groupLiveRowSchema` (`.strict()`: a column added without the schema's review fails).
 *   The schema module carries zod, which Tonight's first load must not (`lib/clientGraph.test.ts`),
 *   so it is a dynamic import, started when the page subscribes and shared by every parse.
 * - **A version gate.** The page knows the version its render showed; a row re-reads the page only
 *   when its version is newer. An unknown version (no row, a failed read) always re-reads.
 */

/**
 * The Realtime filter for the page's group: `@customs/db/schemas`' `groupLiveFilter`, restated here
 * because importing that module statically would put zod in Tonight's first load
 * (`liveSignal.test.ts` keeps the two identical).
 */
export function groupLiveFilter(groupId: string): string {
  return `group_id=eq.${groupId}`;
}

type Parse = (row: unknown) => GroupLiveRow | null;

type SchemaModule = Pick<typeof import('@customs/db/schemas'), 'groupLiveRowSchema'>;

let loadSchema: () => Promise<SchemaModule> = () => import('@customs/db/schemas');

/** Tests only: stand in for the dynamic import (a flaky phone's failed chunk). */
export function setGroupLiveSchemaLoaderForTests(loader: (() => Promise<SchemaModule>) | null): void {
  loadSchema = loader ?? (() => import('@customs/db/schemas'));
  parser = null;
}

let parser: Promise<Parse | null> | null = null;

/**
 * The strict parser, loaded once per page and asked for **per row**. A chunk that fails to load
 * answers `null` for that row and is forgotten, so the next row tries the import again: one flaky
 * fetch on a phone never deafens the page for the rest of the night.
 */
export function groupLiveParser(): Promise<Parse | null> {
  parser ??= loadSchema().then(
    ({ groupLiveRowSchema }): Parse =>
      (row) => {
        const parsed = groupLiveRowSchema.safeParse(row);
        return parsed.success ? parsed.data : null;
      },
    () => {
      parser = null;
      console.warn('group_live: the row schema did not load; this row is dropped, the next one retries');
      return null;
    },
  );
  return parser;
}

/**
 * Says a `group_live` row was dropped as malformed. Only the group id and the kind, and only when
 * they are strings: never the payload itself.
 */
export function warnMalformedLiveRow(row: unknown): void {
  const fields = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  const groupId = typeof fields.group_id === 'string' ? fields.group_id : null;
  const kind = typeof fields.kind === 'string' ? fields.kind : null;
  console.warn('group_live: dropped a malformed row', { group_id: groupId, kind });
}

/**
 * The group's current row, read with the anon key (the row is public by design: a counter, a word
 * and a time). `null` when the read fails or the row does not parse: the caller re-reads the page.
 */
export async function readGroupLive(groupId: string): Promise<GroupLiveRow | null> {
  try {
    const env = readPublicSupabaseEnv();
    const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '');
    const query = `select=group_id,version,kind,changed_at&group_id=eq.${encodeURIComponent(groupId)}`;
    const [response, parse] = await Promise.all([
      fetch(`${base}/rest/v1/group_live?${query}`, {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          accept: 'application/json',
        },
        cache: 'no-store',
      }),
      groupLiveParser(),
    ]);
    if (!response.ok || parse === null) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = parse(rows[0]);
    if (row === null) warnMalformedLiveRow(rows[0]);
    return row !== null && row.group_id === groupId ? row : null;
  } catch {
    return null;
  }
}

/** The version the page has shown: the newest of its render's and every row it acted on. */
export class LiveVersionGate {
  private seen: number | null;

  constructor(initial: number | null) {
    this.seen = initial;
  }

  /** A newer render arrived: it showed at least this version. */
  rendered(version: number | null): void {
    if (version === null) return;
    this.seen = this.seen === null ? version : Math.max(this.seen, version);
  }

  /** A row at `version` arrived: true (and remembered) when the page has not shown it yet. */
  moved(version: number): boolean {
    if (this.seen !== null && version <= this.seen) return false;
    this.seen = version;
    return true;
  }
}
