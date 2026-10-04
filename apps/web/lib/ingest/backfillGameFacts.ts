import { isLocalStackHostname } from '../ops/target';
import { GAME_FACTS_VERSION, gameFactsInsert, writeGameFacts } from '../stats/gameFacts';
import type { ServiceClient } from '../supabase';
import { formatTargetLine } from './rebuildCommand';

/**
 * `pnpm --filter web backfill-game-facts [--dry-run] [--group <slug>] [--hosted]` as a function
 * (database performance plan, 0041). `scripts/backfill-game-facts.ts` only wires it to `process`.
 *
 * Writes a `game_facts` row for every game that has none, and recomputes every row whose
 * `facts_version` is below the code's {@link GAME_FACTS_VERSION}. The facts are
 * `rawFactsFromUnknown(games.raw)`, the same function ingest writes with, so a backfilled row is
 * the row ingest would have written.
 *
 * - **Idempotent.** A second run finds nothing to do and writes nothing (`written 0`).
 * - **Cheap to re-run.** The first pass reads only ids and versions; raw is read only for the games
 *   that need a row, a few dozen at a time.
 * - **Local by default.** The first line names the database by host (`target  <host> (local|hosted)`,
 *   rebuild-ratings' rule, M14.27); any database that is not the local stack is refused without
 *   `--hosted`, dry runs too, before a client exists.
 * - **Safe beside ingest.** A game posted mid-run gets its row from ingest; this one's write is then a
 *   recompute of identical facts.
 */

export const BACKFILL_FACTS_USAGE =
  'usage: pnpm --filter web backfill-game-facts [--dry-run] [--group <slug>] [--hosted]';

export interface BackfillFactsArgs {
  dryRun: boolean;
  hosted: boolean;
  groupSlug: string | null;
}

export function parseBackfillFactsArgs(argv: readonly string[]): BackfillFactsArgs | null {
  const args: BackfillFactsArgs = { dryRun: false, hosted: false, groupSlug: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--hosted') args.hosted = true;
    else if (arg === '--group') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      args.groupSlug = value;
      index += 1;
    } else return null;
  }
  return args;
}

/** How many games' ids one listing page reads (PostgREST's row cap). */
const LIST_PAGE = 1_000;
/** How many raw blocks one write batch reads (about 60 KB each). */
const RAW_BATCH = 50;

export interface BackfillFactsReport {
  groupSlug: string;
  games: number;
  /** Games with no `game_facts` row. */
  missing: number;
  /** Rows below {@link GAME_FACTS_VERSION}. */
  stale: number;
  /** Rows written (0 on a dry run). */
  written: number;
}

export function formatBackfillFactsReport(report: BackfillFactsReport, dryRun: boolean): string {
  return [
    `group         ${report.groupSlug}`,
    `games         ${report.games}`,
    `missing       ${report.missing}`,
    `stale         ${report.stale} (below version ${GAME_FACTS_VERSION})`,
    `written       ${report.written}${dryRun ? ' (dry run)' : ''}`,
  ].join('\n');
}

/** Every game of one group that needs a row: none yet, or an older version. */
async function gamesNeedingFacts(
  client: ServiceClient,
  groupId: string,
  version: number,
): Promise<{ games: number; missing: string[]; stale: string[] }> {
  const missing: string[] = [];
  const stale: string[] = [];
  let games = 0;
  for (let from = 0; ; from += LIST_PAGE) {
    const { data, error } = await client
      .from('games')
      .select('id, game_facts(facts_version)')
      .eq('group_id', groupId)
      .order('id')
      .range(from, from + LIST_PAGE - 1);
    if (error) throw new Error(`backfill-game-facts: games read failed: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      games += 1;
      const stored = row.game_facts[0]?.facts_version;
      if (stored === undefined) missing.push(row.id);
      else if (stored < version) stale.push(row.id);
    }
    if (page.length < LIST_PAGE) break;
  }
  return { games, missing, stale };
}

/** Computes and writes the rows for `gameIds` (one group's), a batch of raw blocks at a time. */
async function writeFactsFor(
  client: ServiceClient,
  groupId: string,
  gameIds: readonly string[],
  version: number,
): Promise<number> {
  let written = 0;
  for (let start = 0; start < gameIds.length; start += RAW_BATCH) {
    const chunk = gameIds.slice(start, start + RAW_BATCH);
    const { data, error } = await client
      .from('games')
      .select('id, group_id, raw')
      .eq('group_id', groupId)
      .in('id', chunk);
    if (error) throw new Error(`backfill-game-facts: raw read failed: ${error.message}`);
    const rows = (data ?? []).map((game) =>
      gameFactsInsert({ id: game.id, groupId: game.group_id }, game.raw, version),
    );
    await writeGameFacts(client, rows, 'replace');
    written += rows.length;
  }
  return written;
}

export async function backfillGroupFacts(
  client: ServiceClient,
  group: { id: string; slug: string },
  dryRun: boolean,
  /** Tests only: the code version to fill to. */
  version: number = GAME_FACTS_VERSION,
): Promise<BackfillFactsReport> {
  const need = await gamesNeedingFacts(client, group.id, version);
  const written = dryRun
    ? 0
    : await writeFactsFor(client, group.id, [...need.missing, ...need.stale], version);
  return {
    groupSlug: group.slug,
    games: need.games,
    missing: need.missing.length,
    stale: need.stale.length,
    written,
  };
}

export interface BackfillFactsDeps {
  createClient(url: string, serviceRoleKey: string): ServiceClient;
  now(): number;
  out(line: string): void;
  err(line: string): void;
}

export interface BackfillFactsEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}

/** Runs the command; returns its exit code (0 fine, 1 a bad argument, the wrong target or a failure). */
export async function runBackfillFactsCommand(
  argv: readonly string[],
  env: BackfillFactsEnv,
  deps: BackfillFactsDeps,
): Promise<number> {
  const args = parseBackfillFactsArgs(argv);
  if (args === null) {
    deps.err(BACKFILL_FACTS_USAGE);
    return 1;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    deps.err('backfill-game-facts: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    deps.err('backfill-game-facts: put them in apps/web/.env.local (see .env.example)');
    return 1;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    deps.err('backfill-game-facts: NEXT_PUBLIC_SUPABASE_URL is not a URL');
    return 1;
  }
  const local = isLocalStackHostname(parsed.hostname);
  deps.out(formatTargetLine(parsed.host, local));
  if (!local && !args.hosted) {
    deps.err(
      `backfill-game-facts: ${parsed.host} is not the local stack; pass --hosted to write it on purpose`,
    );
    return 1;
  }

  const client = deps.createClient(url, serviceRoleKey);
  const started = deps.now();
  let query = client.from('groups').select('id, slug').order('created_at');
  if (args.groupSlug !== null) query = query.eq('slug', args.groupSlug);
  const { data: groups, error } = await query;
  if (error) {
    deps.err(`backfill-game-facts: groups read failed: ${error.message}`);
    return 1;
  }
  if ((groups ?? []).length === 0) {
    deps.err(
      args.groupSlug === null
        ? 'backfill-game-facts: no groups'
        : `backfill-game-facts: no group ${args.groupSlug}`,
    );
    return 1;
  }

  let total = 0;
  for (const group of groups ?? []) {
    const report = await backfillGroupFacts(client, group, args.dryRun);
    total += report.written;
    deps.out('');
    deps.out(formatBackfillFactsReport(report, args.dryRun));
  }
  deps.out('');
  deps.out(`total         ${total} written`);
  deps.out(`took          ${deps.now() - started} ms`);
  return 0;
}
