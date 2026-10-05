import { type Mode, type ModeLock, type ModeRow, type PendingRule, ruleKey, ruleOf } from '@customs/core';
import { useSyncExternalStore } from 'react';
import { ruleFromKey } from './spinEvents';

/**
 * The client mode store (M19.13; decision row 2026-10-04, "the name-free client slice"; M20.8 on
 * the one-row model).
 *
 * Tonight's Mode card is the one slice the client may patch without a server render: it prints no
 * player name, so no same-name label can go wrong. The slice is the card's **row** only (core's
 * `ModeRow`: standing mode, pending rule with its region pair, Rated switch), its
 * `group_modes.updated_at`, and the Fearless pool's `reset_at`. It never holds a name or a player
 * id: `set_by`, `pending_set_by` and `reset_by` are not read into it (the row parsers drop them
 * before anything here sees a row). This game's lock is the server render's, patched only by this
 * page's own `this` answers (M20.18, {@link applyLockAnswer}).
 *
 * Three sources, and only these:
 * - **the server render's props** (the first paint and every later render), merged at read time;
 * - **the `group_modes` / `fearless_state` rows the page's own channel receives** (`TonightLive`,
 *   which hands over only the rows an admin's `mode` write sent), never a broadcast;
 * - **the controls' own route answers** (`ModeControls`, the answer's `state`), plus a draft of the
 *   last tap while its write is in flight.
 *
 * **Gated on `group_modes.updated_at`** (no version since M20.7). A row or answer older than what
 * the store (or the render) has is ignored; an equal one is taken (it is the same row). The
 * render's props win whenever they are at least as new as the store, so a later server render
 * always takes over again. `fearless_state` has no version: its `reset_at` only moves forward.
 *
 * A tiny external store rather than a context: the card is rendered by the server page, the rows
 * arrive in `TonightLive` (a sibling), and the controls live inside the card.
 */

/**
 * The store key of a lobby's card (M22.4, M22 D5). Every entry below is keyed by it. A one-lobby
 * night, and the lobby whose card is `group_modes`, use the group id itself, so today's keys and
 * the `group_modes` rows `TonightLive` applies are unchanged. A forked lobby's card (its own
 * `lobby_modes` row) gets its own key: a `group_modes` row, which is another lobby's card, can
 * never land on it. Such a card is patched only by its own route answers and otherwise follows
 * the server render (each mode write bumps the group's live signal, M19.9).
 */
export function modeCardKey(groupId: string, forkedPartyId: string | null = null): string {
  return forkedPartyId === null ? groupId : `${groupId}#lobby:${forkedPartyId}`;
}

export interface ModeSlice {
  row: ModeRow;
  /** `group_modes.updated_at` (the gate), or null when not known (a group with no row). */
  updatedAt: string | null;
  /** `fearless_state.reset_at`, or null when not known. */
  resetAt: string | null;
}

/** A `group_modes` row, or a route answer's `state`, as the store takes it. */
export interface ModeRowSlice {
  row: ModeRow;
  updatedAt: string | null;
}

/**
 * A tap in flight: drafted on the card until its route answers (or fails). M20.18: `game: 'this'`
 * drafts the balanced lobby's lock instead of the row.
 */
export type ModeOptimistic =
  | { kind: 'choice'; choice: string; game?: 'this' | undefined }
  | { kind: 'rated'; rated: boolean; game?: 'this' | undefined };

/** This game: the balanced lobby's id and its lock (core's `ModeLock`). */
export interface LockSlice {
  lobbyId: string;
  lock: ModeLock;
}

interface Entry {
  /** The newest row a channel row or an answer confirmed, or null with none since the page loaded. */
  confirmed: ModeRowSlice | null;
  resetAt: string | null;
  optimistic: { action: ModeOptimistic; token: number } | null;
  /**
   * `updated_at` of the admin write that moved the standing mode from Fearless to Normal, as this
   * page heard it (the members' `Normal mode now.` note); null with none.
   */
  normalSince: string | null;
  /**
   * M20.18: this page's last `this` answer, and the server render's lock it was taken over
   * (`base`, {@link lockKey}; null with none). It shows until a render brings another lock.
   */
  lock: HeldLock | null;
}

/**
 * M20.18: a held `this` answer. `retired` flips (in place, never a new snapshot: it is set while a
 * render is being drawn, and that render already shows the server's lock) the first time a render
 * other than `base` is seen; from then on the answer never shows again, so a later render that
 * happens to carry `base` once more (A, answer B, render B, another admin back to A) is the server's.
 */
interface HeldLock {
  lobbyId: string;
  lock: ModeLock;
  base: string | null;
  retired: boolean;
}

const EMPTY: Entry = { confirmed: null, resetAt: null, optimistic: null, normalSince: null, lock: null };

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

/** `updated_at` as a number to order by; an unknown time is the oldest. */
export function rowTime(updatedAt: string | null): number {
  const ms = updatedAt === null ? Number.NaN : Date.parse(updatedAt);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A `group_modes` row this page's channel received, or a control's own route answer. Taken when it
 * is at least as new as what the store holds; `false` when it was older and ignored.
 */
export function applyModeRow(groupId: string, slice: ModeRowSlice): boolean {
  const current = entry(groupId);
  if (current.confirmed !== null && rowTime(slice.updatedAt) < rowTime(current.confirmed.updatedAt)) {
    return false;
  }
  const before = current.confirmed?.row.standing ?? lastGood.get(groupId)?.row.standing ?? null;
  const normalSince =
    slice.row.standing !== 'normal' ? null : before === 'fearless' ? slice.updatedAt : current.normalSince;
  write(groupId, { ...current, confirmed: slice, normalSince });
  return true;
}

/**
 * M20.18: a `this` answer's `thisGame` (the balanced lobby's lock after the write), on the card at
 * once. The lock has no version (`locked_at` never moves), so the answer is held against the server
 * render it was taken over: it shows while the render still carries that lock (an older render, or
 * one still in flight), and a render with any other lock (this write's own re-read, another admin's
 * write, a new lobby) takes over again.
 */
export function applyLockAnswer(groupId: string, answer: LockSlice): void {
  const rendered = lastServerLock.get(groupId);
  const base = rendered !== undefined && rendered.lobbyId === answer.lobbyId ? lockKey(rendered.lock) : null;
  write(groupId, {
    ...entry(groupId),
    lock: { lobbyId: answer.lobbyId, lock: answer.lock, base, retired: false },
  });
}

/** A lock as one string, for "is this the same lock": standing, rule (with its tag or pair), Rated. */
export function lockKey(lock: ModeLock): string {
  return `${lock.standing}/${modeKeyOf(lock.mode)}/${String(lock.rated)}`;
}

function modeKeyOf(mode: Mode): string {
  if (mode.id === 'region') return `region:${mode.blue}:${mode.red}`;
  const rule = ruleOf(mode);
  return rule === null ? mode.id : ruleKey(rule);
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

/** The tap answered or failed: its draft goes (a newer tap's stays). */
export function endOptimistic(groupId: string, token: number): void {
  const current = entry(groupId);
  if (current.optimistic?.token !== token) return;
  write(groupId, { ...current, optimistic: null });
}

/**
 * This game's notice from the Roll answer (M20 D11): `Targon vs Zaun ran short after the bans, so
 * Roll drew Shurima vs Zaun.`, per group and keyed on the lobby, so another lobby (a new night, a
 * Roll after teams came down) never shows it. The roll route's own words, never recomputed, and
 * only on the page that rolled (the server keeps no column for it).
 */
let thisGame = new Map<string, { lobbyId: string; line: string }>();

export function noteThisGame(groupId: string, lobbyId: string, line: string): void {
  thisGame = new Map(thisGame).set(groupId, { lobbyId, line });
  for (const listener of listeners) listener();
}

/** Pure: the notice for `lobbyId`, or null. */
export function thisGameNoticeOf(
  notes: ReadonlyMap<string, { lobbyId: string; line: string }>,
  groupId: string,
  lobbyId: string | null,
): string | null {
  const note = notes.get(groupId);
  return note !== undefined && lobbyId !== null && note.lobbyId === lobbyId ? note.line : null;
}

/** Tests only: the Roll notices as the hook reads them. */
export function modeStoreThisGameForTests(): ReadonlyMap<string, { lobbyId: string; line: string }> {
  return thisGame;
}

const getThisGame = () => thisGame;
const getServerThisGame = () => EMPTY_THIS_GAME;
const EMPTY_THIS_GAME: ReadonlyMap<string, { lobbyId: string; line: string }> = new Map();

/** The Roll answer's notice for this lobby, or null (the server render has none). */
export function useThisGameNotice(groupId: string, lobbyId: string | null): string | null {
  const notes = useSyncExternalStore(subscribe, getThisGame, getServerThisGame);
  return thisGameNoticeOf(notes, groupId, lobbyId);
}

/** Tests only: the store's entries as the hook reads them. */
export function modeStoreForTests(): ReadonlyMap<string, Entry> {
  return entries;
}

/** Tests only: forget every group. */
export function resetModeStoreForTests(): void {
  entries = new Map();
  thisGame = new Map();
  lastGood.clear();
  lastServerLock.clear();
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

/**
 * The draft of a tap: what the write will most likely leave, never a guess the client cannot make.
 * A standing pick empties the rule and Rated, a rule pick resets Rated, a Rated flip sets it.
 * Region wars keeps its pair when it is already pending; otherwise the server draws the pair, so
 * the card waits for the answer (the select already shows the pick).
 */
export function draftRow(row: ModeRow, action: ModeOptimistic): ModeRow {
  // A this-game tap drafts the lock ({@link draftLock}); a standing pick's row write waits for the answer.
  if (action.game === 'this') return row;
  if (action.kind === 'rated') return { ...row, rated: action.rated };
  if (action.choice === 'normal' || action.choice === 'fearless') {
    return { standing: action.choice, pending: null, rated: null };
  }
  const rule = ruleFromKey(action.choice);
  if (rule === null) return row;
  if (rule.id === 'region') return row.pending?.id === 'region' ? { ...row, rated: null } : row;
  return { ...row, pending: rule as PendingRule, rated: null };
}

/**
 * M20.18: the draft of a this-game tap on the lock, as core's `lockTransition` leaves it: a
 * standing pick plays that mode with Rated at its default, a rule pick resets Rated, a Rated flip
 * sets it. Region wars keeps its pair when this game already plays it; otherwise the server draws
 * the pair, so the card waits for the answer.
 */
export function draftLock(lock: ModeLock, action: ModeOptimistic): ModeLock {
  if (action.game !== 'this') return lock;
  if (action.kind === 'rated') return { ...lock, rated: action.rated };
  if (action.choice === 'normal' || action.choice === 'fearless') {
    return { standing: action.choice, mode: { id: action.choice }, rated: null };
  }
  const rule = ruleFromKey(action.choice);
  if (rule === null) return lock;
  if (rule.id === 'region') return lock.mode.id === 'region' ? { ...lock, rated: null } : lock;
  return { ...lock, mode: rule, rated: null };
}

/**
 * The lock the card shows (M20.18): the render's, unless this page's own `this` answer was taken
 * over that very render; then a this-game tap in flight on top. Pure, so the merge is a unit test.
 */
export function mergeLock(
  server: LockSlice | null,
  groupId: string,
  store: ReadonlyMap<string, Entry>,
  withTap = true,
): ModeLock | null {
  if (server === null) return null;
  const held = (store.get(groupId) ?? EMPTY).lock;
  const base =
    held !== null && !held.retired && held.lobbyId === server.lobbyId && held.base === lockKey(server.lock)
      ? held.lock
      : server.lock;
  const tap = withTap ? (store.get(groupId) ?? EMPTY).optimistic : null;
  return tap === null ? base : draftLock(base, tap.action);
}

/** The merged slice, plus the admin's switch off Fearless as this page heard it. */
export interface MergedSlice extends ModeSlice {
  normalSince: string | null;
}

/**
 * The slice the card shows: the render's props, unless the store has confirmed something newer;
 * the later `reset_at`; then a tap in flight on top ({@link draftRow}). Pure, so the merge is a unit
 * test.
 */
export function mergeSlice(
  server: ModeSlice,
  groupId: string,
  store: ReadonlyMap<string, Entry>,
  withTap = true,
): MergedSlice {
  const held = store.get(groupId) ?? EMPTY;
  const confirmed = held.confirmed;
  const base =
    confirmed !== null && rowTime(confirmed.updatedAt) > rowTime(server.updatedAt) ? confirmed : server;
  const resetAt = laterThan(held.resetAt, server.resetAt) ? held.resetAt : server.resetAt;
  const tap = withTap ? held.optimistic : null;
  const row = tap === null ? base.row : draftRow(base.row, tap.action);
  return { row, updatedAt: base.updatedAt, resetAt, normalSince: held.normalSince };
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
 * M20.18: the card's lock, `server` (the render's, with its lobby) merged with this page's `this`
 * answers and a this-game tap in flight. The render's lock is noted per group, so an answer is
 * held against the render it was taken over ({@link applyLockAnswer}).
 */
export function useThisGameLock(groupId: string, server: LockSlice | null, withTap = true): ModeLock | null {
  const store = useSyncExternalStore(subscribe, getEntries, getServerEntries);
  noteServerLock(groupId, server);
  return mergeLock(server, groupId, store, withTap);
}

/** The render's lock for `groupId` (null: none), what a later answer is held against. Idempotent. */
export function noteServerLock(groupId: string, server: LockSlice | null): void {
  if (server === null) lastServerLock.delete(groupId);
  else lastServerLock.set(groupId, server);
  // Review fix: any render other than the held answer's base retires it for good.
  const held = entry(groupId).lock;
  if (held === null || held.retired) return;
  if (server === null || server.lobbyId !== held.lobbyId || lockKey(server.lock) !== held.base)
    held.retired = true;
}

/** The lock of the newest render per group (written by renders, idempotent). */
const lastServerLock = new Map<string, LockSlice>();

/**
 * The last render whose `group_modes` read worked, per group (audit: a failed read must not show
 * Normal). A render whose read failed carries a stand-in row; the card keeps the last good one
 * instead (and says it could not read the mode). Written only by renders that read it, idempotent.
 */
const lastGood = new Map<string, ModeSlice>();

export function lastGoodServer(groupId: string, server: ModeSlice, readFailed: boolean): ModeSlice {
  if (!readFailed) {
    const held = lastGood.get(groupId);
    if (held === undefined || rowTime(held.updatedAt) <= rowTime(server.updatedAt))
      lastGood.set(groupId, server);
    return server;
  }
  return lastGood.get(groupId) ?? server;
}
