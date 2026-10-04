import { describe, expect, it } from 'vitest';
import { AI_GAME, AI_PLAYER, AI_WEEK } from '@/lib/testing/aiFixtures';
import { buildGameFacts, buildPlayerFacts, buildPrompt, buildWeekFacts, type FactList } from './facts';
import {
  AI_FEATURE_MODELS,
  AI_FEATURES,
  AI_MODELS,
  AI_PROVIDER,
  aiPausedUntil,
  budgetStatusOf,
  costUsd,
  DEFAULT_GLOBAL_MONTHLY_CAP_USD,
  DEFAULT_GROUP_MONTHLY_CAP_USD,
  decideBudget,
  featuresFor,
  inputTokenUpperBound,
  memoryMeter,
  memoryMeterState,
  memorySpend,
  PAUSE_MARGIN_USD,
  utcMonthWindow,
  worstCaseUsd,
} from './meter';

/** M16.3: prices, the worst case, the month, and both caps with a fake clock. */

const HAIKU = 'claude-haiku-4-5-20251001' as const;
const SONNET = 'claude-sonnet-5-5' as const;
const FLASH = 'deepseek-flash' as const;
const PRO = 'deepseek-v4-pro' as const;

describe('the config table', () => {
  it('records the prices read on 2026-10-04', () => {
    expect(AI_MODELS[HAIKU]).toMatchObject({ inputUsdPerMTok: 1, outputUsdPerMTok: 5 });
    expect(AI_MODELS[SONNET]).toMatchObject({ inputUsdPerMTok: 2, outputUsdPerMTok: 10 });
    // DeepSeek at peak (cache miss / hit / out); off-peak is half and never used by the meter.
    expect(AI_MODELS[FLASH]).toMatchObject({
      inputUsdPerMTok: 0.3,
      cachedInputUsdPerMTok: 0.006,
      outputUsdPerMTok: 1.2,
    });
    expect(AI_MODELS[PRO]).toMatchObject({
      inputUsdPerMTok: 1.32,
      cachedInputUsdPerMTok: 0.044,
      outputUsdPerMTok: 3.96,
    });
  });

  it('uses each provider`s models per feature and the user`s caps', () => {
    // Claude: Sonnet 5.5 for all three (M16.8 games, M16.9 scouting).
    expect(featuresFor('anthropic')).toMatchObject({
      game: { model: SONNET },
      week: { model: SONNET },
      player: { model: SONNET },
    });
    // DeepSeek: V4 Pro for all three (the 2026-10-04 eval).
    expect(featuresFor('deepseek')).toMatchObject({
      game: { model: PRO },
      week: { model: PRO },
      player: { model: PRO },
    });
    // The process's table is its provider's, and every model is that provider's own.
    expect(AI_FEATURES).toEqual(featuresFor(AI_PROVIDER));
    for (const provider of ['anthropic', 'deepseek'] as const) {
      for (const model of Object.values(AI_FEATURE_MODELS[provider]))
        expect(AI_MODELS[model].provider).toBe(provider);
    }
    expect(DEFAULT_GROUP_MONTHLY_CAP_USD).toBe(2);
    expect(DEFAULT_GLOBAL_MONTHLY_CAP_USD).toBe(20);
  });

  it('a provider switch never changes a checker shape', () => {
    const anthropic = featuresFor('anthropic');
    const deepseek = featuresFor('deepseek');
    for (const kind of ['game', 'week', 'player'] as const) {
      const { model: _a, ...a } = anthropic[kind];
      const { model: _d, ...d } = deepseek[kind];
      expect(d).toEqual(a);
    }
  });
});

describe('cost', () => {
  it('prices tokens and rounds up to the micro-dollar', () => {
    expect(costUsd(HAIKU, { inputTokens: 2_000, outputTokens: 80 })).toBe(0.0024);
    expect(costUsd(SONNET, { inputTokens: 8_000, outputTokens: 400 })).toBe(0.02);
    expect(costUsd(HAIKU, { inputTokens: 1, outputTokens: 0 })).toBe(0.000001);
    expect(costUsd(HAIKU, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('prices reported cache hits at the cache price, only where the model has one', () => {
    // DeepSeek V4 Pro, a real reply's usage: 864 input tokens, 768 of them a cache hit.
    expect(costUsd(PRO, { inputTokens: 864, cachedInputTokens: 768, outputTokens: 15 })).toBe(0.00022);
    expect(costUsd(PRO, { inputTokens: 864, outputTokens: 15 })).toBe(0.0012);
    // A cached count above the total is clamped; Claude has no cache price, so it changes nothing.
    expect(costUsd(FLASH, { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 })).toBe(0.000001);
    expect(costUsd(SONNET, { inputTokens: 8_000, cachedInputTokens: 8_000, outputTokens: 400 })).toBe(0.02);
  });

  it('the worst case prices every input token at the full peak price', () => {
    expect(worstCaseUsd(PRO, 1_000_000, 0)).toBe(1.32);
    expect(worstCaseUsd(FLASH, 0, 1_000_000)).toBe(1.2);
  });

  it('bounds input tokens by bytes and prices the worst case at max_tokens', () => {
    expect(inputTokenUpperBound('abc', 'é')).toBe(3 + 2 + 64);
    expect(worstCaseUsd(HAIKU, 1_000_000, 0)).toBe(1);
    expect(worstCaseUsd(HAIKU, 0, 1_000_000)).toBe(5);
  });

  it("a real prompt's worst case stays small and above its likely bill", () => {
    const lists: FactList[] = [
      buildGameFacts(AI_GAME, new Set()) as FactList,
      buildWeekFacts(AI_WEEK, new Set()) as FactList,
      buildPlayerFacts(AI_PLAYER, new Set()) as FactList,
    ];
    for (const list of lists) {
      const prompt = buildPrompt(list, 'shape: too long');
      const bound = inputTokenUpperBound(prompt.system, prompt.user);
      const worst = worstCaseUsd(prompt.model, bound, prompt.maxTokens);
      // About four bytes a token in English: the likely bill is a quarter of the bound's input.
      const likely = costUsd(prompt.model, { inputTokens: Math.ceil(bound / 4), outputTokens: 80 });
      expect(worst).toBeGreaterThan(likely);
      expect(worst).toBeLessThan(0.03);
    }
  });

  it('the pause margin covers a game line`s worst case', () => {
    const prompt = buildPrompt(buildGameFacts(AI_GAME, new Set()) as FactList);
    expect(
      worstCaseUsd(prompt.model, inputTokenUpperBound(prompt.system, prompt.user), prompt.maxTokens),
    ).toBeLessThan(PAUSE_MARGIN_USD);
  });
});

describe('utcMonthWindow', () => {
  it('is the UTC calendar month, end exclusive', () => {
    const window = utcMonthWindow(new Date('2026-10-31T23:59:59.999Z'));
    expect(window.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(utcMonthWindow(new Date('2026-12-15T12:00:00Z')).end.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('decideBudget (the same rule as ai_reserve_call)', () => {
  const open = {
    callsEnabled: true,
    premium: true,
    linesEnabled: true,
    groupSpentUsd: 0,
    groupCapUsd: 2,
    globalSpentUsd: 0,
    globalCapUsd: 20,
  };

  it('refuses in order: kill switch, Premium, the group switch, the group cap, the global cap', () => {
    expect(decideBudget({ ...open, callsEnabled: false, premium: false }, 0.01)).toEqual({
      ok: false,
      reason: 'kill_switch',
    });
    expect(decideBudget({ ...open, premium: false, linesEnabled: false }, 0.01)).toEqual({
      ok: false,
      reason: 'not_premium',
    });
    expect(decideBudget({ ...open, linesEnabled: false }, 0.01)).toEqual({ ok: false, reason: 'lines_off' });
    expect(decideBudget({ ...open, groupSpentUsd: 1.995, globalSpentUsd: 19.999 }, 0.01)).toEqual({
      ok: false,
      reason: 'group_cap',
    });
    expect(decideBudget({ ...open, globalSpentUsd: 19.995 }, 0.01)).toEqual({
      ok: false,
      reason: 'global_cap',
    });
    expect(decideBudget(open, 0.01)).toEqual({ ok: true });
  });

  it('lets a call land exactly on a cap, never a cent over', () => {
    expect(decideBudget({ ...open, groupSpentUsd: 1.99 }, 0.01)).toEqual({ ok: true });
    expect(decideBudget({ ...open, groupSpentUsd: 1.99 }, 0.011)).toEqual({ ok: false, reason: 'group_cap' });
  });
});

describe('memoryMeter: both caps stop calls, with a fake clock', () => {
  const october = new Date('2026-10-20T20:00:00Z');

  it('the $2 group cap stops the call whose worst case would cross it, and only that group', async () => {
    const state = memoryMeterState({ a: {}, b: {} });
    const meter = memoryMeter(state);
    const reserve = (groupId: string, worstCaseUsd: number, now = october) =>
      meter.reserve({ groupId, lineId: null, model: HAIKU, worstCaseUsd, now });

    // Spend $1.95 in settled calls.
    for (let i = 0; i < 39; i += 1) {
      const r = await reserve('a', 0.05);
      expect(r.ok).toBe(true);
      if (r.ok)
        await meter.settle(r.callId, {
          outcome: 'ok',
          costUsd: 0.05,
          inputTokens: 1,
          outputTokens: 1,
          requestId: null,
        });
    }
    expect(memorySpend(state, 'a', october)).toBeCloseTo(1.95, 6);
    expect(await reserve('a', 0.06)).toEqual({ ok: false, reason: 'group_cap' });
    expect((await reserve('a', 0.05)).ok).toBe(true); // lands on $2.00 exactly
    expect(await reserve('a', 0.000001)).toEqual({ ok: false, reason: 'group_cap' });
    expect((await reserve('b', 0.05)).ok).toBe(true);
  });

  it('an unsettled reservation counts at its worst case; a settled one at its real cost', async () => {
    const state = memoryMeterState({ a: {} });
    const meter = memoryMeter(state);
    const r = await meter.reserve({
      groupId: 'a',
      lineId: null,
      model: HAIKU,
      worstCaseUsd: 1.5,
      now: october,
    });
    expect(
      await meter.reserve({ groupId: 'a', lineId: null, model: HAIKU, worstCaseUsd: 0.6, now: october }),
    ).toEqual({
      ok: false,
      reason: 'group_cap',
    });
    if (r.ok)
      await meter.settle(r.callId, {
        outcome: 'ok',
        costUsd: 0.002,
        inputTokens: 1,
        outputTokens: 1,
        requestId: null,
      });
    expect(
      (await meter.reserve({ groupId: 'a', lineId: null, model: HAIKU, worstCaseUsd: 0.6, now: october })).ok,
    ).toBe(true);
  });

  it('the $20 global cap stops every group at once', async () => {
    const groups = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`g${i}`, {}]));
    const state = memoryMeterState(groups);
    const meter = memoryMeter(state);
    // Ten groups each spend $1.99: $19.90 overall, every group under its own cap.
    for (let i = 0; i < 10; i += 1) {
      expect(
        (
          await meter.reserve({
            groupId: `g${i}`,
            lineId: null,
            model: HAIKU,
            worstCaseUsd: 1.99,
            now: october,
          })
        ).ok,
      ).toBe(true);
    }
    expect(
      await meter.reserve({ groupId: 'g10', lineId: null, model: HAIKU, worstCaseUsd: 0.11, now: october }),
    ).toEqual({
      ok: false,
      reason: 'global_cap',
    });
    expect(
      (await meter.reserve({ groupId: 'g11', lineId: null, model: HAIKU, worstCaseUsd: 0.1, now: october }))
        .ok,
    ).toBe(true);
    expect(
      await meter.reserve({
        groupId: 'g10',
        lineId: null,
        model: HAIKU,
        worstCaseUsd: 0.000001,
        now: october,
      }),
    ).toEqual({
      ok: false,
      reason: 'global_cap',
    });
  });

  it('goes quiet until the 1st, then the month starts over', async () => {
    const state = memoryMeterState({ a: {} });
    const meter = memoryMeter(state);
    await meter.reserve({ groupId: 'a', lineId: null, model: HAIKU, worstCaseUsd: 2, now: october });
    const lastSecond = new Date('2026-10-31T23:59:59Z');
    expect(
      await meter.reserve({ groupId: 'a', lineId: null, model: HAIKU, worstCaseUsd: 0.01, now: lastSecond }),
    ).toEqual({
      ok: false,
      reason: 'group_cap',
    });
    const first = new Date('2026-11-01T00:00:00Z');
    expect(
      (await meter.reserve({ groupId: 'a', lineId: null, model: HAIKU, worstCaseUsd: 0.01, now: first })).ok,
    ).toBe(true);
  });

  it('the kill switch, Premium off and AI lines off each stop every call', async () => {
    const state = memoryMeterState({ a: {}, off: { premium: false }, quiet: { linesEnabled: false } });
    const meter = memoryMeter(state);
    const reserve = (groupId: string) =>
      meter.reserve({ groupId, lineId: null, model: HAIKU, worstCaseUsd: 0.01, now: october });
    expect(await reserve('off')).toEqual({ ok: false, reason: 'not_premium' });
    expect(await reserve('quiet')).toEqual({ ok: false, reason: 'lines_off' });
    expect(await reserve('nobody')).toEqual({ ok: false, reason: 'no_group' });
    state.callsEnabled = false;
    expect(await reserve('a')).toEqual({ ok: false, reason: 'kill_switch' });
  });
});

describe('the admin budget line', () => {
  const now = new Date('2026-10-20T20:00:00Z');
  const row = {
    group_spent_usd: 0.4,
    global_spent_usd: 3,
    group_cap_usd: 2,
    global_cap_usd: 20,
    calls_enabled: true,
    premium: true,
    lines_enabled: true,
  };
  const gate = { premium: true, linesEnabled: true, premiumChangedAt: '2026-10-01T00:00:00Z' };

  it('is paused when no feature fits, and says until the 1st', () => {
    expect(budgetStatusOf(row, now)).toMatchObject({ paused: false, reason: null });
    const capped = budgetStatusOf({ ...row, group_spent_usd: 1.99 }, now);
    expect(capped).toMatchObject({ paused: true, reason: 'group_cap' });
    expect(capped.resumesAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(budgetStatusOf({ ...row, global_spent_usd: 19.99 }, now)).toMatchObject({
      paused: true,
      reason: 'global_cap',
    });
  });

  it('shows only for a group whose AI is on', () => {
    const capped = budgetStatusOf({ ...row, group_spent_usd: 2 }, now);
    expect(aiPausedUntil(gate, capped)?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(aiPausedUntil({ ...gate, premium: false }, capped)).toBeNull();
    expect(aiPausedUntil({ ...gate, linesEnabled: false }, capped)).toBeNull();
    expect(aiPausedUntil(gate, budgetStatusOf(row, now))).toBeNull();
    expect(aiPausedUntil(gate, null)).toBeNull();
  });
});
