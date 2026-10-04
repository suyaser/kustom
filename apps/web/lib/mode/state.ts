import type { ModeRow, ModeState, PendingRule, RowPatch, RuleOption } from '@customs/core';
import type { Database } from '@customs/db';
import { NEW_GROUP_MODE, parseGroupMode, ruleColumnsOf, ruleModeOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { legacyVersion } from './legacyVersion';

/**
 * The Mode card's row on the server (M20.7, `0047`): core's `ModeRow` (`mode/transition.ts`) on the
 * group's `group_modes` row. There is no version and no compare-and-set (M20 D6, D7): every admin
 * action writes **one update of only the fields its patch sets**, so two admins can only overwrite
 * what they both touched, and the last write wins. Roll's move and the hand-backs are single
 * conditional statements in the database (`mode_take`, `mode_hand_back`), not here.
 *
 * Behind a small {@link ModeStore} so the route's rules are unit-tested with an in-memory store
 * (`lib/testing/modeStore.ts`) and the integration tests run the Supabase one.
 */

/** The row as read: core's state, whether the group has a row at all, and its `updated_at`. */
export interface StoredModeRow {
  row: ModeRow;
  exists: boolean;
  /** `group_modes.updated_at`; null for a group with no row. Ordering only (M19.13): never compared by a write. */
  updatedAt: string | null;
}

/** Who wrote: `set_by` on every admin write, `pending_set_by` when the write sets the pending rule. */
export interface ModeWriter {
  /** The admin; absent for the server's own write, which keeps `set_by`. */
  playerId?: string;
}

export interface ModeStore {
  read(groupId: string): Promise<StoredModeRow>;
  /** One update of exactly the patch's fields (an insert for a group with no row). Answers the row after. */
  write(groupId: string, patch: RowPatch, writer: ModeWriter): Promise<StoredModeRow>;
}

/** The columns the server reads. */
export const MODE_ROW_COLUMNS =
  'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at' as const;

export interface ModeRowColumns {
  mode: string;
  pending_rule: string | null;
  pending_class_tag: string | null;
  pending_region_blue: string | null;
  pending_region_red: string | null;
  rated_override: boolean | null;
  updated_at: string;
}

/** A missing row reads as a new group's: Normal, nothing pending, the switch at its default. */
export function missingRow(): ModeRow {
  return { standing: NEW_GROUP_MODE, pending: null, rated: null };
}

/** The pending columns as core's rule; a rule this build cannot read (or a region with no pair) is none. */
export function pendingOf(columns: {
  pending_rule: string | null;
  pending_class_tag: string | null;
  pending_region_blue: string | null;
  pending_region_red: string | null;
}): PendingRule | null {
  const mode = ruleModeOf({
    rule: columns.pending_rule,
    classTag: columns.pending_class_tag,
    regionBlue: columns.pending_region_blue,
    regionRed: columns.pending_region_red,
  });
  return mode === null || mode.id === 'normal' || mode.id === 'fearless' ? null : mode;
}

export function rowFromColumns(columns: ModeRowColumns): ModeRow {
  return {
    standing: parseGroupMode(columns.mode),
    pending: pendingOf(columns),
    rated: columns.rated_override,
  };
}

export function storedFromColumns(columns: ModeRowColumns | null): StoredModeRow {
  return columns === null
    ? { row: missingRow(), exists: false, updatedAt: null }
    : { row: rowFromColumns(columns), exists: true, updatedAt: columns.updated_at };
}

/** A patch as the columns it writes: only the fields it names. */
type ModeRowUpdate = Database['public']['Tables']['group_modes']['Update'];

export function columnsOfPatch(patch: RowPatch, writer: ModeWriter): ModeRowUpdate {
  const columns: ModeRowUpdate = {};
  if (patch.standing !== undefined) columns.mode = patch.standing;
  if (patch.pending !== undefined) {
    const rule = patch.pending === null ? null : ruleColumnsOf(patch.pending);
    columns.pending_rule = rule?.rule ?? null;
    columns.pending_class_tag = rule?.classTag ?? null;
    columns.pending_region_blue = rule?.regionBlue ?? null;
    columns.pending_region_red = rule?.regionRed ?? null;
    columns.pending_set_by = patch.pending === null ? null : (writer.playerId ?? null);
  }
  if (patch.rated !== undefined) columns.rated_override = patch.rated;
  if (writer.playerId !== undefined) columns.set_by = writer.playerId;
  return columns;
}

/** Whether applying `patch` to `row` changes nothing anybody could see. */
export function patchIsNoop(row: ModeRow, patch: RowPatch): boolean {
  if (patch.standing !== undefined && patch.standing !== row.standing) return false;
  if (patch.rated !== undefined && patch.rated !== row.rated) return false;
  if (patch.pending !== undefined && JSON.stringify(patch.pending) !== JSON.stringify(row.pending)) return false;
  return true;
}

export async function readModeRow(client: ServiceClient, groupId: string): Promise<StoredModeRow> {
  const { data, error } = await client
    .from('group_modes')
    .select(MODE_ROW_COLUMNS)
    .eq('group_id', groupId)
    .maybeSingle();
  if (error) throw new Error(`mode: read failed: ${error.message}`);
  return storedFromColumns(data);
}

export function supabaseModeStore(client: ServiceClient): ModeStore {
  return {
    read: (groupId) => readModeRow(client, groupId),

    async write(groupId, patch, writer) {
      const columns = columnsOfPatch(patch, writer);
      const { data, error } = await client
        .from('group_modes')
        .update(columns)
        .eq('group_id', groupId)
        .select(MODE_ROW_COLUMNS);
      if (error) throw new Error(`mode: update failed: ${error.message}`);
      const updated = data?.[0];
      if (updated !== undefined) return storedFromColumns(updated);
      // A group born mid-deploy with no row: insert it with the patch. A row that appeared
      // meanwhile is somebody else's; the update then lands on it.
      const inserted = await client
        .from('group_modes')
        .upsert({ group_id: groupId, ...columns }, { onConflict: 'group_id', ignoreDuplicates: true })
        .select(MODE_ROW_COLUMNS);
      if (inserted.error) throw new Error(`mode: insert failed: ${inserted.error.message}`);
      const row = inserted.data?.[0];
      if (row !== undefined) return storedFromColumns(row);
      const again = await client
        .from('group_modes')
        .update(columns)
        .eq('group_id', groupId)
        .select(MODE_ROW_COLUMNS);
      if (again.error) throw new Error(`mode: update failed: ${again.error.message}`);
      return storedFromColumns(again.data?.[0] ?? null);
    },
  };
}

// ---------------------------------------------------------------------------
// The pre-M20.8 card's shape. M20.8 deletes everything below with the version reads.
// ---------------------------------------------------------------------------

/**
 * @deprecated M20.8: the card client still renders core's old `ModeState`. `version` is
 * `Date.parse(updated_at)` (the client store orders by it; no write reads it); region wars is the
 * old pairless option (the card's "before Roll" region copy is M20.8's).
 */
export function legacyStateOf(stored: StoredModeRow): ModeState {
  return {
    standing: stored.row.standing,
    pending: legacyRule(stored.row.pending),
    ratedOverride: stored.row.rated,
    version: legacyVersion(stored.updatedAt),
  };
}

/** @deprecated M20.8: a missing row in the old shape (a new group's Normal). */
export function missingState(): ModeState {
  return { standing: NEW_GROUP_MODE, pending: null, ratedOverride: null, version: 0 };
}

/** @deprecated M20.8: see {@link legacyStateOf}. */
export function stateFromRow(columns: ModeRowColumns): ModeState {
  return legacyStateOf(storedFromColumns(columns));
}

function legacyRule(rule: PendingRule | null): RuleOption | null {
  if (rule === null) return null;
  return rule.id === 'region' ? { id: 'region' } : rule;
}
