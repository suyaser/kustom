import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { rebuildAllGroups } from '../lib/ingest/rebuild.ts';
import { runRebuildCommand } from '../lib/ingest/rebuildCommand.ts';

/**
 * `pnpm --filter web rebuild-ratings` (M5.2).
 *
 * Folds every rated-eligible game of each group, in `started_at` order, from seeds, and writes
 * the answer once at the end. Run it after a backfill batch (M5.1) — a batch of old customs is
 * stored unrated until this runs — or any time the numbers need to be provably the fold of the
 * games rather than the history of the writes.
 *
 *   pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--group <slug>] [--hosted]
 *
 *   --dry-run   compute and report; write nothing.
 *   --force     skip the guard that refuses while a lobby is live.
 *   --prune     delete `ratings` rows for players with no rated game in the group.
 *   --group     one group by slug; every group by default (M13.3). Each group is folded on its
 *               own -- its own games, its own ratings, its own live-lobby / 15-minute guard --
 *               and one group's refusal does not stop the next.
 *   --hosted    required for any database that is not the local stack (M14.27), dry runs too.
 *
 * The first line of output is `target        <host> (local|hosted)`: the database, by host only.
 *
 * The fold is `lib/ingest/rebuild.ts`, which is what the integration tests drive; the arguments,
 * the target check and the printing are `lib/ingest/rebuildCommand.ts`. This file only wires
 * them to `process`.
 *
 * Exit codes: 0 fine, 1 refused or a data problem (in any group), 2 the fence tripped in some
 * group and nothing was refused — run it again.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 * Point them at production only when you mean to rebuild production, and pass `--hosted`.
 */

process.exitCode = await runRebuildCommand(
  process.argv.slice(2),
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  {
    createClient: (url, serviceRoleKey) =>
      createClient<Database>(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    rebuildAllGroups,
    now: () => Date.now(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  },
);
