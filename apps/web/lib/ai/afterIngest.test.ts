import { describe, expect, it, vi } from 'vitest';
import { AI_GAME, AI_GAME_ID, AI_GROUP_ID, playerId } from '@/lib/testing/aiFixtures';
import type { RecapEditOutcome } from '../discord/aiEdit';
import type { AiGate } from '../premium';
import { type GameLineHookDeps, runGameLine, type Scheduler, scheduleGameLine } from './afterIngest';
import { type AiReply, createAiClient, fakeReply, mockTransport } from './client';
import type { GameMeta } from './facts';
import { type GameLineSources, type GenerateDeps, generateGameLine } from './generate';
import { memoryMeter, memoryMeterState } from './meter';
import { memoryLineStore } from './store';

/**
 * M16.4: the post-ingest hook. Mock transport only; the real API is never called. The model's
 * answer is the clean M16.3 fixture line, so the checker publishes it.
 */

const NOW = new Date('2026-10-20T20:05:00Z');
const PREMIUM_SINCE = '2026-10-04T12:00:00Z';
const GOOD = '{P2} put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.';
const INPUT = { groupId: AI_GROUP_ID, gameId: AI_GAME_ID };

function harness(options: { meta?: Partial<GameMeta>; optedOut?: string[]; gate?: AiGate | null } = {}) {
  const transport = mockTransport((): AiReply => fakeReply(GOOD, { inputTokens: 1_800, outputTokens: 40 }));
  const gate: AiGate | null =
    options.gate === undefined
      ? { premium: true, linesEnabled: true, premiumChangedAt: PREMIUM_SINCE }
      : options.gate;
  const store = memoryLineStore(() => NOW);
  const deps: GenerateDeps = {
    client: createAiClient({
      transport,
      meter: memoryMeter(memoryMeterState({ [AI_GROUP_ID]: {} })),
      readGate: async () => gate,
      now: () => NOW,
      log: () => {},
    }),
    store,
    readGate: async () => gate,
    readOptedOut: async () => new Set(options.optedOut ?? []),
    now: () => NOW,
    sleep: async () => {},
    log: () => {},
  };
  const sources: GameLineSources = {
    readGameMeta: async () => ({
      id: AI_GAME_ID,
      groupId: AI_GROUP_ID,
      source: 'eog',
      createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
      ...options.meta,
    }),
    loadGameFactsInput: async () => AI_GAME,
  };
  const edits: { line: string; now: Date }[] = [];
  const hook: GameLineHookDeps = {
    generate: (input) => generateGameLine(deps, sources, input),
    discordLine: async () => 'Nadia put up 9 kills and 0 deaths on Lee Sin as Blue won in 31 minutes.',
    editResult: async (input): Promise<RecapEditOutcome> => {
      edits.push({ line: input.line, now: input.now });
      return { status: 'edited' };
    },
    now: () => NOW,
  };
  return { transport, store, hook, edits };
}

describe('runGameLine', () => {
  it('writes one line for a live game and edits the result post with it', async () => {
    const h = harness();
    const run = await runGameLine(INPUT, h.hook);
    expect(run?.generated.status).toBe('published');
    expect(run?.discord).toEqual({ status: 'edited' });
    expect(h.transport.requests).toHaveLength(1);
    expect(h.edits).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
  });

  it('is idempotent per game: a second ingest makes no model call and no second edit', async () => {
    const h = harness();
    await runGameLine(INPUT, h.hook);
    const second = await runGameLine(INPUT, h.hook);
    expect(second?.generated.status).toBe('cached');
    expect(h.transport.requests).toHaveLength(1);
    expect(h.edits).toHaveLength(1);
    expect(h.store.rows).toHaveLength(1);
  });

  it('writes nothing for a backfilled game', async () => {
    const h = harness({ meta: { source: 'backfill' } });
    const run = await runGameLine(INPUT, h.hook);
    expect(run?.generated).toEqual({ status: 'skipped', reason: 'not_live' });
    expect(h.transport.requests).toHaveLength(0);
    expect(h.store.rows).toHaveLength(0);
    expect(h.edits).toHaveLength(0);
  });

  it('writes nothing for a game recorded before Premium was switched on', async () => {
    const h = harness({ meta: { createdAt: '2026-10-04T11:59:00Z' } });
    const run = await runGameLine(INPUT, h.hook);
    expect(run?.generated).toEqual({ status: 'skipped', reason: 'before_premium' });
    expect(h.transport.requests).toHaveLength(0);
    expect(h.edits).toHaveLength(0);
  });

  it('writes nothing for a group without Premium or with AI lines off', async () => {
    for (const gate of [
      { premium: false, linesEnabled: true, premiumChangedAt: null },
      { premium: true, linesEnabled: false, premiumChangedAt: PREMIUM_SINCE },
      null,
    ]) {
      const h = harness({ gate });
      const run = await runGameLine(INPUT, h.hook);
      expect(run?.generated).toEqual({ status: 'skipped', reason: 'gate_closed' });
      expect(h.transport.requests).toHaveLength(0);
    }
  });

  it('leaves an opted-out player out of the stored line entirely (no token, no fact)', async () => {
    const out = playerId(1);
    const h = harness({ optedOut: [out] });
    await runGameLine(INPUT, h.hook);
    const row = h.store.rows[0];
    expect(row).toBeDefined();
    expect(Object.values(row?.token_map ?? {})).not.toContain(out);
    expect(JSON.stringify(row?.facts)).not.toContain(out);
  });

  it('does not edit Discord when the line was not published by this run', async () => {
    const h = harness();
    h.hook.generate = async () => ({ status: 'rejected', lineId: 'x', reason: 'numbers' });
    const run = await runGameLine(INPUT, h.hook);
    expect(run?.discord).toBeNull();
    expect(h.edits).toHaveLength(0);
  });

  it('skips the edit when the line cannot be rendered for Discord (hidden, opted out)', async () => {
    const h = harness();
    h.hook.discordLine = async () => null;
    const run = await runGameLine(INPUT, h.hook);
    expect(run?.generated.status).toBe('published');
    expect(run?.discord).toBeNull();
    expect(h.edits).toHaveLength(0);
  });

  it('never throws, whatever a step does', async () => {
    const h = harness();
    h.hook.discordLine = async () => {
      throw new Error('database down');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runGameLine(INPUT, h.hook)).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});

describe('scheduleGameLine', () => {
  it('returns at once and runs nothing until the scheduler does: the post is never held', async () => {
    const tasks: (() => Promise<unknown>)[] = [];
    const schedule: Scheduler = (task) => tasks.push(task);
    const generate = vi.fn(() => new Promise<never>(() => {})); // a model call that never answers
    const deps = (): GameLineHookDeps => ({
      generate,
      discordLine: async () => null,
      editResult: async () => ({ status: 'edited' }),
      now: () => NOW,
    });

    // What the route does: the result post first, at its usual time, then the schedule.
    const order: string[] = [];
    order.push('result posted');
    scheduleGameLine(INPUT, { schedule, deps });
    order.push('response sent');

    expect(order).toEqual(['result posted', 'response sent']);
    expect(generate).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);

    // After the response: the task starts, and even a model call that never ends holds nothing.
    void tasks[0]?.();
    expect(generate).toHaveBeenCalledWith(INPUT);
  });

  it('swallows a scheduler that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      scheduleGameLine(INPUT, {
        schedule: () => {
          throw new Error('no request scope');
        },
      }),
    ).not.toThrow();
    vi.restoreAllMocks();
  });
});
