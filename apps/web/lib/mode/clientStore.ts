import {
  CLASS_TAGS,
  type ClassTag,
  chooseRule,
  chooseStanding,
  type ModeState,
  type RuleOption,
  type StandingModeId,
  setRated,
} from '@customs/core';
import { useSyncExternalStore } from 'react';
import { ruleFromKey } from './spinEvents';

/**
 * The client mode store (M19.13; decision row 2026-10-04, "the name-free client slice").
 *
 * Tonight's Mode card is the one slice the client may patch without a server render: it prints no
 * player name, so no same-name label can go wrong. The slice is the card's **state** only (standing
 * mode, pending rule, Rated switch, `group_modes.version`, `updated_at`, the Fearless pool's
 * `reset_at`). It never holds a name or a player id: `set_by`, `pending_set_by` and `reset_by` are
 * not read into it (the row parsers drop them before anything here sees a row).
 *
 * Three sources, and only these:
 * - **the server render's props** (the first paint and every later render), merged at read time;
 * - **the `group_modes` / `fearless_state` rows the page's own channel receives** (`TonightLive`),
 *   never a broadcast;
 * - **the controls' own route answers** (`ModeControls`), plus one optimistic action while a Set
 *   mode or Rated tap is in flight.
 *
 * **Gated on `group_modes.version`.** A row or answer older than what the store (or the render) has
 * is ignored; an equal row is taken (it is the same state, with the row's own `updated_at`). The
 * render's props win whenever they are at least as new as the store, so a later server render
 * always takes over again. `fearless_state` has no version: its `reset_at` only moves forward.
 *
 * A tiny external store rather than a context: the card is rendered by the server page, the rows
 * arrive in `TonightLive` (a sibling), and the controls live inside the card.
 */

export interface ModeSlice {
  state: ModeState;
  /** `group_modes.updated_at` (the members' `Back to Normal.` note), or null when not known. */
  updatedAt: string | null;
  /** `fearless_state.reset_at`, or null when not known. */
  resetAt: string | null;
}

/** A tap in flight: shown on the card until its route answers (or fails). */
export type ModeOptimistic = { kind: 'choice'; choice: string } | { kind: 'rated'; rated: boolean };

interface Entry {
  /** The newest state a row or an answer confirmed, or null with none since the page loaded. */
  confirmed: { state: ModeState; updatedAt: string | null } | null;
  resetAt: string | null;
  optimistic: { action: ModeOptimistic; token: number } | null;
}

const EMPTY: Entry = { confirmed: null, resetAt: null, optimistic: null };

let entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let tokens = 0;

function entry(groupId: string): Entry {
  return entries.get(groupId) ?? EMPTY;
}

function write(groupId: string, next: Entry): void {
  entries = new Map(entries).set(groupId, next);
  for (const listener of listeners) listener();
}

/** A `group_modes` row as the store takes it: the parsed state and its `updated_at`. */
export interface ModeRowSlice {
  state: ModeState;
  updatedAt: string | null;
}

/**
 * A `group_modes` row this page's channel received. Taken when it is at least as new as what the
 * store holds; `false` when it was older and ignored.
 */
export function applyModeRow(groupId: string, row: ModeRowSlice): boolean {
  const current = entry(groupId);
  if (current.confirmed !== null && row.state.version < current.confirmed.state.version) return false;
  write(groupId, { ...current, confirmed: { state: row.state, updatedAt: row.updatedAt } });
  return true;
}

/** What a mode route answers (`next`, the card after the write): core's state plus the token. */
export interface ModeAnswer {
  standing: StandingModeId;
  /** A rule key (`class:Tank`, `region`, `mirror`), or null. */
  rule: string | null;
  ratedOverride: boolean | null;
  version: number;
}

/**
 * A control's own route answer. Taken only when newer than the store (an equal row already carries
 * its `updated_at`); an answer has no `updated_at` of its own, so it keeps none.
 */
export function applyModeAnswer(groupId: string, answer: ModeAnswer): boolean {
  const current = entry(groupId);
  if (current.confirmed !== null && answer.version <= current.confirmed.state.version) return false;
  const state: ModeState = {
    standing: answer.standing,
    pending: answer.rule === null ? null : ruleFromKey(answer.rule),
    ratedOverride: answer.ratedOverride,
    version: answer.version,
  };
  write(groupId, { ...current, confirmed: { state, updatedAt: null } });
  return true;
}

/** A `fearless_state` row: the pool's reset time, only ever forward. */
export function applyFearlessReset(groupId: string, resetAt: string): boolean {
  const current = entry(groupId);
  if (!laterThan(resetAt, current.resetAt)) return false;
  write(groupId, { ...current, resetAt });
  return true;
}

/** A tap in flight; returns the token that ends it. A newer tap replaces an older one. */
export function beginOptimistic(groupId: string, action: ModeOptimistic): number {
  tokens += 1;
  write(groupId, { ...entry(groupId), optimistic: { action, token: tokens } });
  return tokens;
}

/** The tap answered or failed: its optimistic action goes (a newer tap's stays). */
export function endOptimistic(groupId: string, token: number): void {
  const current = entry(groupId);
  if (current.optimistic?.token !== token) return;
  write(groupId, { ...current, optimistic: null });
}

/** The version the store has confirmed for a group, or null with none. */
export function confirmedVersion(groupId: string): number | null {
  return entry(groupId).confirmed?.state.version ?? null;
}

/** Tests only: forget every group. */
export function resetModeStoreForTests(): void {
  entries = new Map();
  lastGood.clear();
  for (const listener of listeners) listener();
}

function laterThan(at: string | null, than: string | null): boolean {
  if (at === null) return false;
  if (than === null) return true;
  const a = Date.parse(at);
  const b = Date.parse(than);
  if (Number.isNaN(a)) return false;
  return Number.isNaN(b) || a > b;
}

function optimisticState(state: ModeState, action: ModeOptimistic): ModeState {
  if (action.kind === 'rated') return setRated(state, action.rated);
  if (action.choice === 'normal' || action.choice === 'fearless') return chooseStanding(state, action.choice);
  const rule = ruleFromKey(action.choice);
  return rule === null ? state : chooseRule(state, rule);
}

/** The merged slice, and the version confirmed by a row, an answer or the render (no tap in flight). */
export interface MergedSlice extends ModeSlice {
  confirmedVersion: number;
}

/**
 * The slice the card shows: the render's props, unless the store has confirmed something newer;
 * the later `reset_at`; then a tap in flight on top (core's own transition, so its version is the
 * one the write will have). Pure, so the merge is a unit test.
 */
export function mergeSlice(
  server: ModeSlice,
  groupId: string,
  store: ReadonlyMap<string, Entry>,
  withTap = true,
): MergedSlice {
  const stored = store.get(groupId) ?? EMPTY;
  const held = withTap ? stored : { ...stored, optimistic: null };
  const confirmed = held.confirmed;
  const base =
    confirmed !== null && confirmed.state.version > server.state.version
      ? { state: confirmed.state, updatedAt: confirmed.updatedAt }
      : { state: server.state, updatedAt: server.updatedAt };
  const resetAt = laterThan(held.resetAt, server.resetAt) ? held.resetAt : server.resetAt;
  const state = held.optimistic === null ? base.state : optimisticState(base.state, held.optimistic.action);
  return { state, updatedAt: base.updatedAt, resetAt, confirmedVersion: base.state.version };
}

/** Whether the pool was reset after the render the page was given (the card's bans go to none). */
export function poolClearedSince(server: ModeSlice, merged: ModeSlice): boolean {
  return laterThan(merged.resetAt, server.resetAt);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getEntries = () => entries;
/** The server render and hydration see no store: the first client paint is the server's. */
const getServerEntries = () => EMPTY_MAP;
const EMPTY_MAP: ReadonlyMap<string, Entry> = new Map();

/**
 * The card's slice for `groupId`: `server` merged with what the store has heard since. With
 * `withTap: false`, a tap still in flight is left out (the announcer says only what a row or an
 * answer confirmed).
 */
export function useModeSlice(
  groupId: string,
  server: ModeSlice,
  withTap = true,
  readFailed = false,
): MergedSlice {
  const store = useSyncExternalStore(subscribe, getEntries, getServerEntries);
  return mergeSlice(lastGoodServer(groupId, server, readFailed), groupId, store, withTap);
}

/**
 * The last render whose `group_modes` read worked, per group (audit: a failed read must not show
 * Normal). A render whose read failed carries a stand-in state; the card keeps the last good one
 * instead (and says it could not read the mode). Written only by renders that read it, idempotent.
 */
const lastGood = new Map<string, ModeSlice>();

export function lastGoodServer(groupId: string, server: ModeSlice, readFailed: boolean): ModeSlice {
  if (!readFailed) {
    const held = lastGood.get(groupId);
    if (held === undefined || held.state.version <= server.state.version) lastGood.set(groupId, server);
    return server;
  }
  return lastGood.get(groupId) ?? server;
}

/** Pure: a rule key the store can hold, for a row's `pending_rule` / `pending_class_tag`. */
export function pendingOfRow(rule: string | null, classTag: string | null): RuleOption | null {
  if (rule === 'region') return { id: 'region' };
  if (rule === 'mirror') return { id: 'mirror' };
  if (rule === 'class' && classTag !== null && (CLASS_TAGS as readonly string[]).includes(classTag))
    return { id: 'class', tag: classTag as ClassTag };
  return null;
}
