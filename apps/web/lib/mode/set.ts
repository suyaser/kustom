import {
  type ModeAction,
  type ModeLock,
  nextRated,
  type RegionAction,
  type Refusal,
  type RuleOption,
  ruleOf,
  type TransitionContext,
  lockTransition,
  transition,
} from '@customs/core';
import { type NextGame, ruleChoiceOf, ruleColumnsOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { LOCK_COLUMNS, type StoredLock, storedLockOf } from './lock';
import { legacyStateOf, type ModeStore, patchIsNoop, type StoredModeRow } from './state';

/**
 * One write to the Mode card (M20.7): core's `transition` decides the patch, and the patch is
 * written as **one update of only its fields** (M20 D7: last write wins; nothing re-reads, nothing
 * compares). A repeat of the standing mode with nothing pending and the switch at its default
 * writes nothing (M14.29's `changed: false`, no Realtime event, no live bump); every other action
 * writes even when it repeats, so a tap is never silently dropped against a stale read.
 *
 * `this` (the region actions on this game's lock, M20 D9) is {@link writeLockRegions}: one
 * conditional update of the lock's pair, only while the lobby is `balanced` with a region lock.
 *
 * Posts nothing to Discord here (the `this` route resends the teams post itself).
 */

export type ModeWriteResult =
  | { ok: true; before: StoredModeRow; after: StoredModeRow; changed: boolean; spun: RuleOption | null }
  | { ok: false; refusal: Refusal; before: StoredModeRow };

export async function writeModeCard(
  store: ModeStore,
  input: {
    groupId: string;
    playerId: string;
    action: ModeAction;
    /** The draw's inputs for the row as read (bans counted on its standing mode). */
    context: (before: StoredModeRow) => Promise<TransitionContext>;
  },
): Promise<ModeWriteResult> {
  const before = await store.read(input.groupId);
  const result = transition(before.row, input.action, await input.context(before));
  if (!result.ok) return { ok: false, refusal: result.refusal, before };

  const spun =
    input.action.type === 'spin' && result.patch.pending != null ? ruleOf(result.patch.pending) : null;
  if (input.action.type === 'standing' && patchIsNoop(before.row, result.patch)) {
    return { ok: true, before, after: before, changed: false, spun };
  }
  const after = await store.write(input.groupId, result.patch, { playerId: input.playerId });
  return { ok: true, before, after, changed: true, spun };
}

/** This game's lock for the region actions: the group's live lobby with a lock, if any. */
export interface LiveLock {
  lobbyId: string;
  status: string;
  stored: StoredLock;
}

/** The group's newest `balanced` or `in_game` lobby that has a lock, or null. */
export async function readLiveLock(client: ServiceClient, groupId: string): Promise<LiveLock | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(`id, status, ${LOCK_COLUMNS}`)
    .eq('group_id', groupId)
    .in('status', ['balanced', 'in_game'])
    .not('lock_mode', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`mode: live lock read failed: ${error.message}`);
  if (data === null) return null;
  const stored = storedLockOf(data);
  return stored === null ? null : { lobbyId: data.id, status: data.status, stored };
}

export type LockWriteResult =
  | { ok: true; lobbyId: string; lock: ModeLock }
  | { ok: false; refusal: Refusal | 'started' | 'no-lock' };

/**
 * Redraw or set one side on this game's lock (M20 D9, D5): core's `lockTransition` over the bans as
 * they are now, then one update of the two region columns, only while the lobby is still
 * `balanced` and still on region wars. A game that started in between is refused, never changed.
 */
export async function writeLockRegions(
  client: ServiceClient,
  input: {
    groupId: string;
    action: RegionAction;
    context: (lock: ModeLock) => Promise<TransitionContext>;
  },
): Promise<LockWriteResult> {
  const live = await readLiveLock(client, input.groupId);
  if (live === null) return { ok: false, refusal: 'no-lock' };
  if (live.status !== 'balanced') return { ok: false, refusal: 'started' };
  const result = lockTransition(live.stored.lock, input.action, await input.context(live.stored.lock));
  if (!result.ok) return { ok: false, refusal: result.refusal };

  const pair = ruleColumnsOf(result.lock.mode);
  const { data, error } = await client
    .from('lobbies')
    .update({ lock_region_blue: pair.regionBlue, lock_region_red: pair.regionRed })
    .eq('id', live.lobbyId)
    .eq('status', 'balanced')
    .eq('lock_rule', 'region')
    .select('id');
  if (error) throw new Error(`mode: lock region write failed: ${error.message}`);
  if ((data ?? []).length === 0) return { ok: false, refusal: 'started' };
  return { ok: true, lobbyId: live.lobbyId, lock: result.lock };
}

/**
 * @deprecated M20.8: the pre-M20.8 card client's `next` answer. `version` is
 * `Date.parse(updated_at)` (`legacyStateOf`), which the client store orders by.
 */
export function nextGameOf(stored: StoredModeRow): NextGame {
  const legacy = legacyStateOf(stored);
  return {
    standing: stored.row.standing,
    rule: legacy.pending === null ? null : ruleChoiceOf(legacy.pending),
    rated: nextRated(stored.row),
    ratedOverride: stored.row.rated,
    version: legacy.version,
  };
}
