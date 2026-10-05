import {
  lockTransition,
  type ModeAction,
  type ModeLock,
  type Refusal,
  type RuleOption,
  ruleOf,
  type TransitionContext,
  transition,
} from '@customs/core';
import { ruleColumnsOf } from '@customs/db/schemas';
import type { ServiceClient } from '../supabase';
import { LOCK_COLUMNS, type StoredLock, storedLockOf } from './lock';
import { type ModeStore, patchIsNoop, type StoredModeRow } from './state';

/**
 * One write to the Mode card (M20.7): core's `transition` decides the patch, and the patch is
 * written as **one update of only its fields** (M20 D7: last write wins; nothing re-reads, nothing
 * compares). A repeat of the standing mode with nothing pending and the switch at its default
 * writes nothing (M14.29's `changed: false`, no Realtime event, no live bump); every other action
 * writes even when it repeats, so a tap is never silently dropped against a stale read.
 *
 * `this` (any action on this game's lock while the lobby is `balanced`: the region pair since M20
 * D9, the rule, Spin and Rated since M20.18) is {@link writeLock}: one conditional update of the
 * lock columns the action sets, only while the lobby is still `balanced`.
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
  | { ok: true; lobbyId: string; before: ModeLock; lock: ModeLock; spun: RuleOption | null }
  | { ok: false; refusal: Refusal | 'started' | 'no-lock' };

/** The lobby columns one lock action writes: only what the action sets (M20 D7's rule, on the lock). */
type LockColumns = {
  lock_mode?: string;
  lock_rule?: string | null;
  lock_class_tag?: string | null;
  lock_region_blue?: string | null;
  lock_region_red?: string | null;
  lock_rated?: boolean | null;
};

function lockColumnsOf(action: ModeAction, lock: ModeLock): LockColumns {
  const rule = ruleColumnsOf(lock.mode);
  switch (action.type) {
    case 'rated':
      return { lock_rated: lock.rated };
    case 'redraw':
    case 'set-side':
      return { lock_region_blue: rule.regionBlue, lock_region_red: rule.regionRed };
    case 'standing':
      return {
        lock_mode: lock.standing,
        lock_rule: rule.rule,
        lock_class_tag: rule.classTag,
        lock_region_blue: rule.regionBlue,
        lock_region_red: rule.regionRed,
        lock_rated: lock.rated,
      };
    default:
      return {
        lock_rule: rule.rule,
        lock_class_tag: rule.classTag,
        lock_region_blue: rule.regionBlue,
        lock_region_red: rule.regionRed,
        lock_rated: lock.rated,
      };
  }
}

/**
 * Any card action on this game's lock (M20.18; the region pair since M20 D9, D5): core's
 * `lockTransition` over this game's pool (bans as they are now, counted when the lock is
 * Fearless), then **one update of only the lock columns the action sets**, only while the lobby is
 * still `balanced` (and, for a pair change, still on region wars). A game that started in between
 * is refused, never changed. The row (`group_modes`) is written only by a standing pick (`mode` alone), and `locked_at` stays (the
 * hand-back's "an admin wrote the next game after the lock" test reads it against the row).
 */
export async function writeLock(
  client: ServiceClient,
  input: {
    groupId: string;
    action: ModeAction;
    context: (lock: ModeLock) => Promise<TransitionContext>;
    /** The card row, for a standing pick's `mode` (the night's mode, so the next Roll keeps it). */
    store: ModeStore;
    playerId: string;
  },
): Promise<LockWriteResult> {
  const live = await readLiveLock(client, input.groupId);
  if (live === null) return { ok: false, refusal: 'no-lock' };
  if (live.status !== 'balanced') return { ok: false, refusal: 'started' };
  const before = live.stored.lock;
  const result = lockTransition(before, input.action, await input.context(before));
  if (!result.ok) return { ok: false, refusal: result.refusal };

  const pairOnly = input.action.type === 'redraw' || input.action.type === 'set-side';
  let update = client
    .from('lobbies')
    .update(lockColumnsOf(input.action, result.lock))
    .eq('id', live.lobbyId)
    .eq('status', 'balanced')
    .not('lock_mode', 'is', null);
  if (pairOnly) update = update.eq('lock_rule', 'region');
  const { data, error } = await update.select('id');
  if (error) throw new Error(`mode: lock write failed: ${error.message}`);
  if ((data ?? []).length === 0) return { ok: false, refusal: 'started' };
  // The standing mode is the night's mode (lead, M20.18): a standing pick for this game also sets
  // the row's `mode`, only that (the pending rule and Rated stay), after the lock landed.
  if (input.action.type === 'standing') {
    await input.store.write(input.groupId, { standing: input.action.standing }, { playerId: input.playerId });
  }
  const spun = input.action.type === 'spin' ? ruleOf(result.lock.mode) : null;
  return { ok: true, lobbyId: live.lobbyId, before, lock: result.lock, spun };
}
