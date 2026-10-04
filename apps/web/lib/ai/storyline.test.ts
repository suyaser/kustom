import { describe, expect, it, vi } from 'vitest';
import { AI_GROUP_ID } from '@/lib/testing/aiFixtures';
import type { BoardRow } from '../board/types';
import type { WeekPostSource } from '../discord/post';
import { closedWindow } from '../night';
import type { AiGate } from '../premium';
import type { StatsView } from '../stats/types';
import { type AiReply, createAiClient, fakeReply, mockTransport } from './client';
import { buildWeekFacts } from './facts';
import { type GenerateDeps, generateWeekLine, MAX_ATTEMPTS } from './generate';
import { memoryMeter, memoryMeterState } from './meter';
import { memoryLineStore } from './store';
import { runStoryline, type StorylineHookDeps, weekFactsFromPost, weekStartDay } from './storyline';

/**
 * M16.5: the weekly storyline's pure half (facts from the Sunday post's own numbers) and the Sunday
 * post's hook (gate first, one call per group-week, at most two attempts, a budget that never
 * holds the post). The database half is `storyline.integration.test.ts`.
 */

const TZ = 'Africa/Cairo';
/** Monday morning after the week of Sunday 27 Sep 2026 closed. */
const NOW = new Date('2026-10-05T07:00:00Z');
const WINDOW = closedWindow('last-week', NOW, TZ);
const GATE: AiGate = { premium: true, linesEnabled: true, premiumChangedAt: '2026-10-01T00:00:00Z' };

function row(index: number, points: number, games: number, wins: number): BoardRow {
  return {
    puuid: `puuid-${index}`,
    name: `Friend${index}`,
    track: 'week',
    points,
    sortKey: 30 - index,
    rating: 1500 - index * 10,
    games,
    wins,
    losses: games - wins,
    ratedGames: 40,
    climb: null,
    settling: false,
    settlingChip: false,
    awards: [],
  };
}

const ROWS = [
  row(1, 212, 12, 9),
  row(2, 80, 11, 7),
  row(3, 12, 10, 6),
  row(4, -40, 9, 3),
  row(5, -140, 8, 1),
];
const ID_OF = new Map(
  ROWS.map((entry, index) => [entry.puuid, `00000000-0000-4000-8000-00000000010${index}`]),
);
const idOf = (index: number) => ID_OF.get(`puuid-${index}`) as string;

const STATS = {
  longestWin: { length: 5, holders: [{ puuid: 'puuid-1', name: 'Friend1' }] },
  awards: {
    kind: 'closed',
    intro: 'Two awards for the week.',
    blocks: [
      {
        label: 'Best off-role',
        rule: 'rule',
        won: true,
        note: null,
        lines: [{ key: 'puuid-2', text: 'Friend2 · 5W 1L' }],
      },
      {
        label: 'Cursed duo',
        rule: 'rule',
        won: true,
        note: null,
        lines: [{ key: 'puuid-4|puuid-5', text: 'Friend4 and Friend5 · 1W 6L' }],
      },
    ],
  },
} as unknown as StatsView;

const SOURCE: WeekPostSource = {
  groupId: AI_GROUP_ID,
  window: WINDOW,
  timeZone: TZ,
  rows: ROWS,
  games: 23,
  stats: STATS,
};

const GOOD =
  "{P1} finished first on the week's board with 9 wins from 12 games. {P2} took 2nd place with 7 wins.";

describe('the week of a Sunday post', () => {
  it("is keyed by the closed week's Sunday on the group clock", () => {
    expect(weekStartDay(WINDOW, TZ)).toBe('2026-09-27');
  });
});

describe('weekFactsFromPost: the post’s own numbers, nothing else', () => {
  const week = weekFactsFromPost({
    weekStart: '2026-09-27',
    games: 23,
    rows: ROWS,
    stats: STATS,
    idOf: ID_OF,
  });

  it('keeps the board in the post’s order with games and wins, and only positive net points', () => {
    expect(week?.board.map((entry) => entry.playerId)).toEqual([1, 2, 3, 4, 5].map(idOf));
    expect(week?.board[0]).toEqual({ playerId: idOf(1), games: 12, wins: 9 });
    expect(week?.climbs).toEqual([
      { playerId: idOf(1), climb: 212 },
      { playerId: idOf(2), climb: 80 },
      { playerId: idOf(3), climb: 12 },
    ]);
    expect(week?.ratedGames).toBe(23);
  });

  it('takes the longest win streak and Best off-role, never Cursed duo (it only teases up)', () => {
    expect(week?.streaks).toEqual([{ playerId: idOf(1), wins: 5 }]);
    expect(week?.awards).toEqual([{ label: 'Best off-role', playerId: idOf(2), value: null, unit: null }]);
    const list = week === null ? null : buildWeekFacts(week, new Set());
    const text = JSON.stringify(list?.facts);
    expect(text).not.toMatch(/cursed/i);
    // A negative week is a low stat: it never becomes a fact.
    expect(text).not.toContain('140');
    expect(text).not.toContain('-40');
    // No Rating: the week post prints none since M14.57.
    expect(text).not.toContain('1490');
  });

  it('is null when no row has a player id, and leaves a row with none out', () => {
    expect(
      weekFactsFromPost({ weekStart: '2026-09-27', games: 1, rows: ROWS, stats: null, idOf: new Map() }),
    ).toBeNull();
    const partial = weekFactsFromPost({
      weekStart: '2026-09-27',
      games: 23,
      rows: ROWS,
      stats: null,
      idOf: new Map([['puuid-2', idOf(2)]]),
    });
    expect(partial?.board).toEqual([{ playerId: idOf(2), games: 11, wins: 7 }]);
    expect(partial?.streaks).toEqual([]);
    expect(partial?.awards).toEqual([]);
  });
});

/** The real generation flow over an in-memory store and meter, with a mocked model. */
function harness(
  options: { answers?: string[]; gate?: AiGate | null; budgetMs?: number; hang?: boolean } = {},
) {
  const answers = options.answers ?? [GOOD];
  const transport = mockTransport((_request, call): AiReply => {
    const answer = answers[Math.min(call, answers.length) - 1] as string;
    return fakeReply(answer, { inputTokens: 2_500, outputTokens: 120 });
  });
  const gate = options.gate === undefined ? GATE : options.gate;
  const store = memoryLineStore(() => NOW);
  const generateDeps: GenerateDeps = {
    client: createAiClient({
      transport,
      meter: memoryMeter(memoryMeterState({ [AI_GROUP_ID]: {} })),
      readGate: async () => gate,
      now: () => NOW,
      log: () => {},
    }),
    store,
    readGate: async () => gate,
    readOptedOut: async () => new Set(),
    now: () => NOW,
    sleep: async () => {},
    log: () => {},
  };
  const calls = { gate: 0, ids: 0, discord: 0, scheduled: 0 };
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const deps: StorylineHookDeps = {
    readGate: async () => {
      calls.gate += 1;
      return gate;
    },
    readPlayerIds: async () => {
      calls.ids += 1;
      return ID_OF;
    },
    generate: async (input) => {
      if (options.hang) await held;
      return generateWeekLine(generateDeps, input);
    },
    discordLine: async ({ weekStart }) => {
      calls.discord += 1;
      const stored = await store.read(AI_GROUP_ID, 'week', weekStart);
      return stored?.status === 'published' ? stored.text : null;
    },
    schedule: () => {
      calls.scheduled += 1;
    },
    budgetMs: options.budgetMs ?? 30_000,
    sleep: options.hang ? async () => {} : () => new Promise<void>(() => {}),
  };
  return { deps, transport, store, calls, release };
}

describe('runStoryline: the Sunday post’s hook', () => {
  it('a group whose AI gate is closed costs one gate read and returns no storyline', async () => {
    for (const gate of [null, { ...GATE, premium: false }, { ...GATE, linesEnabled: false }]) {
      const h = harness({ gate });
      expect(await runStoryline(SOURCE, h.deps)).toBeNull();
      expect(h.calls).toEqual({ gate: 1, ids: 0, discord: 0, scheduled: 0 });
      expect(h.transport.requests).toHaveLength(0);
      expect(h.store.rows).toHaveLength(0);
    }
  });

  it('one Sonnet call per group-week, stored; a second Sunday call makes none', async () => {
    const h = harness();
    expect(await runStoryline(SOURCE, h.deps)).toBe(GOOD);
    expect(await runStoryline(SOURCE, h.deps)).toBe(GOOD);
    expect(h.transport.requests).toHaveLength(1);
    expect(h.transport.requests[0]?.model).toBe('claude-sonnet-5-5');
    // Shown all week under Last week: the prompt says the week, never this week.
    expect(h.transport.requests[0]?.system).toContain('never this week');
    expect(JSON.stringify(h.transport.requests[0])).not.toMatch(/games this week|points this week/);
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0]).toMatchObject({ kind: 'week', subject: '2026-09-27', status: 'published' });
    // The request carries tokens, never a name or a puuid.
    const body = JSON.stringify(h.transport.requests[0]);
    expect(body).not.toMatch(/Friend\d|puuid-/);
  });

  it('at most two attempts: two refused lines store `rejected`, the post has none, and it is never retried', async () => {
    const h = harness({ answers: ['{P1} won 99 games.', '{P1} won 98 games.'] });
    expect(await runStoryline(SOURCE, h.deps)).toBeNull();
    expect(h.transport.requests).toHaveLength(MAX_ATTEMPTS);
    expect(h.store.rows[0]).toMatchObject({ status: 'rejected', attempts: 2 });
    expect(await runStoryline(SOURCE, h.deps)).toBeNull();
    expect(h.transport.requests).toHaveLength(MAX_ATTEMPTS);
  });

  it('a generation past the budget never holds the post: no storyline now, finished in after()', async () => {
    const h = harness({ hang: true, budgetMs: 1 });
    expect(await runStoryline(SOURCE, h.deps)).toBeNull();
    expect(h.calls.scheduled).toBe(1);
    expect(h.calls.discord).toBe(0);
    h.release();
  });

  it('never throws: a failing read is no storyline', async () => {
    const h = harness();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.deps.readPlayerIds = async () => {
      throw new Error('PostgREST is having a day');
    };
    expect(await runStoryline(SOURCE, h.deps)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
