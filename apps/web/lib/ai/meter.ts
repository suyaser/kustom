import 'server-only';
import {
  type AiLineKind,
  type AiMonthSpendRow,
  type AiReserveRefusal,
  aiMonthSpendRowSchema,
  aiReserveResultSchema,
} from '@customs/db/schemas';
import { type AiProvider, aiProviderOf } from '../env';
import { type AiGate, aiGateOpen } from '../premium';
import type { ServiceClient } from '../supabase';

/**
 * The AI meter and its config (M16.3; brief 3.1 to 3.3, decision M16.1 D7, the user's 2026-10-04
 * budget): which model writes which line, what each costs, and whether a call fits the budget.
 *
 * **One config table.** Model ids, prices and per-feature limits live here and nowhere else, so a
 * newer model or a price change is a one-line edit plus a fixture run through the checker. No model
 * is ever chosen per request at runtime.
 *
 * **The caps are enforced in the database** (`ai_reserve_call`, `0033`): a call is reserved at its
 * worst case under a transaction-scoped advisory lock before it is made, so two calls racing for the
 * last cents cannot both pass, and settled at its real cost after. {@link decideBudget} is the same
 * rule in TypeScript, for the in-memory meter the tests and keyless local dev use and for the
 * admin's budget line; the two are kept in step by `meter.test.ts` and the integration test.
 */

/* ---------------------------------------------------------------------------------------------
 * The config table
 * ------------------------------------------------------------------------------------------- */

/**
 * Prices in USD per million tokens, standard (non-batch, global routing) rates. `cachedInput` is
 * the price of an input token the provider reports as a cache hit; a model without one bills every
 * input token at `input`.
 *
 * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing and the models overview
 * (https://platform.claude.com/docs/en/about-claude/models/overview), both read 2026-10-04.
 * Haiku 4.5 is $1 in / $5 out. Sonnet 5.5 is $2 in / $10 out -- **not** the $3 / $15 the brief
 * assumed: Sonnet 5's $2 / $10 launch price became the standard price and the planned 1 September
 * 2026 rise was cancelled (the pricing page's footnote 3), and Sonnet 5.5 is listed at $2 / $10.
 * The models overview lists Haiku 4.5's retirement as "not sooner than October 15, 2026".
 *
 * DeepSeek: https://api-docs.deepseek.com/quick_start/pricing, read 2026-10-04. **Peak** prices
 * (01:00-04:00 and 06:00-10:00 UTC, weekdays); every other hour is half price, but the meter always
 * prices at peak, so a cost is never under-counted. `deepseek-flash` is DeepSeek-V4.1-Flash, $0.30
 * in (cache miss) / $0.006 (cache hit) / $1.20 out. `deepseek-v4-pro` (V4-Pro-0813) is $1.32 /
 * $0.044 / $3.96. The 2026-09-10 release note said Pro requests would route to Flash; on
 * 2026-10-04 `/models` lists it, and its replies carry `model: deepseek-v4-pro` with their own
 * token counts, so it is a model of its own.
 *
 * `temperature` is sent when not null. `thinkingOff` is what the request sends to switch thinking off, or null when the model does not
 * think unless asked. Every DeepSeek model thinks by default (effort `high`): left on, the
 * reasoning is billed as output, runs into `max_tokens` and takes about 11 s, so the DeepSeek
 * entries are never null (`client.test.ts`).
 */
/**
 * DeepSeek's sampling temperature (its default is 1.0). Our lines are rule-bound: at 1.0 the same
 * prompt swung from 2 to 13 refused attempts in 20 between two eval runs; lower keeps it steadier.
 * Claude models send none (their tuned default).
 */
const DEEPSEEK_TEMPERATURE = 0.7;

export const AI_MODELS = {
  'claude-haiku-4-5-20251001': {
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    inputUsdPerMTok: 1,
    cachedInputUsdPerMTok: null,
    outputUsdPerMTok: 5,
    /** Haiku 4.5 does not think unless asked; nothing to send. */
    thinkingOff: null,
    temperature: null,
  },
  'claude-sonnet-5-5': {
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    inputUsdPerMTok: 2,
    cachedInputUsdPerMTok: null,
    outputUsdPerMTok: 10,
    /**
     * Adaptive thinking is on by default; a short paragraph from a fact list needs none. Turned
     * off with `thinking: { type: 'between_tools' }`: this model answers `disabled` with a 400.
     */
    thinkingOff: { type: 'between_tools' },
    temperature: null,
  },
  'deepseek-flash': {
    provider: 'deepseek',
    label: 'DeepSeek V4.1 Flash',
    inputUsdPerMTok: 0.3,
    cachedInputUsdPerMTok: 0.006,
    outputUsdPerMTok: 1.2,
    /** DeepSeek's Anthropic-format endpoint takes `thinking: { type: 'disabled' }` (thinking-mode guide). */
    thinkingOff: { type: 'disabled' },
    temperature: DEEPSEEK_TEMPERATURE,
  },
  'deepseek-v4-pro': {
    provider: 'deepseek',
    label: 'DeepSeek V4 Pro',
    inputUsdPerMTok: 1.32,
    cachedInputUsdPerMTok: 0.044,
    outputUsdPerMTok: 3.96,
    thinkingOff: { type: 'disabled' },
    temperature: DEEPSEEK_TEMPERATURE,
  },
} as const satisfies Record<
  string,
  {
    provider: AiProvider;
    label: string;
    inputUsdPerMTok: number;
    cachedInputUsdPerMTok: number | null;
    outputUsdPerMTok: number;
    thinkingOff: { type: 'between_tools' | 'disabled' } | null;
    temperature: number | null;
  }
>;

export type AiModel = keyof typeof AI_MODELS;

export const AI_PRICES_CHECKED = '2026-10-04';

/** Per feature: the model (brief 3.1), the output ceiling, and the checker's shape (brief 4.4 check 6). */
export interface AiFeature {
  model: AiModel;
  /** `max_tokens`: also the output side of the worst case. */
  maxTokens: number;
  maxChars: number;
  minSentences: number;
  maxSentences: number;
}

/**
 * The checker's shape per feature, the same for every provider: a provider switch never loosens a
 * length cap.
 */
const FEATURE_SHAPES: Record<AiLineKind, Omit<AiFeature, 'model'>> = {
  /** The game recap line: one sentence or two, at most 220 characters. */
  game: { maxTokens: 150, maxChars: 220, minSentences: 1, maxSentences: 2 },
  /** The weekly storyline: one paragraph, at most 600 characters. */
  week: { maxTokens: 400, maxChars: 600, minSentences: 2, maxSentences: 6 },
  /** The scouting report: two or three sentences, at most 300 characters. */
  player: { maxTokens: 200, maxChars: 300, minSentences: 2, maxSentences: 3 },
};

/**
 * Which model writes which line, per provider.
 *
 * Anthropic: Sonnet 5.5 for all three since M16.8 / M16.9 (on the eval set Haiku 4.5 wrote box
 * scores where Sonnet told the game's story; Haiku 4.5 also retires no sooner than 2026-10-15).
 *
 * DeepSeek: V4 Pro for all three (the user's 2026-10-04 move). `/models` lists both
 * `deepseek-flash` and `deepseek-v4-pro`, and Pro answers as itself. On the eval month Pro met
 * Sonnet's refusal rates on every kind (game 16% of attempts, 2 of 75 lost; week 6%; scouting
 * 5-10%) where Flash missed scouting (30%, 2 of 18 lost); Pro is about $0.0012 a game line at
 * peak price with the system prompt cached, about a fifth of Sonnet's.
 */
export const AI_FEATURE_MODELS: Record<AiProvider, Record<AiLineKind, AiModel>> = {
  anthropic: { game: 'claude-sonnet-5-5', week: 'claude-sonnet-5-5', player: 'claude-sonnet-5-5' },
  deepseek: { game: 'deepseek-v4-pro', week: 'deepseek-v4-pro', player: 'deepseek-v4-pro' },
};

/** The feature table for one provider: the models from {@link AI_FEATURE_MODELS}, the shapes shared. */
export function featuresFor(provider: AiProvider): Record<AiLineKind, AiFeature> {
  const models = AI_FEATURE_MODELS[provider];
  return {
    game: { model: models.game, ...FEATURE_SHAPES.game },
    week: { model: models.week, ...FEATURE_SHAPES.week },
    player: { model: models.player, ...FEATURE_SHAPES.player },
  };
}

/**
 * This process's provider ({@link aiProviderOf}: `AI_PROVIDER` and which keys are set), fixed at
 * start-up. No model is ever chosen per request at runtime.
 */
export const AI_PROVIDER: AiProvider = aiProviderOf(process.env);

export const AI_FEATURES: Record<AiLineKind, AiFeature> = featuresFor(AI_PROVIDER);

/** The user's caps (2026-10-04). The live figures are `groups.ai_monthly_cap_usd` and `ai_settings`. */
export const DEFAULT_GROUP_MONTHLY_CAP_USD = 2;
export const DEFAULT_GLOBAL_MONTHLY_CAP_USD = 20;

/**
 * Below this much left, a group's AI is "paused" for the admin's budget line: no feature's worst
 * case fits any more (a game line's is about $0.02 on Sonnet since M16.8; see `meter.test.ts`).
 */
export const PAUSE_MARGIN_USD = 0.04;

/* ---------------------------------------------------------------------------------------------
 * Cost
 * ------------------------------------------------------------------------------------------- */

/** Rounds up to the ledger's precision (`numeric(10, 6)`), so a cost is never under-counted. */
function ceilMicro(usd: number): number {
  return Math.max(0, Math.ceil(usd * 1e6 - 1e-6)) / 1e6;
}

/**
 * What a finished call cost, from the token counts the API reported. `inputTokens` is every input
 * token; `cachedInputTokens` (at most that many) is the part reported as a cache hit, priced at
 * the model's cache price when it has one and at the full input price otherwise.
 */
export function costUsd(
  model: AiModel,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number | undefined },
): number {
  const price = AI_MODELS[model];
  const input = Math.max(0, usage.inputTokens);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens ?? 0));
  const cachedPrice = price.cachedInputUsdPerMTok ?? price.inputUsdPerMTok;
  return ceilMicro(
    ((input - cached) * price.inputUsdPerMTok +
      cached * cachedPrice +
      Math.max(0, usage.outputTokens) * price.outputUsdPerMTok) /
      1e6,
  );
}

/**
 * Tokens the request framing adds on top of the text (roles, system wrapper). Generous: the
 * worst case must never be below the bill.
 */
export const REQUEST_OVERHEAD_TOKENS = 64;

/**
 * An upper bound on a request's input tokens without asking the API: its UTF-8 byte count plus
 * the framing. Every token of a byte-level BPE tokenizer (Claude's, DeepSeek's) covers at least one byte, so a prompt
 * can never be more tokens than bytes. Our prompts are plain ASCII English (about four bytes per
 * token), so this over-reserves about fourfold, which costs nothing but headroom.
 */
export function inputTokenUpperBound(system: string, user: string): number {
  return Buffer.byteLength(system, 'utf8') + Buffer.byteLength(user, 'utf8') + REQUEST_OVERHEAD_TOKENS;
}

/**
 * The most a call can cost: every input token at the full (peak, cache-miss) input price,
 * `max_tokens` at the output price. A cache hit only ever makes the bill smaller.
 */
export function worstCaseUsd(model: AiModel, inputTokens: number, maxTokens: number): number {
  return costUsd(model, { inputTokens, outputTokens: maxTokens });
}

/* ---------------------------------------------------------------------------------------------
 * The month
 * ------------------------------------------------------------------------------------------- */

export interface MonthWindow {
  start: Date;
  /** Exclusive: the 1st of the next month, 00:00 UTC. */
  end: Date;
}

/**
 * The calendar month a call is billed to: **UTC**, the month the Anthropic console bills in, and
 * one calendar for every group so the global cap has a single reset. The brief's "group clock" is
 * the deployment's `CUSTOMS_NIGHT_TZ`, at most a few hours from UTC at the turn of a month.
 */
export function utcMonthWindow(now: Date): MonthWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/* ---------------------------------------------------------------------------------------------
 * The budget rule
 * ------------------------------------------------------------------------------------------- */

/** What the rule reads: the month's spend so far, both caps, and the switches. */
export interface BudgetState {
  callsEnabled: boolean;
  premium: boolean;
  linesEnabled: boolean;
  groupSpentUsd: number;
  groupCapUsd: number;
  globalSpentUsd: number;
  globalCapUsd: number;
}

export type BudgetDecision = { ok: true } | { ok: false; reason: AiReserveRefusal };

/**
 * May a call whose worst case is `worstCase` be made? The order and the comparisons are
 * `ai_reserve_call`'s exactly: kill switch, Premium, the group's switch, then the worst case
 * against what is left under the group's cap and under the global cap (a call that would land
 * exactly on a cap is allowed; one cent over is not).
 */
export function decideBudget(state: BudgetState, worstCase: number): BudgetDecision {
  if (!state.callsEnabled) return { ok: false, reason: 'kill_switch' };
  if (!state.premium) return { ok: false, reason: 'not_premium' };
  if (!state.linesEnabled) return { ok: false, reason: 'lines_off' };
  if (state.groupSpentUsd + worstCase > state.groupCapUsd + 1e-9) return { ok: false, reason: 'group_cap' };
  if (state.globalSpentUsd + worstCase > state.globalCapUsd + 1e-9)
    return { ok: false, reason: 'global_cap' };
  return { ok: true };
}

/* ---------------------------------------------------------------------------------------------
 * Meters
 * ------------------------------------------------------------------------------------------- */

export interface ReserveInput {
  groupId: string;
  lineId: string | null;
  model: AiModel;
  worstCaseUsd: number;
  now: Date;
}

export type ReserveResult = { ok: true; callId: string } | { ok: false; reason: AiReserveRefusal };

export interface SettleInput {
  outcome: 'ok' | 'error' | 'timeout';
  costUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string | null;
}

/** Where calls are reserved and settled. The database's in production; memory in tests. */
export interface AiMeter {
  reserve(input: ReserveInput): Promise<ReserveResult>;
  settle(callId: string, input: SettleInput): Promise<void>;
}

/** The production meter: `ai_reserve_call` / `ai_settle_call` (`0033`), service role. Throws on a DB error. */
export function dbMeter(service: ServiceClient): AiMeter {
  return {
    async reserve(input) {
      const month = utcMonthWindow(input.now);
      const { data, error } = await service.rpc('ai_reserve_call', {
        p_group_id: input.groupId,
        p_model: input.model,
        p_worst_case_usd: input.worstCaseUsd,
        p_month_start: month.start.toISOString(),
        p_month_end: month.end.toISOString(),
        ...(input.lineId === null ? {} : { p_line_id: input.lineId }),
      });
      if (error) throw new Error(`ai meter: reserve failed: ${error.message}`);
      const parsed = aiReserveResultSchema.safeParse(data);
      if (!parsed.success) throw new Error(`ai meter: malformed reserve answer: ${parsed.error.message}`);
      return parsed.data.ok
        ? { ok: true, callId: parsed.data.call_id }
        : { ok: false, reason: parsed.data.reason };
    },
    async settle(callId, input) {
      // The generated Args type marks every parameter non-null (plpgsql parameters carry no
      // nullability); the function stores a null as "not reported", which is what these are.
      const unreported = null as unknown as number & string;
      const { error } = await service.rpc('ai_settle_call', {
        p_call_id: callId,
        p_outcome: input.outcome,
        p_cost_usd: input.costUsd,
        p_input_tokens: input.inputTokens ?? unreported,
        p_output_tokens: input.outputTokens ?? unreported,
        p_request_id: input.requestId ?? unreported,
      });
      if (error) throw new Error(`ai meter: settle failed: ${error.message}`);
    },
  };
}

export interface MemoryLedgerRow {
  callId: string;
  groupId: string;
  lineId: string | null;
  model: AiModel;
  reservedUsd: number;
  costUsd: number | null;
  createdAt: Date;
  outcome: 'reserved' | SettleInput['outcome'];
}

export interface MemoryMeterState {
  callsEnabled: boolean;
  globalCapUsd: number;
  /** Per group: Premium, the AI lines switch and the monthly cap. A group not here is unknown. */
  groups: Map<string, { premium: boolean; linesEnabled: boolean; capUsd: number }>;
  ledger: MemoryLedgerRow[];
}

export function memoryMeterState(
  groups: Record<string, { premium?: boolean; linesEnabled?: boolean; capUsd?: number }> = {},
): MemoryMeterState {
  return {
    callsEnabled: true,
    globalCapUsd: DEFAULT_GLOBAL_MONTHLY_CAP_USD,
    groups: new Map(
      Object.entries(groups).map(([id, group]) => [
        id,
        {
          premium: group.premium ?? true,
          linesEnabled: group.linesEnabled ?? true,
          capUsd: group.capUsd ?? DEFAULT_GROUP_MONTHLY_CAP_USD,
        },
      ]),
    ),
    ledger: [],
  };
}

/** The month's spend in a memory ledger: settled cost, or the reservation while unsettled. */
export function memorySpend(state: MemoryMeterState, groupId: string | null, now: Date): number {
  const month = utcMonthWindow(now);
  return state.ledger
    .filter((row) => row.createdAt >= month.start && row.createdAt < month.end)
    .filter((row) => groupId === null || row.groupId === groupId)
    .reduce((sum, row) => sum + (row.costUsd ?? row.reservedUsd), 0);
}

/**
 * The same meter in memory, for unit tests and keyless local dev: {@link decideBudget} over a
 * ledger in an array, with the database's month and spend rules.
 */
export function memoryMeter(state: MemoryMeterState): AiMeter {
  let next = 0;
  return {
    async reserve(input) {
      const group = state.groups.get(input.groupId);
      if (group === undefined) return { ok: false, reason: 'no_group' };
      const decision = decideBudget(
        {
          callsEnabled: state.callsEnabled,
          premium: group.premium,
          linesEnabled: group.linesEnabled,
          groupSpentUsd: memorySpend(state, input.groupId, input.now),
          groupCapUsd: group.capUsd,
          globalSpentUsd: memorySpend(state, null, input.now),
          globalCapUsd: state.globalCapUsd,
        },
        input.worstCaseUsd,
      );
      if (!decision.ok) return decision;
      next += 1;
      const callId = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
      state.ledger.push({
        callId,
        groupId: input.groupId,
        lineId: input.lineId,
        model: input.model,
        reservedUsd: input.worstCaseUsd,
        costUsd: null,
        createdAt: input.now,
        outcome: 'reserved',
      });
      return { ok: true, callId };
    },
    async settle(callId, input) {
      const row = state.ledger.find((entry) => entry.callId === callId);
      if (row === undefined || row.outcome !== 'reserved') return;
      row.outcome = input.outcome;
      row.costUsd = input.costUsd;
    },
  };
}

/* ---------------------------------------------------------------------------------------------
 * The admin's budget line (UI in M16.4)
 * ------------------------------------------------------------------------------------------- */

export interface AiBudgetStatus {
  /** No feature's worst case fits any more: the group's AI is quiet until {@link resumesAt}. */
  paused: boolean;
  /** Which cap paused it, or null. The group's own cap wins when both are reached. */
  reason: 'group_cap' | 'global_cap' | null;
  /** The 1st of next month, 00:00 UTC: when the budget resets. */
  resumesAt: Date;
  groupSpentUsd: number;
  groupCapUsd: number;
  globalSpentUsd: number;
  globalCapUsd: number;
}

/** Pure: whether a month's spend has paused the group. */
export function budgetStatusOf(row: AiMonthSpendRow, now: Date): AiBudgetStatus {
  const groupLeft = row.group_cap_usd - row.group_spent_usd;
  const globalLeft = row.global_cap_usd - row.global_spent_usd;
  const reason =
    groupLeft < PAUSE_MARGIN_USD ? 'group_cap' : globalLeft < PAUSE_MARGIN_USD ? 'global_cap' : null;
  return {
    paused: reason !== null,
    reason,
    resumesAt: utcMonthWindow(now).end,
    groupSpentUsd: row.group_spent_usd,
    groupCapUsd: row.group_cap_usd,
    globalSpentUsd: row.global_spent_usd,
    globalCapUsd: row.global_cap_usd,
  };
}

/** This month's spend and caps for one group (`ai_month_spend`), or null when unreadable. */
export async function readAiBudgetStatus(
  service: ServiceClient,
  groupId: string,
  now: Date,
): Promise<AiBudgetStatus | null> {
  try {
    const month = utcMonthWindow(now);
    const { data, error } = await service.rpc('ai_month_spend', {
      p_group_id: groupId,
      p_month_start: month.start.toISOString(),
      p_month_end: month.end.toISOString(),
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : undefined;
    if (row === undefined) return null;
    const parsed = aiMonthSpendRowSchema.safeParse(row);
    if (!parsed.success) throw new Error(`malformed spend row: ${parsed.error.message}`);
    return budgetStatusOf(parsed.data, now);
  } catch (error) {
    console.error('ai meter: no readable budget', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * When the admin's one budget line should show (brief 1.5: `AI lines are paused until <1 Nov>`):
 * the date the budget resets, or null for "show nothing". Only for a group whose AI is on
 * (Premium and the AI lines switch): a group without Premium never hears of a budget. Members and
 * visitors never call this; the admin page does (M16.4).
 */
export function aiPausedUntil(gate: AiGate | null, status: AiBudgetStatus | null): Date | null {
  if (!aiGateOpen(gate) || status === null || !status.paused) return null;
  return status.resumesAt;
}
