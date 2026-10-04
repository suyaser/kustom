import 'server-only';
import type { AiLineKind, AiLineRow } from '@customs/db/schemas';
import { type AiGate, aiGateOpen, readAiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { checkLine } from './check';
import { AI_TIMEOUT_MS, type AiClient, aiClientFromEnv } from './client';
import { GAME_LINE_WINDOW_MS, gameLineEligibility, type SkipReason } from './eligibility';
import {
  buildGameFacts,
  buildPlayerFacts,
  buildPrompt,
  buildWeekFacts,
  exceptionalAngle,
  type FactList,
  factHash,
  type GameFactsInput,
  type GameMeta,
  leadAngleOf,
  loadGameFactsInput,
  type PlayerFactsInput,
  PROMPT_VERSION,
  RECENT_LINES,
  readGameMeta,
  type WeekFactsInput,
} from './facts';
import { AI_FEATURES } from './meter';

// Kept apart so the pages' reads never load this file (and the model client): re-exported here.
export { GAME_LINE_WINDOW_MS, gameLineEligibility, type SkipReason } from './eligibility';

import {
  dbLineStore,
  type LineStore,
  type LineSubject,
  readOptedOut,
  readRecentLines,
  subjectKey,
} from './store';

/**
 * Writing a line (M16.3; brief 4.5 and 4.6, decision M16.1 D8). The flow every feature shares:
 *
 * 1. **Quiet unless everything says yes.** No key (no client), the gate closed (not Premium, AI
 *    lines off, unreadable), a game that was not ingested live while Premium was on, nobody left
 *    after opt-outs: return `skipped` and touch nothing.
 * 2. **Once per subject.** A row for (group, kind, subject) already there means done: `cached`,
 *    no call -- whatever its fact hash, because a stored line is never rewritten (a rebuild, a
 *    second companion, a re-render). The claim is an insert on the unique key, so two racing
 *    generations make one call.
 * 3. **At most two model attempts**, the second told why the first was refused. A transient API
 *    error is retried once at once (it does not use up an attempt); after that the row is
 *    `failed` and a later call inside the subject's retry window may take it over.
 * 4. **Checked before it is stored as published.** Two refusals store `rejected` with the reason
 *    and the last text, shown nowhere, and the subject is finished for good.
 *
 * Never throws and never surfaces anything to friends: every failure is a missing line plus one
 * server log line (brief 4.6). Never runs on a page view (the callers are ingest and the weekly job).
 */

export const MAX_ATTEMPTS = 2;

/**
 * The weekly kinds may retry a transient failure while their week is still the one on show: six
 * days from the claim, so before the next Sunday closes another week (M16.12; was four hours, which
 * a daily cron never reached). Refusals and timeouts use no attempt, so a week that hit the cap or
 * the kill switch is retried by each daily cron call until it fits or the window closes.
 */
export const WEEKLY_RETRY_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Refusals that may clear on their own (M16.12): the budget (a cap lifted, the 1st of the month)
 * and the kill switch (turned back on). Transient for the weekly kinds only; a game line keeps its
 * one immediate retry and nothing more (decision row 2026-10-04, M16.12).
 */
const TRANSIENT_REFUSALS: ReadonlySet<string> = new Set([
  'group_cap',
  'global_cap',
  'kill_switch',
  'meter_unavailable',
]);

export type GenerateOutcome =
  | { status: 'published'; lineId: string; text: string }
  | { status: 'rejected'; lineId: string; reason: string }
  | { status: 'failed'; lineId: string | null; reason: string }
  | { status: 'cached'; lineId: string }
  | { status: 'skipped'; reason: SkipReason };

export interface GenerateDeps {
  client: AiClient | null;
  store: LineStore;
  readGate: (groupId: string) => Promise<AiGate | null>;
  readOptedOut: (groupId: string) => Promise<ReadonlySet<string>>;
  now: () => Date;
  /**
   * The group's latest published lines of a kind, newest first (M16.8): a game line is told not to
   * echo them. Optional; a failure or absence is an empty list, never a failed generation.
   */
  readRecentLines?: (groupId: string, kind: AiLineKind) => Promise<string[]>;
  /**
   * Epoch ms the caller must be done by (M16.6 code review: a cron function's `maxDuration`). No
   * call is started that could still be running past it (a call is at most `AI_TIMEOUT_MS`): the
   * subject is left `failed` with a transient reason, so a later run inside its retry window takes
   * it over. Absent means no deadline (ingest's `after()` has its own 60 s and one game line).
   */
  deadline?: number;
  /** Before the one immediate retry of a transient error. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Production wiring: the env's client (null without a key), the database store and gate. */
export function generateDepsFor(service: ServiceClient): GenerateDeps {
  return {
    client: aiClientFromEnv(service),
    store: dbLineStore(service),
    readGate: (groupId) => readAiGate(service, groupId),
    readOptedOut: (groupId) => readOptedOut(service, groupId),
    now: () => new Date(),
    readRecentLines: (groupId, kind) => readRecentLines(service, groupId, kind, RECENT_LINES),
  };
}

/**
 * A `pending` row older than this was left by a generation that died after its claim (a function
 * timeout, a crash): it may be taken over like a transient failure. Longer than any live
 * generation can take (two attempts at a 20 s timeout plus one retry), so a running one is never
 * raced; still bounded by the subject's retry window.
 */
export const PENDING_STALE_MS = 3 * 60 * 1000;

const TRANSIENT_PREFIX = 'transient:';
const TRANSIENT_RETRY_DELAY_MS = 1_500;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * May a row be taken over? A `failed` one only for a transient error; a `pending` one only once it
 * is stale (its generation died); either only inside the subject's retry window.
 */
export function retakeable(row: AiLineRow, now: Date, windowMs: number): boolean {
  if (row.attempts >= MAX_ATTEMPTS) return false;
  if (now.getTime() - Date.parse(row.created_at) > windowMs) return false;
  if (row.status === 'failed') return (row.reject_reason ?? '').startsWith(TRANSIENT_PREFIX);
  if (row.status === 'pending') return now.getTime() - Date.parse(row.updated_at) >= PENDING_STALE_MS;
  return false;
}

/**
 * The shared core: claim, call, check, store. `list` is built by the caller after the gate and
 * opt-outs were read; `retryWindowMs` bounds taking over a transient failure.
 */
async function writeLine(
  deps: GenerateDeps,
  input: { groupId: string; subject: LineSubject; list: FactList; retryWindowMs: number },
): Promise<GenerateOutcome> {
  const { client, store } = deps;
  const log = deps.log ?? ((line: string) => console.info(line));
  const sleep = deps.sleep ?? defaultSleep;
  if (client === null) return { status: 'skipped', reason: 'no_key' };
  const { groupId, subject, list } = input;
  const key = subjectKey(subject);
  const feature = AI_FEATURES[subject.kind];

  let line: AiLineRow;
  const existing = await store.read(groupId, subject.kind, key);
  if (existing !== null) {
    if (!retakeable(existing, deps.now(), input.retryWindowMs))
      return { status: 'cached', lineId: existing.id };
    const taken = await store.retake(existing);
    if (taken === null) return { status: 'cached', lineId: existing.id };
    line = taken;
  } else {
    const claim = await store.claim({
      groupId,
      subject,
      facts: list.facts,
      tokenMap: list.tokenMap,
      factHash: factHash(list),
      model: feature.model,
      promptVersion: PROMPT_VERSION,
    });
    if (!claim.claimed) return { status: 'cached', lineId: claim.existing.id };
    line = claim.line;
  }

  let attempts = line.attempts;
  let retryReason: string | null = line.reject_reason?.startsWith(TRANSIENT_PREFIX)
    ? null
    : line.reject_reason;
  // Totals over every attempt of this subject, a taken-over failure's included.
  let inputTokens = line.input_tokens;
  let outputTokens = line.output_tokens;
  let cost = line.cost_usd;
  let lastText: string | null = null;
  const finish = async (
    status: 'published' | 'rejected' | 'failed',
    text: string | null,
    reason: string | null,
  ) => {
    await store.finish(
      line.id,
      { status, text, rejectReason: reason, attempts, inputTokens, outputTokens, costUsd: cost },
      deps.now(),
    );
  };

  let recent: string[] = [];
  // Game lines and, since M16.19, scouting reports (the same Sunday's other reports) see the
  // group's recent lines of their kind, so they do not open alike. Since 2026-10-04 the week reads
  // its earlier Sundays too; only DeepSeek's prompt shows them (Claude's ignores a week's list).
  if (deps.readRecentLines !== undefined) {
    try {
      recent = await deps.readRecentLines(groupId, subject.kind);
    } catch (error) {
      log(`ai: recent lines unread (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  // Room for one more call before the deadline (and the retry's pause, when there is one).
  const fits = (pauseMs: number) =>
    deps.deadline === undefined || deps.now().getTime() + pauseMs + AI_TIMEOUT_MS <= deps.deadline;
  const outOfTime = async (): Promise<GenerateOutcome> => {
    const reason = `${TRANSIENT_PREFIX}deadline`;
    await finish('failed', lastText, reason);
    log(`ai: ${subject.kind} line ${line.id} left for a later run (deadline)`);
    return { status: 'failed', lineId: line.id, reason };
  };

  while (attempts < MAX_ATTEMPTS) {
    if (!fits(0)) return outOfTime();
    const prompt = buildPrompt(list, retryReason, recent);
    const request = {
      model: prompt.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
    };
    let result = await client.complete({ groupId, lineId: line.id, request });
    if (!result.ok && result.retryable && fits(TRANSIENT_RETRY_DELAY_MS)) {
      cost += result.costUsd;
      await sleep(TRANSIENT_RETRY_DELAY_MS);
      result = await client.complete({ groupId, lineId: line.id, request });
    }
    if (!result.ok) {
      cost += result.costUsd;
      const reason =
        'refused' in result
          ? `${subject.kind !== 'game' && TRANSIENT_REFUSALS.has(result.refused) ? TRANSIENT_PREFIX : ''}refused:${result.refused}`
          : `${result.retryable ? TRANSIENT_PREFIX : 'error:'}${result.error}`;
      await finish('failed', lastText, reason);
      log(`ai: ${subject.kind} line ${line.id} failed (${reason})`);
      return { status: 'failed', lineId: line.id, reason };
    }

    cost += result.costUsd;
    inputTokens += result.reply.inputTokens;
    outputTokens += result.reply.outputTokens;
    attempts += 1;
    let check = checkLine(result.reply.text, list, { stopReason: result.reply.stopReason });
    // M16.15: no two published game lines in a row in a group lead with the same angle, unless
    // this game's is exceptional (an upset, a 7+ or record streak). A repeat is refused like any
    // other line, and the second attempt is told why.
    if (check.ok && subject.kind === 'game' && recent[0] !== undefined) {
      const lead = leadAngleOf(check.text);
      if (lead !== 'other' && lead === leadAngleOf(recent[0]) && !exceptionalAngle(list, lead)) {
        check = {
          ok: false,
          code: 'shape',
          reason: `repeat: it leads with the same kind of story (${lead}) as the group's previous line`,
        };
      }
    }
    if (check.ok) {
      await finish('published', check.text, null);
      log(`ai: ${subject.kind} line ${line.id} published after ${attempts} attempt(s)`);
      return { status: 'published', lineId: line.id, text: check.text };
    }
    lastText = result.reply.text.slice(0, 2000);
    retryReason = `${check.code}: ${check.reason}`;
    log(`ai: ${subject.kind} line ${line.id} refused by the checker (${check.code})`);
  }

  await finish('rejected', lastText, retryReason);
  return { status: 'rejected', lineId: line.id, reason: retryReason ?? 'rejected' };
}

/**
 * Re-attempts a weekly line that failed transiently (M16.12), from the facts it was claimed with:
 * the window cron calls this daily for the closed week's storyline, to fill the board (it never
 * posts anything). Nothing happens unless the row is there and may be taken over (`retakeable`:
 * transient, inside {@link WEEKLY_RETRY_WINDOW_MS}, attempts left), the gate is open, and nobody
 * the stored facts name has opted out since. Never throws.
 */
export function retryStoredLine(
  deps: GenerateDeps,
  input: { groupId: string; subject: Extract<LineSubject, { kind: 'week' | 'player' }> },
): Promise<GenerateOutcome> {
  return quietly(`${input.subject.kind} retry`, async () => {
    if (deps.client === null) return { status: 'skipped', reason: 'no_key' };
    if (!aiGateOpen(await deps.readGate(input.groupId))) return { status: 'skipped', reason: 'gate_closed' };
    const row = await deps.store.read(input.groupId, input.subject.kind, subjectKey(input.subject));
    if (row === null) return { status: 'skipped', reason: 'no_facts' };
    if (!retakeable(row, deps.now(), WEEKLY_RETRY_WINDOW_MS)) return { status: 'cached', lineId: row.id };
    const facts = await deps.store.readFacts(row.id);
    if (facts === null) return { status: 'skipped', reason: 'no_facts' };
    const optedOut = await deps.readOptedOut(input.groupId);
    if (Object.values(row.token_map).some((playerId) => optedOut.has(playerId)))
      return { status: 'skipped', reason: 'no_facts' };
    const list: FactList = { kind: input.subject.kind, facts, tokenMap: row.token_map, upset: false };
    return writeLine(deps, {
      groupId: input.groupId,
      subject: input.subject,
      list,
      retryWindowMs: WEEKLY_RETRY_WINDOW_MS,
    });
  });
}

/** Runs `body`, turning any throw into a logged `failed`: generation never fails its caller. */
async function quietly(label: string, body: () => Promise<GenerateOutcome>): Promise<GenerateOutcome> {
  try {
    return await body();
  } catch (error) {
    console.error(`ai: ${label} generation failed`, error instanceof Error ? error.message : 'unknown error');
    return { status: 'failed', lineId: null, reason: 'exception' };
  }
}

/* ---------------------------------------------------------------------------------------------
 * The three features' entry points
 * ------------------------------------------------------------------------------------------- */

export interface GameLineSources {
  readGameMeta: (groupId: string, gameId: string) => Promise<GameMeta | null>;
  loadGameFactsInput: (
    groupId: string,
    gameId: string,
    optedOut: ReadonlySet<string>,
  ) => Promise<GameFactsInput | null>;
}

export function gameLineSourcesFor(service: ServiceClient): GameLineSources {
  return {
    readGameMeta: (groupId, gameId) => readGameMeta(service, groupId, gameId),
    loadGameFactsInput: (groupId, gameId, optedOut) => loadGameFactsInput(service, groupId, gameId, optedOut),
  };
}

/**
 * The game recap line (M16.4 calls this after ingest, without waiting on it). Live-ingested games
 * of a Premium group with AI lines on, recorded after Premium was switched on; nothing backfilled
 * or retroactive.
 */
export function generateGameLine(
  deps: GenerateDeps,
  sources: GameLineSources,
  input: { groupId: string; gameId: string },
): Promise<GenerateOutcome> {
  return quietly('game', async () => {
    if (deps.client === null) return { status: 'skipped', reason: 'no_key' };
    const gate = await deps.readGate(input.groupId);
    if (!aiGateOpen(gate)) return { status: 'skipped', reason: 'gate_closed' };
    const eligible = gameLineEligibility(
      await sources.readGameMeta(input.groupId, input.gameId),
      gate,
      deps.now(),
    );
    if (!eligible.ok) return { status: 'skipped', reason: eligible.reason };
    // Opt-outs first (M16.9): an opted-out player's history is never read.
    const optedOut = await deps.readOptedOut(input.groupId);
    const facts = await sources.loadGameFactsInput(input.groupId, input.gameId, optedOut);
    if (facts === null) return { status: 'skipped', reason: 'no_game' };
    const list = buildGameFacts(facts, optedOut);
    if (list === null) return { status: 'skipped', reason: 'no_facts' };
    return writeLine(deps, {
      groupId: input.groupId,
      subject: { kind: 'game', gameId: input.gameId },
      list,
      retryWindowMs: GAME_LINE_WINDOW_MS,
    });
  });
}

/** The weekly storyline (M16.5 calls this from the Sunday job with the post's own numbers). */
export function generateWeekLine(
  deps: GenerateDeps,
  input: { groupId: string; week: WeekFactsInput },
): Promise<GenerateOutcome> {
  return quietly('week', async () => {
    if (deps.client === null) return { status: 'skipped', reason: 'no_key' };
    if (!aiGateOpen(await deps.readGate(input.groupId))) return { status: 'skipped', reason: 'gate_closed' };
    const list = buildWeekFacts(input.week, await deps.readOptedOut(input.groupId));
    if (list === null) return { status: 'skipped', reason: 'no_facts' };
    return writeLine(deps, {
      groupId: input.groupId,
      subject: { kind: 'week', weekStart: input.week.weekStart },
      list,
      retryWindowMs: WEEKLY_RETRY_WINDOW_MS,
    });
  });
}

/** One scouting report (M16.6 calls this from the Sunday job, never from a page). */
export function generatePlayerLine(
  deps: GenerateDeps,
  input: { groupId: string; player: PlayerFactsInput },
): Promise<GenerateOutcome> {
  return quietly('player', async () => {
    if (deps.client === null) return { status: 'skipped', reason: 'no_key' };
    if (!aiGateOpen(await deps.readGate(input.groupId))) return { status: 'skipped', reason: 'gate_closed' };
    const list = buildPlayerFacts(input.player, await deps.readOptedOut(input.groupId));
    if (list === null) return { status: 'skipped', reason: 'no_facts' };
    return writeLine(deps, {
      groupId: input.groupId,
      subject: { kind: 'player', playerId: input.player.playerId, weekStart: input.player.weekStart },
      list,
      retryWindowMs: WEEKLY_RETRY_WINDOW_MS,
    });
  });
}
