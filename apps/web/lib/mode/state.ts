import type { ModeState, RuleOption } from '@customs/core';
import { type GroupMode, NEW_GROUP_MODE, parseGroupMode, ruleModeOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';

/**
 * The Mode card's state on the server (M15.3): core's `ModeState`, stored on the group's
 * `group_modes` row (`0024` + `0032`). Core decides every transition (`mode/lifecycle.ts`); this
 * file only reads the row and writes it back **compare-and-set on `version`**, so two admins at
 * once never lose a write silently (the loser re-reads and re-applies: last write wins) and a
 * recorded game's compare-and-clear never clears a rule queued after Roll.
 *
 * Behind a small {@link ModeStore} so the rules around it are unit-tested with an in-memory store
 * and the integration tests run the Supabase one.
 */

/** The card state as read, and whether the group has a row at all (a group born mid-deploy). */
export interface StoredModeState {
  state: ModeState;
  exists: boolean;
}

/** Who wrote, for `set_by` (every write) and `pending_set_by` (a write that set the rule). */
export interface ModeWriter {
  /** The admin; absent for the server's own write (the compare-and-clear), which keeps `set_by`. */
  playerId?: string;
  /** True for a write that chose the pending rule (a pick or a Spin): it names `pending_set_by`. */
  setsRule?: boolean;
}

export interface ModeStore {
  read(groupId: string): Promise<StoredModeState>;
  /**
   * Write `next` if the row is still at `expected.state.version` (or still missing, when it was).
   * `false` when somebody else wrote first: nothing was written.
   */
  write(groupId: string, expected: StoredModeState, next: ModeState, writer: ModeWriter): Promise<boolean>;
}

/** A missing row reads as a new group's state: Normal, nothing pending, version 0. */
export function missingState(): ModeState {
  return { standing: NEW_GROUP_MODE, pending: null, ratedOverride: null, version: 0 };
}

/** The row's columns as core's state. A rule column this build cannot read is no rule. */
export function stateFromRow(row: {
  mode: string;
  pending_rule: string | null;
  pending_class_tag: string | null;
  rated_override: boolean | null;
  version: number;
}): ModeState {
  return {
    standing: parseGroupMode(row.mode),
    pending: pendingOf(row.pending_rule, row.pending_class_tag),
    ratedOverride: row.rated_override,
    version: row.version,
  };
}

function pendingOf(rule: string | null, classTag: string | null): RuleOption | null {
  if (rule === 'region') return { id: 'region' };
  const mode = ruleModeOf({ rule, classTag, regionBlue: null, regionRed: null });
  return mode === null || mode.id === 'normal' || mode.id === 'fearless' || mode.id === 'region'
    ? null
    : mode;
}

/** Core's state as the row's columns. */
export function rowFromState(state: ModeState): {
  mode: GroupMode;
  pending_rule: string | null;
  pending_class_tag: string | null;
  rated_override: boolean | null;
  version: number;
} {
  return {
    mode: state.standing,
    pending_rule: state.pending?.id ?? null,
    pending_class_tag: state.pending?.id === 'class' ? state.pending.tag : null,
    rated_override: state.ratedOverride,
    version: state.version,
  };
}

const STATE_COLUMNS = 'mode, pending_rule, pending_class_tag, rated_override, version' as const;

export function supabaseModeStore(client: ServiceClient): ModeStore {
  return {
    async read(groupId) {
      const { data, error } = await client
        .from('group_modes')
        .select(STATE_COLUMNS)
        .eq('group_id', groupId)
        .maybeSingle();
      if (error) throw new Error(`mode: read failed: ${error.message}`);
      return data === null
        ? { state: missingState(), exists: false }
        : { state: stateFromRow(data), exists: true };
    },

    async write(groupId, expected, next, writer) {
      const columns = {
        ...rowFromState(next),
        ...(writer.playerId === undefined ? {} : { set_by: writer.playerId }),
        ...(next.pending === null
          ? { pending_set_by: null }
          : writer.setsRule
            ? { pending_set_by: writer.playerId ?? null }
            : {}),
      };
      if (!expected.exists) {
        // `on conflict do nothing`: a row that appeared meanwhile is somebody else's write.
        const { data, error } = await client
          .from('group_modes')
          .upsert({ group_id: groupId, ...columns }, { onConflict: 'group_id', ignoreDuplicates: true })
          .select('group_id');
        if (error) throw new Error(`mode: insert failed: ${error.message}`);
        return (data ?? []).length > 0;
      }
      const { data, error } = await client
        .from('group_modes')
        .update(columns)
        .eq('group_id', groupId)
        .eq('version', expected.state.version)
        .select('group_id');
      if (error) throw new Error(`mode: update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
