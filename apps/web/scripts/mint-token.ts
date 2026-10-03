import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { mintCompanionToken } from '../lib/companionAuth.ts';
import { ensureMemberships } from '../lib/ingest/memberships.ts';
import { ensurePlayers } from '../lib/ingest/players.ts';

/**
 * Mints a companion token for a PUUID and prints it once.
 *
 * This exists because the companion needs a token before `/admin` does (M1.6 replaces it with
 * a button). It writes the SHA-256 hash to `companion_tokens.token_hash`; the raw token below
 * is the only time anyone sees it.
 *
 *   pnpm --filter web mint-token <puuid> [label] [--group <slug>]
 *
 * `--group` (M13.3) is the group the token posts to, `customs` (the original group) by default.
 * A token is only good while its player is a member of its group, so this adds a `member` row
 * when there is none and never changes an existing role.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 */

const USAGE = 'usage: pnpm --filter web mint-token <puuid> [label] [--group <slug>]';

/** The original group's slug (`0018_groups.sql`). */
const DEFAULT_GROUP_SLUG = 'customs';

function parseArgs(argv: readonly string[]): { puuid: string; label: string | null; slug: string } | null {
  const positional: string[] = [];
  let slug = DEFAULT_GROUP_SLUG;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--group') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      slug = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  const [puuid, label, extra] = positional;
  if (!puuid || extra !== undefined) return null;
  return { puuid, label: label ?? null, slug };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const { puuid, slug } = args;
  const label = args.label ?? 'dev';

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('mint-token: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('mint-token: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: group, error: groupError } = await client
    .from('groups')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (groupError) throw new Error(`mint-token: group lookup failed: ${groupError.message}`);
  if (group === null) {
    console.error(`mint-token: no group with the slug ${slug}`);
    process.exitCode = 1;
    return;
  }

  const playerIds = await ensurePlayers(client, [{ puuid }]);
  const playerId = playerIds.get(puuid);
  if (playerId === undefined) throw new Error(`mint-token: could not create a player for ${puuid}`);

  // A token is only good while its player is a member of its group. `0019`'s insert trigger
  // would add the row too; it is written here so the rule is in the command that states it.
  await ensureMemberships(client, group.id, [playerId]);

  const { token, tokenHash } = mintCompanionToken();
  const { error } = await client
    .from('companion_tokens')
    .insert({ player_id: playerId, token_hash: tokenHash, label, group_id: group.id });
  if (error) throw new Error(`mint-token: insert failed: ${error.message}`);

  console.log(`player_id ${playerId}`);
  console.log(`puuid     ${puuid}`);
  console.log(`group     ${group.slug} (${group.id})`);
  console.log(`label     ${label}`);
  console.log('');
  console.log(token);
}

await main();
