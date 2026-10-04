import { type GroupPremium, groupAiMonthlyCapUsdSchema } from '@customs/db/schemas';
import { PREMIUM_COLUMNS, parseGroupPremium } from '../premium';
import type { ServiceClient } from '../supabase';
import { isLocalStackHostname } from './target';

/**
 * `pnpm --filter web set-premium` (M16.2): the operator turns Kustom Premium on or off for one
 * group, and sets its monthly AI cap, with the service role. **The only writer of
 * `groups.premium` and `groups.ai_monthly_cap_usd` in the codebase** -- no HTTP route writes them,
 * and `premium.test.ts` fails if anything under `app/` imports this file.
 *
 * Everything but the printing is here so the tests drive it; `scripts/set-premium.ts` is a
 * command, not a place for rules.
 */

export const SET_PREMIUM_USAGE =
  'usage: pnpm --filter web set-premium <slug> on|off [--cap <usd>] [--hosted]';

export interface SetPremiumArgs {
  slug: string;
  premium: boolean;
  /** New monthly cap in USD, or null to leave it as it is. */
  capUsd: number | null;
  /** The operator said, on purpose, that a non-local Supabase is the target. */
  hosted: boolean;
}

/** The arguments, or an error line to print above the usage. */
export function parseSetPremiumArgs(
  argv: readonly string[],
): { ok: true; args: SetPremiumArgs } | { ok: false; error: string } {
  const positional: string[] = [];
  let capUsd: number | null = null;
  let hosted = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--hosted') {
      hosted = true;
    } else if (arg === '--cap') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--'))
        return { ok: false, error: '--cap needs a dollar amount' };
      // Plain decimal only: no `1e1`, no `0x10`, no `$2`, no empty string.
      const parsed = /^\d{1,3}(\.\d{1,2})?$/.test(value)
        ? groupAiMonthlyCapUsdSchema.safeParse(Number(value))
        : null;
      if (parsed === null || !parsed.success) {
        return { ok: false, error: `--cap must be dollars between 0 and 100, cents at most (got ${value})` };
      }
      capUsd = parsed.data;
      index += 1;
    } else if (arg.startsWith('--')) {
      return { ok: false, error: `unknown option ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  const [slug, state, extra] = positional;
  if (!slug || !state || extra !== undefined)
    return { ok: false, error: 'needs exactly a slug and on or off' };
  if (state !== 'on' && state !== 'off')
    return { ok: false, error: `the state must be on or off (got ${state})` };
  return { ok: true, args: { slug, premium: state === 'on', capUsd, hosted } };
}

/**
 * Whether the script may write to `url`. The local stack always; anything else only with
 * `--hosted`, so production is never written by a stray `.env.local`.
 */
export function checkSetPremiumTarget(
  url: string,
  hosted: boolean,
): { ok: true; local: boolean } | { ok: false; error: string } {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: `NEXT_PUBLIC_SUPABASE_URL is not a URL (${url})` };
  }
  const local = isLocalStackHostname(hostname);
  if (!local && !hosted) {
    return {
      ok: false,
      error: `${url} is not the local stack; pass --hosted to write to it on purpose`,
    };
  }
  return { ok: true, local };
}

export type SetPremiumResult =
  | { status: 'not_found' }
  | {
      status: 'ok';
      group: { id: string; slug: string; name: string };
      before: GroupPremium;
      after: GroupPremium;
      /** False when the group already read as asked: nothing was written. */
      changed: boolean;
    };

/**
 * Set the flag (and the cap, when given) for the group with `slug`. Idempotent: a run that asks
 * for what is already there writes nothing, and `premium_changed_at` is stamped by the database
 * trigger only when the flag actually flips (`0031`).
 */
export async function setGroupPremium(
  client: ServiceClient,
  input: { slug: string; premium: boolean; capUsd: number | null },
): Promise<SetPremiumResult> {
  const { data: row, error } = await client
    .from('groups')
    .select(`id, slug, name, ${PREMIUM_COLUMNS}`)
    .eq('slug', input.slug)
    .maybeSingle();
  if (error) throw new Error(`set-premium: group lookup failed: ${error.message}`);
  if (row === null) return { status: 'not_found' };
  const group = { id: row.id, slug: row.slug, name: row.name };
  const before = parseGroupPremium(row);

  const patch: { premium?: boolean; ai_monthly_cap_usd?: number } = {};
  if (before.premium !== input.premium) patch.premium = input.premium;
  if (input.capUsd !== null && before.monthlyCapUsd !== input.capUsd) patch.ai_monthly_cap_usd = input.capUsd;
  if (Object.keys(patch).length === 0) return { status: 'ok', group, before, after: before, changed: false };

  const { data: updated, error: updateError } = await client
    .from('groups')
    .update(patch)
    .eq('id', group.id)
    .select(PREMIUM_COLUMNS)
    .single();
  if (updateError) throw new Error(`set-premium: update failed: ${updateError.message}`);
  return { status: 'ok', group, before, after: parseGroupPremium(updated), changed: true };
}

/** `on, cap $2.00, changed 2026-10-04T...` -- one line for the before / after print. */
export function formatPremium(value: GroupPremium): string {
  const state = value.premium ? 'on' : 'off';
  const changed = value.premiumChangedAt === null ? 'never changed' : `changed ${value.premiumChangedAt}`;
  return `${state}, cap $${value.monthlyCapUsd.toFixed(2)} a month, ${changed}`;
}
