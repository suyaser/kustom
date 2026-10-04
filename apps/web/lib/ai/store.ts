import 'server-only';
import {
  type AiFact,
  type AiLineKind,
  type AiLineRow,
  type AiLineStatus,
  type AiTokenMap,
  aiFactListSchema,
  aiLineRowSchema,
} from '@customs/db/schemas';
import { type AiGate, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { renderLine } from './check';

/**
 * Where AI lines live (M16.3, `0033_ai_lines.sql`): one row per (group, kind, subject), written
 * once, with the status machine below; the player opt-out; the admin's `Hide`; and the render-side
 * read that every surface goes through. Service role only.
 *
 * Generation talks to a {@link LineStore} -- the database's ({@link dbLineStore}) in production,
 * {@link memoryLineStore} in unit tests -- so the whole flow is testable without a stack.
 */

/* ---------------------------------------------------------------------------------------------
 * The status machine (the same table as `ai_lines_guard_status` in 0033)
 * ------------------------------------------------------------------------------------------- */

export const LINE_TRANSITIONS: Readonly<Record<AiLineStatus, readonly AiLineStatus[]>> = {
  pending: ['published', 'rejected', 'failed'],
  failed: ['pending'],
  published: ['hidden'],
  rejected: [],
  hidden: [],
};

export function canMove(from: AiLineStatus, to: AiLineStatus): boolean {
  return LINE_TRANSITIONS[from].includes(to);
}

export class IllegalLineMove extends Error {
  constructor(from: AiLineStatus, to: AiLineStatus) {
    super(`ai_lines: ${from} -> ${to} is not an allowed move`);
    this.name = 'IllegalLineMove';
  }
}

/* ---------------------------------------------------------------------------------------------
 * Subjects
 * ------------------------------------------------------------------------------------------- */

/** What a line is about, as its unique key's third column and its typed columns. */
export type LineSubject =
  | { kind: 'game'; gameId: string }
  | { kind: 'week'; weekStart: string }
  | { kind: 'player'; playerId: string; weekStart: string };

export function subjectKey(subject: LineSubject): string {
  switch (subject.kind) {
    case 'game':
      return subject.gameId;
    case 'week':
      return subject.weekStart;
    case 'player':
      return `${subject.playerId}:${subject.weekStart}`;
  }
}

function subjectColumns(subject: LineSubject) {
  return {
    game_id: subject.kind === 'game' ? subject.gameId : null,
    player_id: subject.kind === 'player' ? subject.playerId : null,
    week_start: subject.kind === 'game' ? null : subject.weekStart,
  };
}

/* ---------------------------------------------------------------------------------------------
 * The store interface
 * ------------------------------------------------------------------------------------------- */

export interface NewLine {
  groupId: string;
  subject: LineSubject;
  facts: AiFact[];
  tokenMap: AiTokenMap;
  factHash: string;
  model: string;
  promptVersion: string;
}

export interface LineFinish {
  status: 'published' | 'rejected' | 'failed';
  text: string | null;
  rejectReason: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type ClaimResult = { claimed: true; line: AiLineRow } | { claimed: false; existing: AiLineRow };

export interface LineStore {
  read(groupId: string, kind: AiLineKind, subject: string): Promise<AiLineRow | null>;
  /** Inserts a `pending` row, or returns the row already there (another generation got it first). */
  claim(line: NewLine): Promise<ClaimResult>;
  /**
   * `failed` -> `pending` again, or a stale `pending` re-stamped, only if the row is still exactly
   * as `seen` (compare-and-set on `updated_at`). The caller decides staleness (`retakeable`).
   */
  retake(seen: AiLineRow): Promise<AiLineRow | null>;
  /** `pending` -> published / rejected / failed. Throws {@link IllegalLineMove} otherwise. */
  finish(lineId: string, finish: LineFinish, now: Date): Promise<void>;
  /** The fact list a row was claimed with (M16.12: a retry writes from the same facts), or null. */
  readFacts(lineId: string): Promise<AiFact[] | null>;
}

/* ---------------------------------------------------------------------------------------------
 * The database store
 * ------------------------------------------------------------------------------------------- */

const LINE_COLUMNS =
  'id, group_id, kind, subject, status, text, token_map, fact_hash, model, prompt_version, attempts, reject_reason, input_tokens, output_tokens, cost_usd, created_at, updated_at, published_at' as const;

function parseRow(row: unknown): AiLineRow {
  const parsed = aiLineRowSchema.safeParse(row);
  if (!parsed.success) throw new Error(`ai store: malformed ai_lines row: ${parsed.error.message}`);
  return parsed.data;
}

export function dbLineStore(service: ServiceClient): LineStore {
  const read = async (groupId: string, kind: AiLineKind, subject: string) => {
    const { data, error } = await service
      .from('ai_lines')
      .select(LINE_COLUMNS)
      .eq('group_id', groupId)
      .eq('kind', kind)
      .eq('subject', subject)
      .maybeSingle();
    if (error) throw new Error(`ai store: read failed: ${error.message}`);
    return data === null ? null : parseRow(data);
  };

  return {
    read,
    async claim(line) {
      const key = subjectKey(line.subject);
      const { data, error } = await service
        .from('ai_lines')
        .insert({
          group_id: line.groupId,
          kind: line.subject.kind,
          subject: key,
          ...subjectColumns(line.subject),
          status: 'pending',
          facts: line.facts,
          token_map: line.tokenMap,
          fact_hash: line.factHash,
          model: line.model,
          prompt_version: line.promptVersion,
        })
        .select(LINE_COLUMNS)
        .single();
      if (!error) return { claimed: true, line: parseRow(data) };
      // 23505: the (group, kind, subject) row exists -- a second companion's ingest, a race.
      if (error.code !== '23505') throw new Error(`ai store: claim failed: ${error.message}`);
      const existing = await read(line.groupId, line.subject.kind, key);
      if (existing === null) throw new Error('ai store: claim conflicted but no row is there');
      return { claimed: false, existing };
    },
    async retake(seen) {
      if (seen.status !== 'pending' && !canMove(seen.status, 'pending')) return null;
      const { data, error } = await service
        .from('ai_lines')
        // The trigger re-stamps updated_at, so a second taker's compare-and-set misses.
        .update({ status: 'pending' })
        .eq('id', seen.id)
        .eq('status', seen.status)
        .eq('updated_at', seen.updated_at)
        .select(LINE_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`ai store: retake failed: ${error.message}`);
      return data === null ? null : parseRow(data);
    },
    async finish(lineId, finish, now) {
      if (!canMove('pending', finish.status)) throw new IllegalLineMove('pending', finish.status);
      const { data, error } = await service
        .from('ai_lines')
        .update({
          status: finish.status,
          text: finish.text,
          reject_reason: finish.rejectReason,
          attempts: finish.attempts,
          input_tokens: finish.inputTokens,
          output_tokens: finish.outputTokens,
          cost_usd: finish.costUsd,
          published_at: finish.status === 'published' ? now.toISOString() : null,
        })
        .eq('id', lineId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`ai store: finish failed: ${error.message}`);
      if (data === null) throw new Error(`ai store: line ${lineId} was not pending`);
    },
    async readFacts(lineId) {
      const { data, error } = await service.from('ai_lines').select('facts').eq('id', lineId).maybeSingle();
      if (error) throw new Error(`ai store: facts read failed: ${error.message}`);
      if (data === null) return null;
      const parsed = aiFactListSchema.safeParse(data.facts);
      return parsed.success ? parsed.data : null;
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * The memory store (unit tests, keyless local dev)
 * ------------------------------------------------------------------------------------------- */

export interface MemoryLine extends AiLineRow {
  facts: AiFact[];
}

export function memoryLineStore(now: () => Date = () => new Date()): LineStore & { rows: MemoryLine[] } {
  const rows: MemoryLine[] = [];
  let next = 0;
  let clock = 0;
  // Strictly increasing, like updated_at, so a compare-and-set on it means something.
  const stamp = () => new Date(now().getTime() + ++clock).toISOString();
  const find = (groupId: string, kind: AiLineKind, subject: string) =>
    rows.find((row) => row.group_id === groupId && row.kind === kind && row.subject === subject) ?? null;
  return {
    rows,
    async read(groupId, kind, subject) {
      const row = find(groupId, kind, subject);
      return row === null ? null : { ...row };
    },
    async claim(line) {
      const key = subjectKey(line.subject);
      const existing = find(line.groupId, line.subject.kind, key);
      if (existing !== null) return { claimed: false, existing: { ...existing } };
      next += 1;
      const now = stamp();
      const row: MemoryLine = {
        id: `10000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
        group_id: line.groupId,
        kind: line.subject.kind,
        subject: key,
        status: 'pending',
        text: null,
        token_map: line.tokenMap,
        fact_hash: line.factHash,
        model: line.model,
        prompt_version: line.promptVersion,
        attempts: 0,
        reject_reason: null,
        created_at: now,
        updated_at: now,
        published_at: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        facts: line.facts,
      };
      rows.push(row);
      return { claimed: true, line: { ...row } };
    },
    async retake(seen) {
      const row = rows.find((entry) => entry.id === seen.id);
      if (row === undefined || row.status !== seen.status || row.updated_at !== seen.updated_at) return null;
      if (row.status !== 'pending' && !canMove(row.status, 'pending')) return null;
      row.status = 'pending';
      row.updated_at = stamp();
      return { ...row };
    },
    async finish(lineId, finish, now) {
      const row = rows.find((entry) => entry.id === lineId);
      if (row === undefined) throw new Error(`no line ${lineId}`);
      if (!canMove(row.status, finish.status)) throw new IllegalLineMove(row.status, finish.status);
      row.status = finish.status;
      row.text = finish.text;
      row.reject_reason = finish.rejectReason;
      row.attempts = finish.attempts;
      row.input_tokens = finish.inputTokens;
      row.output_tokens = finish.outputTokens;
      row.cost_usd = finish.costUsd;
      row.published_at = finish.status === 'published' ? now.toISOString() : null;
      row.updated_at = stamp();
    },
    async readFacts(lineId) {
      return rows.find((entry) => entry.id === lineId)?.facts ?? null;
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * Opt-out (brief 1.4, D6)
 * ------------------------------------------------------------------------------------------- */

/** The players of a group who asked not to be written about. Throws on a database error. */
export async function readOptedOut(service: ServiceClient, groupId: string): Promise<Set<string>> {
  const { data, error } = await service
    .from('group_memberships')
    .select('player_id')
    .eq('group_id', groupId)
    .eq('ai_opt_out', true);
  if (error) throw new Error(`ai store: opt-out read failed: ${error.message}`);
  return new Set((data ?? []).map((row) => row.player_id));
}

/**
 * The group's latest published lines of a kind, newest first, as stored (tokens, never names;
 * M16.8). Hidden lines are left out. Throws on a database error (the caller treats that as none).
 */
export async function readRecentLines(
  service: ServiceClient,
  groupId: string,
  kind: AiLineKind,
  limit: number,
): Promise<string[]> {
  const { data, error } = await service
    .from('ai_lines')
    .select('text')
    .eq('group_id', groupId)
    .eq('kind', kind)
    .eq('status', 'published')
    .is('hidden_at', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ai store: recent lines read failed: ${error.message}`);
  return (data ?? []).flatMap((row) => (typeof row.text === 'string' ? [row.text] : []));
}

/** Who is asking: the player about themselves, or an admin or owner of the group about a member. */
export type OptOutActor = 'self' | 'group_admin';

export type OptOutResult =
  | { ok: true; optOut: boolean }
  | { ok: false; reason: 'admin_cannot_opt_in' | 'not_a_member' };

/**
 * Sets a member's `Write about me` (stored inverted as `ai_opt_out`). **An admin can only switch
 * it off for someone (`optOut: true`), never back on**: only the player turns themselves back on
 * (D6). The route that calls this decides who the actor is from the session, never from the body.
 * Not gated on Premium: asking not to be written about always works.
 */
export async function setAiOptOut(
  service: ServiceClient,
  input: { groupId: string; playerId: string; optOut: boolean; actor: OptOutActor },
): Promise<OptOutResult> {
  if (input.actor === 'group_admin' && !input.optOut) return { ok: false, reason: 'admin_cannot_opt_in' };
  const { data, error } = await service
    .from('group_memberships')
    .update({ ai_opt_out: input.optOut })
    .eq('group_id', input.groupId)
    .eq('player_id', input.playerId)
    .select('ai_opt_out')
    .maybeSingle();
  if (error) throw new Error(`ai store: opt-out write failed: ${error.message}`);
  if (data === null) return { ok: false, reason: 'not_a_member' };
  return { ok: true, optOut: data.ai_opt_out };
}

/* ---------------------------------------------------------------------------------------------
 * Hide (brief 1.5, D8)
 * ------------------------------------------------------------------------------------------- */

/**
 * An admin's `Hide`: a published line becomes `hidden` for everybody, for good. False when there
 * was no published line of that group to hide (already hidden, rejected, another group's). The
 * route checks the admin; this only writes.
 */
export async function hideLine(
  service: ServiceClient,
  input: { groupId: string; lineId: string; hiddenBy: string | null; now: Date },
): Promise<boolean> {
  const { data, error } = await service
    .from('ai_lines')
    .update({ status: 'hidden', hidden_at: input.now.toISOString(), hidden_by: input.hiddenBy })
    .eq('id', input.lineId)
    .eq('group_id', input.groupId)
    .eq('status', 'published')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`ai store: hide failed: ${error.message}`);
  return data !== null;
}

/* ---------------------------------------------------------------------------------------------
 * The render-side read
 * ------------------------------------------------------------------------------------------- */

export interface ShownLine {
  lineId: string;
  /** Names substituted, unescaped: the surface escapes for itself (web, Discord). */
  text: string;
}

/**
 * The line a surface shows for one subject, or null for "nothing, like a group without
 * Premium". Reads the gate (`lib/premium`), the line, and the group's opt-outs, then asks
 * `renderLine`. **Never throws**: a failed read is a missing line (brief 4.6). Never generates.
 */
export async function loadShownLine(
  service: ServiceClient,
  input: {
    groupId: string;
    subject: LineSubject;
    nameOf: (playerId: string) => string | null;
    /** Tests pass a gate; production reads it. */
    gate?: AiGate | null;
  },
): Promise<ShownLine | null> {
  try {
    const gate = input.gate === undefined ? await readAiGate(service, input.groupId) : input.gate;
    if (gate === null || !gate.premium || !gate.linesEnabled) return null;
    const row = await dbLineStore(service).read(input.groupId, input.subject.kind, subjectKey(input.subject));
    if (row === null || row.status !== 'published') return null;
    const optedOut = await readOptedOut(service, input.groupId);
    const text = renderLine({
      gate,
      line: { status: row.status, text: row.text, tokenMap: row.token_map },
      optedOut,
      nameOf: input.nameOf,
    });
    return text === null ? null : { lineId: row.id, text };
  } catch (error) {
    console.error('ai store: no line shown', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
