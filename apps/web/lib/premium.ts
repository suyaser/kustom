import 'server-only';
import { aiGateRowSchema, type GroupPremium, groupPremiumRowSchema } from '@customs/db/schemas';
import type { ServiceClient } from './supabase';

/**
 * Kustom Premium's entitlement, read on the server (M16.2). **Every AI path calls this** -- every
 * M16 generator before a model call and every M16 render before a line -- and `premium.test.ts`
 * fails the build of any file under `lib/ai/` that does not import it.
 *
 * The flag lives on `groups` (`0031_premium_flag.sql`), which only the service role can read, so
 * these take the service client. Nothing here writes: the operator's `set-premium` script is the
 * only writer (`lib/ops/setPremium.ts`), and no HTTP route touches the columns.
 */

export const PREMIUM_COLUMNS = 'premium, premium_changed_at, ai_monthly_cap_usd' as const;

/** One `groups` row's three columns, validated, or a thrown error naming what was wrong. */
export function parseGroupPremium(row: unknown): GroupPremium {
  const parsed = groupPremiumRowSchema.safeParse(row);
  if (!parsed.success) throw new Error(`premium: malformed groups row: ${parsed.error.message}`);
  return {
    premium: parsed.data.premium,
    premiumChangedAt: parsed.data.premium_changed_at,
    monthlyCapUsd: parsed.data.ai_monthly_cap_usd,
  };
}

/**
 * The group's entitlement, or null when there is no such group. Throws on a database error or a
 * malformed row: a caller that shows it (`/ops`) wants to know.
 */
export async function readGroupPremium(
  service: ServiceClient,
  groupId: string,
): Promise<GroupPremium | null> {
  const { data, error } = await service
    .from('groups')
    .select(PREMIUM_COLUMNS)
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw new Error(`premium: reading group ${groupId} failed: ${error.message}`);
  return data === null ? null : parseGroupPremium(data);
}

/**
 * True only when the group exists and its flag is on. **Fails closed**: a missing group, a
 * database error or a malformed row is `false` (logged), so a broken read never costs a model
 * call or shows a line (brief 4.6: failure is silent absence).
 */
export async function isPremium(service: ServiceClient, groupId: string): Promise<boolean> {
  try {
    return (await readGroupPremium(service, groupId))?.premium === true;
  } catch (error) {
    console.error('premium: treating the group as not Premium', error);
    return false;
  }
}

/**
 * The group's AI spend cap for a calendar month, in USD, or null when it cannot be read (no such
 * group, a database error, a malformed row). A caller budgeting a model call treats null as
 * "no budget": it makes no call.
 */
export async function groupMonthlyCapUsd(service: ServiceClient, groupId: string): Promise<number | null> {
  try {
    return (await readGroupPremium(service, groupId))?.monthlyCapUsd ?? null;
  } catch (error) {
    console.error('premium: no readable monthly cap', error);
    return null;
  }
}

/* ---------------------------------------------------------------------------------------------
 * The AI gate (M16.3)
 * ------------------------------------------------------------------------------------------- */

/**
 * Everything a generator or a render needs to know about the group before it does anything:
 * Premium on, the admins' `AI lines` switch on (`0033`), and since when Premium has been on (a
 * game recorded before that never gets a line, brief 4.1).
 */
export interface AiGate {
  premium: boolean;
  linesEnabled: boolean;
  premiumChangedAt: string | null;
}

/** The gate is open: Premium on and the group's AI lines switched on. */
export function aiGateOpen(gate: AiGate | null): gate is AiGate {
  return gate?.premium === true && gate.linesEnabled;
}

/**
 * The group's AI gate, or null when it cannot be read: no such group, a database error, a
 * malformed row, or a database without `0033` (no `ai_lines_enabled` column yet). **Fails
 * closed** like {@link isPremium}: null means no model call and no line. A separate select from
 * {@link PREMIUM_COLUMNS} so `/ops` keeps working on a database that has not applied `0033`.
 */
export async function readAiGate(service: ServiceClient, groupId: string): Promise<AiGate | null> {
  try {
    const { data, error } = await service
      .from('groups')
      .select('premium, premium_changed_at, ai_lines_enabled')
      .eq('id', groupId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data === null) return null;
    const parsed = aiGateRowSchema.safeParse(data);
    if (!parsed.success) throw new Error(`malformed groups row: ${parsed.error.message}`);
    return {
      premium: parsed.data.premium,
      linesEnabled: parsed.data.ai_lines_enabled,
      premiumChangedAt: parsed.data.premium_changed_at,
    };
  } catch (error) {
    console.error('premium: no readable AI gate, treating AI as off', error);
    return null;
  }
}
