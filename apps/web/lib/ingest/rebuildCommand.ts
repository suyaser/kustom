import { flushLive, LiveChanges } from '../live/bump';
import { isLocalStackHostname } from '../ops/target';
import type { ServiceClient } from '../supabase';
import { formatRebuildReport, type RebuildAllOptions, type RebuildAllResult, rebuildWrote } from './rebuild';

/**
 * `pnpm --filter web rebuild-ratings` as a function (M5.2; the target line and `--hosted`, M14.27).
 *
 * `scripts/rebuild-ratings.ts` only wires this to `process`; everything a test needs to see --
 * the arguments, which database it is about to touch, the refusal, the exit code -- is here.
 *
 * **The target line.** The first line of output names the database, by host only, and whether
 * it is the local stack: `target        127.0.0.1 (local)` or
 * `target        abcdefghijkl.supabase.co (hosted)`. Never the URL's path, query or user info,
 * and never a key. The command reads its URL from `apps/web/.env.local` unless the environment
 * overrides it, and the local `customs` group has the same id as hosted's, so without this line
 * nothing in the output said which database a report came from.
 *
 * **`--hosted`.** Any URL that is not the local stack (`lib/ops/target.ts`, the rule `set-premium`
 * uses) is refused unless `--hosted` is passed -- dry runs included, so a missing override can
 * never silently fold the wrong database. A refusal creates no client and reads nothing.
 */

export const REBUILD_USAGE =
  'usage: pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--group <slug>] [--hosted]';

export interface RebuildArgs {
  dryRun: boolean;
  force: boolean;
  prune: boolean;
  hosted: boolean;
  groupSlug: string | null;
}

/** The arguments, or null for anything unknown (the caller prints the usage). */
export function parseRebuildArgs(argv: readonly string[]): RebuildArgs | null {
  const args: RebuildArgs = { dryRun: false, force: false, prune: false, hosted: false, groupSlug: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--prune') args.prune = true;
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

export type RebuildTarget =
  | { ok: true; host: string; local: boolean; line: string }
  | { ok: false; line: string | null; error: string };

/** `target        <host> (local|hosted)`: the host only, so nothing secret can reach it. */
export function formatTargetLine(host: string, local: boolean): string {
  return `target        ${host} (${local ? 'local' : 'hosted'})`;
}

/**
 * Which database `url` is, and whether the command may touch it: the local stack always,
 * anything else only with `--hosted`. The error names the host, never the URL.
 */
export function checkRebuildTarget(url: string, hosted: boolean): RebuildTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, line: null, error: 'rebuild-ratings: NEXT_PUBLIC_SUPABASE_URL is not a URL' };
  }
  const host = parsed.host;
  const local = isLocalStackHostname(parsed.hostname);
  const line = formatTargetLine(host, local);
  if (!local && !hosted) {
    return {
      ok: false,
      line,
      error: `rebuild-ratings: ${host} is not the local stack; pass --hosted to fold it on purpose`,
    };
  }
  return { ok: true, host, local, line };
}

export interface RebuildCommandDeps {
  createClient(url: string, serviceRoleKey: string): ServiceClient;
  rebuildAllGroups(client: ServiceClient, options: RebuildAllOptions): Promise<RebuildAllResult>;
  /** Milliseconds, for the `took` line. */
  now(): number;
  out(line: string): void;
  err(line: string): void;
}

export interface RebuildCommandEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
}

/**
 * Runs the command and returns its exit code: 0 fine, 1 refused, a bad argument, the wrong
 * target or a data problem (in any group), 2 the fence tripped in some group and nothing was
 * refused -- run it again.
 */
export async function runRebuildCommand(
  argv: readonly string[],
  env: RebuildCommandEnv,
  deps: RebuildCommandDeps,
): Promise<number> {
  const args = parseRebuildArgs(argv);
  if (args === null) {
    deps.err(REBUILD_USAGE);
    return 1;
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    deps.err('rebuild-ratings: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    deps.err('rebuild-ratings: put them in apps/web/.env.local (see .env.example)');
    return 1;
  }

  const target = checkRebuildTarget(url, args.hosted);
  if (target.line !== null) deps.out(target.line);
  if (!target.ok) {
    deps.err(target.error);
    return 1;
  }

  const client = deps.createClient(url, serviceRoleKey);
  const started = deps.now();
  const all = await deps.rebuildAllGroups(client, {
    force: args.force,
    dryRun: args.dryRun,
    prune: args.prune,
    groupSlug: args.groupSlug,
  });

  if (!all.ok) {
    deps.err(all.message);
    return 1;
  }

  // Each group printed on its own, in the order they were folded (oldest group first).
  let refused = false;
  let fenced = false;
  let problems = 0;
  for (const { groupSlug, result } of all.groups) {
    deps.out('');
    if (!result.ok) {
      if (result.report !== null) deps.out(formatRebuildReport(result.report));
      else deps.out(`group         ${groupSlug}`);
      deps.err(result.message);
      if (result.code === 'fence') fenced = true;
      else refused = true;
      continue;
    }
    deps.out(formatRebuildReport(result.report));
    problems += result.report.problems.length;
  }
  // Tonight's live signal (M19.9): every group whose fold wrote a row, once, after every group's
  // writes. A dry run, a refusal and an unchanged database bump nothing.
  const live = new LiveChanges();
  for (const { groupId, result } of all.groups) {
    if (rebuildWrote(result)) live.touch(groupId, 'ratings');
  }
  await flushLive(client, live);
  deps.out(`took          ${deps.now() - started} ms`);

  if (problems > 0) {
    deps.err(`rebuild-ratings: ${problems} problem(s) above; nothing else is wrong`);
  }
  // 2 is the fence: the command is idempotent, so running it again is free and is the fix. A
  // refusal or a data problem anywhere outranks it.
  return refused || problems > 0 ? 1 : fenced ? 2 : 0;
}
