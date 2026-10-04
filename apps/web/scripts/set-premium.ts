import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import {
  checkSetPremiumTarget,
  formatPremium,
  parseSetPremiumArgs,
  SET_PREMIUM_USAGE,
  setGroupPremium,
} from '../lib/ops/setPremium.ts';

/**
 * Turns Kustom Premium on or off for one group, and optionally sets its monthly AI cap (M16.2).
 *
 *   pnpm --filter web set-premium <slug> on|off [--cap <usd>] [--hosted]
 *
 * The operator's only way to change the flag (brief decision 2): no HTTP route writes it, and
 * `/ops` shows it read-only. Idempotent: asking for what is already there writes nothing, and
 * `premium_changed_at` moves only when the flag flips (the `0031` trigger stamps it).
 *
 *   --cap      the group's monthly AI cap in dollars, 0 to 100 ($2 by default from the migration).
 *   --hosted   required to write to anything that is not the local stack (127.0.0.1 / localhost).
 *              Without it the script refuses, so a production `.env.local` is never written by
 *              accident.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment, and
 * prints the URL before it writes. Everything but the printing is `lib/ops/setPremium.ts`.
 */

async function main(): Promise<void> {
  const parsed = parseSetPremiumArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`set-premium: ${parsed.error}`);
    console.error(SET_PREMIUM_USAGE);
    process.exitCode = 1;
    return;
  }
  const { args } = parsed;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('set-premium: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('set-premium: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  console.log(`supabase  ${url}`);
  const target = checkSetPremiumTarget(url, args.hosted);
  if (!target.ok) {
    console.error(`set-premium: refused: ${target.error}`);
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const result = await setGroupPremium(client, {
    slug: args.slug,
    premium: args.premium,
    capUsd: args.capUsd,
  });
  if (result.status === 'not_found') {
    console.error(`set-premium: no group with the slug ${args.slug}`);
    process.exitCode = 1;
    return;
  }

  console.log(`group     ${result.group.name} (${result.group.slug}, ${result.group.id})`);
  console.log(`before    ${formatPremium(result.before)}`);
  console.log(`after     ${formatPremium(result.after)}`);
  if (!result.changed) console.log('no change: the group already read like that');
}

await main();
