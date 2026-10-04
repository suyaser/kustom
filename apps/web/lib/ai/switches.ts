import 'server-only';
import { formatDayMonth } from '../night';
import { isPremium, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { aiPausedUntil, readAiBudgetStatus } from './meter';

/**
 * The two reads and the one write M16.3b's pages and routes need beside `store.ts`'s
 * `setAiOptOut` (brief 1.4, 1.5). Service-role, scoped to one group. Nothing here generates.
 */

export type AiLinesSwitchResult = { ok: true; enabled: boolean } | { ok: false; reason: 'not_premium' };

/**
 * The admins' `AI lines` switch (`groups.ai_lines_enabled`, `0033`). **Only for a Premium group**:
 * a group without Premium has no switch to flip (D1), so the write is refused rather than stored
 * for a later day. The route checks the admin; this checks the flag and writes.
 */
export async function setAiLinesEnabled(
  service: ServiceClient,
  input: { groupId: string; enabled: boolean },
): Promise<AiLinesSwitchResult> {
  if (!(await isPremium(service, input.groupId))) return { ok: false, reason: 'not_premium' };
  const { data, error } = await service
    .from('groups')
    .update({ ai_lines_enabled: input.enabled })
    .eq('id', input.groupId)
    .select('ai_lines_enabled')
    .maybeSingle();
  if (error) throw new Error(`ai switches: AI lines write failed: ${error.message}`);
  if (data === null) return { ok: false, reason: 'not_premium' };
  return { ok: true, enabled: data.ai_lines_enabled };
}

/**
 * One member's `ai_opt_out` in one group, by PUUID, or null when they are not a member (or it cannot be read:
 * logged, and the You card is then not drawn rather than drawn wrong).
 */
export async function readMemberAiOptOut(
  service: ServiceClient,
  input: { groupId: string; puuid: string },
): Promise<boolean | null> {
  try {
    const { data, error } = await service
      .from('group_memberships')
      .select('ai_opt_out, players!inner(puuid)')
      .eq('group_id', input.groupId)
      .eq('players.puuid', input.puuid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data === null ? null : data.ai_opt_out;
  } catch (error) {
    console.error('ai switches: opt-out read failed', error instanceof Error ? error.message : error);
    return null;
  }
}

/** What the admin home's `Kustom Premium` section draws (`PremiumSectionView`). */
export interface PremiumSectionData {
  linesEnabled: boolean;
  /** `1 Nov` while this month's budget is used up, else null. */
  pausedUntilDay: string | null;
}

/**
 * The admin home's `Kustom Premium` section, or null for "draw nothing": the group is not Premium,
 * or its gate cannot be read (fails closed like `readAiGate`, so a broken read looks like a group
 * without Premium, D1). The budget line is read only while AI lines are on (`aiPausedUntil`). The
 * reset day is the 1st at 00:00 UTC, so it is printed in UTC: a western time zone would call it the
 * 31st.
 */
export async function loadPremiumSection(
  service: ServiceClient,
  groupId: string,
  now: Date,
): Promise<PremiumSectionData | null> {
  const gate = await readAiGate(service, groupId);
  if (gate === null || !gate.premium) return null;
  const status = gate.linesEnabled ? await readAiBudgetStatus(service, groupId, now) : null;
  const until = aiPausedUntil(gate, status);
  return {
    linesEnabled: gate.linesEnabled,
    pausedUntilDay: until === null ? null : formatDayMonth(until, 'UTC'),
  };
}

/**
 * The You page's `Write about me`, or null for "draw nothing": only a member of a Premium group with
 * AI lines on gets the card (brief 1.4). Never throws: a failed read draws no card (D1).
 */
export async function loadWriteAboutMe(
  service: ServiceClient,
  input: { groupId: string; puuid: string },
): Promise<{ writeAboutMe: boolean } | null> {
  const gate = await readAiGate(service, input.groupId);
  if (gate === null || !gate.premium || !gate.linesEnabled) return null;
  const optOut = await readMemberAiOptOut(service, input);
  return optOut === null ? null : { writeAboutMe: !optOut };
}
