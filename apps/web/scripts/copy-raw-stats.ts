import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { copyRawStats, formatCopyRawStatsReport } from '../lib/ingest/copyRawStats.ts';

/**
 * `pnpm --filter web copy-raw-stats` (M7.7, extended by M7.14).
 *
 * A one-off, run-as-often-as-you-like pass that copies vision score, damage self-mitigated and
 * damage to objectives out of `games.raw` onto the `game_players` rows written before
 * migrations `0014` and `0015` added the three columns. Without it the MVP / ACE bonus (M7.8,
 * M7.9, M7.14) would only apply to games played after the migration and the next
 * `rebuild-ratings` would fold one history under two models.
 *
 *   pnpm --filter web copy-raw-stats [--dry-run] [--game <games.id>]
 *
 *   --dry-run   count what would change and write nothing.
 *   --game      one game, by `games.id`, instead of the whole history.
 *
 * It only ever fills a null and never overwrites a stored number, so running it twice changes
 * nothing the second time and running it while games land is safe. A row whose blob does not
 * carry the numbers stays null on purpose — null means "this game never stored it", which is
 * not 0, and the performance score skips such a game rather than scoring a tank at nothing.
 *
 * The report ends with "rows still short" and then a line per column. Read the per-column
 * numbers, not only the combined one: M7.14's sequencing rule is that the core half may not
 * merge until `damage to objectives` is **zero** rows short, and a combined count cannot say
 * which column the shortfall is in.
 *
 * Everything except the argument parsing and the printing is `lib/ingest/copyRawStats.ts`,
 * which is what the integration test drives.
 *
 * Exit codes: 0 fine, 1 a bad argument or a failed write.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 * Point them at production only when you mean to rewrite production.
 */

interface Args {
  dryRun: boolean;
  gameId: string | null;
}

function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { dryRun: false, gameId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--game') {
      const value = argv[index + 1];
      if (value === undefined) return null;
      args.gameId = value;
      index += 1;
    } else return null;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error('usage: pnpm --filter web copy-raw-stats [--dry-run] [--game <games.id>]');
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('copy-raw-stats: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('copy-raw-stats: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const started = Date.now();
  const report = await copyRawStats(client, { dryRun: args.dryRun, gameId: args.gameId });

  console.log(formatCopyRawStatsReport(report));
  console.log(`  ${'took'.padEnd(24)}${`${Date.now() - started} ms`.padStart(6)}`);
}

await main();
