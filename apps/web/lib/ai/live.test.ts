import { describe, expect, it } from 'vitest';
import { AI_GAME, AI_GROUP_ID } from '@/lib/testing/aiFixtures';
import { readAiEnv } from '../env';
import { checkLine } from './check';
import { aiTransportFor, createAiClient } from './client';
import { buildGameFacts, buildPrompt, type FactList } from './facts';
import { memoryMeter, memoryMeterState, memorySpend } from './meter';

/**
 * M16.3: one real call, opt-in only. Runs when an AI key is set (`readAiEnv`: `DEEPSEEK_API_KEY`
 * or `ANTHROPIC_API_KEY`, `AI_PROVIDER` to pick) **and** `KUSTOM_AI_LIVE=1`; CI sets neither, so
 * it never runs there. One game line on the provider's game model (DeepSeek V4 Pro about
 * $0.003, Sonnet 5.5 about $0.007), with a $0.01 ceiling the in-memory meter enforces (the call
 * is refused before it is made if its worst case does not fit).
 *
 *   AI_PROVIDER=deepseek DEEPSEEK_API_KEY=... KUSTOM_AI_LIVE=1 pnpm --filter web exec vitest run lib/ai/live.test.ts
 */

const env = readAiEnv(process.env);
const live = env !== null && process.env.KUSTOM_AI_LIVE === '1';
const CEILING_USD = 0.01;

describe.skipIf(!live)(`a real ${env?.provider ?? 'model'} call (KUSTOM_AI_LIVE=1)`, () => {
  it('writes a game line under $0.01 and runs it through the checker', { timeout: 60_000 }, async () => {
    const state = memoryMeterState({ [AI_GROUP_ID]: { capUsd: CEILING_USD } });
    state.globalCapUsd = CEILING_USD;
    const client = createAiClient({
      transport: aiTransportFor(env ?? { provider: 'anthropic', apiKey: '' }),
      meter: memoryMeter(state),
      readGate: async () => ({ premium: true, linesEnabled: true, premiumChangedAt: null }),
    });
    const list = buildGameFacts(AI_GAME, new Set()) as FactList;
    const prompt = buildPrompt(list);
    const result = await client.complete({
      groupId: AI_GROUP_ID,
      lineId: null,
      request: { model: prompt.model, system: prompt.system, user: prompt.user, maxTokens: prompt.maxTokens },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.costUsd).toBeLessThan(CEILING_USD);
    expect(memorySpend(state, null, new Date())).toBeLessThan(CEILING_USD);
    const check = checkLine(result.reply.text, list);
    // The line itself is the model's; print the verdict (never the key) for the person running it.
    console.info(
      `live: ${result.reply.inputTokens} in, ${result.reply.outputTokens} out, $${result.costUsd.toFixed(6)}; checker ${
        check.ok ? 'passed' : `refused (${check.code}: ${check.reason})`
      }: ${result.reply.text}`,
    );
  });
});
