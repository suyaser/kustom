import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { formatRebuildReport, rebuildAllGroups } from '../lib/ingest/rebuild.ts';

/**
 * `pnpm --filter web rebuild-ratings` (M5.2).
 *
 * Folds every rated-eligible game of a season, in `started_at` order, from seeds, and writes
 * the answer once at the end. Run it after a backfill batch (M5.1) — a batch of old customs is
 * stored unrated until this runs — or any time the numbers need to be provably the fold of the
 * games rather than the history of the writes.
 *
 *   pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--season <id>] [--group <slug>]
 *
 *   --dry-run   compute and report; write nothing.
 *   --force     skip the guard that refuses while a lobby is live.
 *   --prune     delete `ratings` rows for players with no rated game in the season.
 *   --season    a season id; the active season by default.
 *   --group     one group by slug; every group by default (M13.3). Each group is folded on its
 *               own -- its own games, its own ratings, its own live-lobby / 15-minute guard --
 *               and one group's refusal does not stop the next.
 *
 * Everything except the argument parsing and the printing is `lib/ingest/rebuild.ts`, which is
 * what the integration tests drive. This file is a command, not a place for rules.
 *
 * Exit codes: 0 fine, 1 refused or a data problem (in any group), 2 the fence tripped in some
 * group and nothing was refused — run it again.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 * Point them at production only when you mean to rebuild production.
 */

interface Args {
  dryRun: boolean;
  force: boolean;
  prune: boolean;
  seasonId: string | null;
  groupSlug: string | null;
}

function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { dryRun: false, force: false, prune: false, seasonId: null, groupSlug: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--prune') args.prune = true;
    else if (arg === '--season') {
      const value = argv[index + 1];
      if (value === undefined) return null;
      args.seasonId = value;
      index += 1;
    } else if (arg === '--group') {
      const value = argv[index + 1];
      if (value === undefined) return null;
      args.groupSlug = value;
      index += 1;
    } else return null;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      'usage: pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--season <id>] [--group <slug>]',
    );
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('rebuild-ratings: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('rebuild-ratings: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const started = Date.now();
  const all = await rebuildAllGroups(client, {
    seasonId: args.seasonId,
    force: args.force,
    dryRun: args.dryRun,
    prune: args.prune,
    groupSlug: args.groupSlug,
  });

  if (!all.ok) {
    console.error(all.message);
    process.exitCode = 1;
    return;
  }

  // Each group printed on its own, in the order they were folded (oldest group first).
  let refused = false;
  let fenced = false;
  let problems = 0;
  for (const [index, { groupSlug, result }] of all.groups.entries()) {
    if (index > 0) console.log('');
    if (!result.ok) {
      if (result.report !== null) console.log(formatRebuildReport(result.report));
      else console.log(`group         ${groupSlug}`);
      console.error(result.message);
      if (result.code === 'fence') fenced = true;
      else refused = true;
      continue;
    }
    console.log(formatRebuildReport(result.report));
    problems += result.report.problems.length;
  }
  console.log(`took          ${Date.now() - started} ms`);

  if (problems > 0) {
    console.error(`rebuild-ratings: ${problems} problem(s) above; nothing else is wrong`);
  }
  // 2 is the fence: the command is idempotent, so running it again is free and is the fix. A
  // refusal or a data problem anywhere outranks it.
  process.exitCode = refused || problems > 0 ? 1 : fenced ? 2 : 0;
}

await main();
