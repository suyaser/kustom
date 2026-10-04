import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { runBackfillFactsCommand } from '../lib/ingest/backfillGameFacts.ts';

/**
 * `pnpm --filter web backfill-game-facts [--dry-run] [--group <slug>] [--hosted]` (0041).
 *
 * Fills `game_facts` for every game without a row and recomputes rows below the code's
 * `GAME_FACTS_VERSION`. Idempotent: a second run writes nothing. Every group by default; `--group`
 * for one. `--hosted` is required for any database that is not the local stack, dry runs too.
 *
 * The logic is `lib/ingest/backfillGameFacts.ts`; this file only wires it to `process`. Reads
 * `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local` (the package
 * script's `--env-file-if-exists`) or the ambient environment.
 */

process.exitCode = await runBackfillFactsCommand(
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
    now: () => Date.now(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  },
);
