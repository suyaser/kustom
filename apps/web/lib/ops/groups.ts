import type { OpsGroup } from '@customs/db/schemas';
import { aiPausedUntil, readAiBudgetStatus } from '../ai/meter';
import { PREMIUM_COLUMNS, parseGroupPremium, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';

/**
 * Every group, oldest first, with the numbers the operator's `/ops` table shows (M13.6 / M14.19):
 * member count, admin count (the owner included), the latest game's `started_at`, and whether a
 * webhook is set, plus Kustom Premium read-only (M16.2: flag, changed at, monthly cap). Service
 * role; the webhook URL is filtered on, never selected.
 *
 * A handful of small queries per group, run in parallel: there are a few groups, not thousands,
 * and per-group `count` queries are exact where a bulk select would stop at PostgREST's row cap.
 */
export async function listOpsGroups(client: ServiceClient, now: Date = new Date()): Promise<OpsGroup[]> {
  const { data: groups, error } = await client
    .from('groups')
    .select(`id, slug, name, created_at, ${PREMIUM_COLUMNS}`)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`ops: listing groups failed: ${error.message}`);

  const { data: hooks, error: hooksError } = await client
    .from('discord_config')
    .select('group_id')
    .not('webhook_url', 'is', null)
    .neq('webhook_url', '');
  if (hooksError) throw new Error(`ops: reading webhooks failed: ${hooksError.message}`);
  const withWebhook = new Set((hooks ?? []).map((row) => row.group_id));

  return Promise.all(
    (groups ?? []).map(async (group): Promise<OpsGroup> => {
      const [members, admins, lastGame] = await Promise.all([
        client
          .from('group_memberships')
          .select('player_id', { count: 'exact', head: true })
          .eq('group_id', group.id),
        client
          .from('group_memberships')
          .select('player_id', { count: 'exact', head: true })
          .eq('group_id', group.id)
          .in('role', ['admin', 'owner']),
        client
          .from('games')
          .select('started_at')
          .eq('group_id', group.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (members.error) throw new Error(`ops: counting members failed: ${members.error.message}`);
      if (admins.error) throw new Error(`ops: counting admins failed: ${admins.error.message}`);
      if (lastGame.error) throw new Error(`ops: reading the last game failed: ${lastGame.error.message}`);

      // M16.10: `Paused · cap reached`, from the admin's own budget read, for Premium groups only.
      const premium = parseGroupPremium(group);
      const aiCapReached = premium.premium
        ? aiPausedUntil(
            await readAiGate(client, group.id),
            await readAiBudgetStatus(client, group.id, now),
          ) !== null
        : false;

      return {
        id: group.id,
        slug: group.slug,
        name: group.name,
        createdAt: group.created_at,
        memberCount: members.count ?? 0,
        adminCount: admins.count ?? 0,
        lastGameAt: lastGame.data?.started_at ?? null,
        webhookSet: withWebhook.has(group.id),
        premium,
        aiCapReached,
      };
    }),
  );
}
