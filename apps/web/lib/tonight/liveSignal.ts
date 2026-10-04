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

let parser: Promise<Parse> | null = null;

/** The strict parser, loaded once per page (a chunk that fails to load parses nothing). */
export function groupLiveParser(): Promise<Parse> {
  parser ??= import('@customs/db/schemas').then(
    ({ groupLiveRowSchema }): Parse =>
      (row) => {
        const parsed = groupLiveRowSchema.safeParse(row);
        return parsed.success ? parsed.data : null;
      },
    (): Parse => {
      parser = null;
      return () => null;
    },
  );
  return parser;
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
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = parse(rows[0]);
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
