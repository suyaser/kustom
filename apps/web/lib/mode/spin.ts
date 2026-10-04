import {
  type ChampionTable,
  drawSpin,
  type Mode,
  type ModeState,
  type Rng,
  RULE_OPTIONS,
  type RuleOption,
  rulePlayable,
} from '@customs/core';
import { ruleModeOf } from '@customs/db/schemas';
import { loadFearless } from '../fearless/load';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';
import { championTable } from './champions';

/**
 * Spin, the server's pick (M15.3; brief D3, R3). The draw is core's `drawSpin`: a family
 * uniformly, then an option, never a standing mode, a family from `SPIN_FAMILIES` (mirror included, M17.17), never an
 * unplayable option, never tonight's previous rule. This file only gathers its inputs: the
 * champion table, the Fearless bans (on a standing-Fearless night only, D7), the previous rule,
 * and a real RNG (`lib/mode/rng.ts`) the browser never sees.
 */

export interface SpinInputs {
  table: ChampionTable;
  /** The group's Fearless pool. Counted only while the standing mode is Fearless. */
  bans: readonly number[];
  /** Tonight's previous rule: the live lobby's locked rule, else tonight's last rule game. */
  previous: Mode | null;
  rng: Rng;
}

/** The pick for this card state, or null when nothing is left to draw. Pure. */
export function spinFor(state: ModeState, inputs: SpinInputs): RuleOption | null {
  const bans = state.standing === 'fearless' ? inputs.bans : [];
  return drawSpin(
    RULE_OPTIONS,
    inputs.previous,
    (rule) => rulePlayable(rule, inputs.table, bans),
    inputs.rng,
  );
}

/**
 * The draw a card write runs (`writeModeCard`'s `spin` action): the bans are read only when the
 * state it is drawing for is on Fearless, and the previous rule once.
 */
export function spinDraw(
  client: ServiceClient,
  input: { groupId: string; now: Date; timeZone: string; rng: Rng; table?: ChampionTable },
): (state: ModeState) => Promise<RuleOption | null> {
  let previous: Promise<Mode | null> | null = null;
  return async (state) => {
    previous ??= previousRule(client, input.groupId, input.now, input.timeZone);
    const bans =
      state.standing === 'fearless'
        ? (await loadFearless(client, input.groupId)).champions.map((champion) => champion.id)
        : [];
    return spinFor(state, {
      table: input.table ?? championTable(),
      bans,
      previous: await previous,
      rng: input.rng,
    });
  };
}

/**
 * "Tonight's previous rule" (D3: no `Tanks only` twice in a row). The rule locked on the group's
 * live lobby (rolled, maybe being played right now) wins; otherwise the rule of tonight's latest
 * recorded rule game. Null when tonight has had none.
 */
export async function previousRule(
  client: ServiceClient,
  groupId: string,
  now: Date,
  timeZone: string,
): Promise<Mode | null> {
  const live = await client
    .from('lobbies')
    .select('lock_rule, lock_class_tag, lock_region_blue, lock_region_red')
    .eq('group_id', groupId)
    .in('status', ['balanced', 'in_game'])
    .not('lock_rule', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
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

  const last = await client
    .from('games')
    .select('rule, rule_class_tag, rule_region_blue, rule_region_red')
    .eq('group_id', groupId)
    .not('rule', 'is', null)
    .gte('started_at', nightStart(now, timeZone).toISOString())
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
