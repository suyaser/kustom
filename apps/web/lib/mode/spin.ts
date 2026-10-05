import type { Mode } from '@customs/core';
import { ruleModeOf } from '@customs/db/schemas';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * Spin's inputs from the database (M15.3; brief D3, R3; M20.7). The draw itself is core's
 * `transition` (`{ type: 'spin', previous, blocked }`): a family uniformly, then an option, never a
 * standing mode, never an unplayable option, never tonight's previous rule, and region wars with its
 * pair drawn in the same write (M20 D10). This file only reads the previous rule and whether
 * tonight's lobby is already open.
 *
 * **Mirror needs a lobby Kustom has not made yet** (QA fix 2026-10-04). Start a lobby asks the
 * companion for Blind Pick only when it makes the lobby (M17.17); a lobby that is already `open`
 * was made as it was, most likely Draft Pick. So while one is open, mirror is blocked for Spin.
 */

/**
 * "Tonight's previous rule" (D3: no `Tanks only` twice in a row). The rule locked on the group's
 * live lobby (rolled, maybe being played right now) wins; otherwise the rule of tonight's latest
 * recorded rule game. Null when tonight has had none.
 *
 * M20.18: a Spin for this game (`live: false`) skips the live lock (it is the rule being
 * replaced) and reads only the game played before this one.
 */
export async function previousRule(
  client: ServiceClient,
  groupId: string,
  now: Date,
  timeZone: string,
  options: { live?: boolean; partyId?: string | null } = {},
): Promise<Mode | null> {
  const partyId = options.partyId ?? null;
  if (options.live !== false) {
    const locked = await liveLockedRule(client, groupId, partyId);
    if (locked !== null) return locked;
  }
  return lastPlayedRule(client, groupId, now, timeZone, partyId);
}

/**
 * The rule locked on the group's newest `balanced` or `in_game` lobby, or null. With a party
 * (M22.4, a forked night) that table's: each lobby's Spin avoids its own previous rule.
 */
async function liveLockedRule(
  client: ServiceClient,
  groupId: string,
  partyId: string | null,
): Promise<Mode | null> {
  let query = client
    .from('lobbies')
    .select('lock_rule, lock_class_tag, lock_region_blue, lock_region_red')
    .eq('group_id', groupId)
    .in('status', ['balanced', 'in_game'])
    .not('lock_rule', 'is', null);
  if (partyId !== null) query = query.eq('lcu_party_id', partyId);
  const live = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (live.error) throw new Error(`spin: live lobby lookup failed: ${live.error.message}`);
  if (live.data !== null) {
    const locked = ruleModeOf({
      rule: live.data.lock_rule,
      classTag: live.data.lock_class_tag,
      regionBlue: live.data.lock_region_blue,
      regionRed: live.data.lock_region_red,
    });
    if (locked !== null) return locked;
  }
  return null;
}

/**
 * The rule of tonight's latest recorded rule game, or null. With a party (M22.4) the latest game
 * played from that table's lobbies.
 */
async function lastPlayedRule(
  client: ServiceClient,
  groupId: string,
  now: Date,
  timeZone: string,
  partyId: string | null,
): Promise<Mode | null> {
  const since = nightStart(now, timeZone).toISOString();
  const last =
    partyId === null
      ? await client
          .from('games')
          .select('rule, rule_class_tag, rule_region_blue, rule_region_red')
          .eq('group_id', groupId)
          .not('rule', 'is', null)
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : await client
          .from('games')
          .select('rule, rule_class_tag, rule_region_blue, rule_region_red, lobbies!inner(lcu_party_id)')
          .eq('group_id', groupId)
          .eq('lobbies.lcu_party_id', partyId)
          .not('rule', 'is', null)
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
  if (last.error) throw new Error(`spin: last rule game lookup failed: ${last.error.message}`);
  if (last.data === null) return null;
  return ruleModeOf({
    rule: last.data.rule,
    classTag: last.data.rule_class_tag,
    regionBlue: last.data.rule_region_blue,
    regionRed: last.data.rule_region_red,
  });
}

/**
 * Whether the group has a lobby `open` (filling) right now: one already made, Blind Pick or not.
 * With a party (M22.4) only that table's lobby counts.
 */
export async function hasOpenLobby(
  client: ServiceClient,
  groupId: string,
  partyId: string | null = null,
): Promise<boolean> {
  let query = client.from('lobbies').select('id').eq('group_id', groupId).eq('status', 'open');
  if (partyId !== null) query = query.eq('lcu_party_id', partyId);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`spin: open lobby lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}
