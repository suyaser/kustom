import { SETTLING_GAMES } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { closedWindow } from '../night';
import type { AiGate } from '../premium';
import type { ServiceClient } from '../supabase';
import { checkLine } from './check';
import { buildPlayerFacts, type FactList, renderFact } from './facts';
import type { GenerateOutcome } from './generate';
import {
  createLimiter,
  type PoolRow,
  READ_MAX_PAGES,
  readAllPages,
  runScouting,
  SCOUTING_START_MARGIN_MS,
  type ScoutingDeps,
  scoutingCandidates,
  scoutingExtrasOf,
  scoutingInputOf,
} from './scouting';
import { loadPlayerScouting } from './scoutingRead';

/** M16.6: who gets a scouting report, what it is built from, and that a page view never writes. */

const GROUP = '20000000-0000-4000-8000-0000000000aa';
const OPEN: AiGate = { premium: true, linesEnabled: true, premiumChangedAt: '2026-10-01T00:00:00Z' };
const WINDOW = closedWindow('last-week', new Date('2026-10-05T12:00:00Z'), 'Africa/Cairo');
const WEEK = '2026-09-27';

const pool = (champion: number, role: PoolRow['role'], games: number, wins: number): PoolRow[] =>
  Array.from({ length: games }, (_, index) => ({ championId: champion, role, won: index < wins }));

describe('scoutingInputOf', () => {
  it('counts champions and roles off the rated pool, named as the site names them', () => {
    const input = scoutingInputOf({
      playerId: 'p',
      weekStart: WEEK,
      rating: { games: 20, wins: 12 },
      week: { games: 3, wins: 2 },
      pool: [
        ...pool(64, 'jungle', 8, 5),
        ...pool(103, 'mid', 4, 1),
        { championId: null, role: null, won: true },
      ],
    });
    expect(input).toMatchObject({ ratedGames: 20, wins: 12, weekGames: 3, weekWins: 2 });
    expect(input.champions).toEqual([
      { name: 'Lee Sin', games: 8, wins: 5 },
      { name: 'Ahri', games: 4, wins: 1 },
    ]);
    expect(input.roles).toEqual([
      { role: 'jungle', games: 8, wins: 5 },
      { role: 'mid', games: 4, wins: 1 },
    ]);
  });

  it('feeds a fact list with champion and role figures only from 5+ games', () => {
    const list = buildPlayerFacts(
      scoutingInputOf({
        playerId: 'p',
        weekStart: WEEK,
        rating: { games: 20, wins: 12 },
        week: { games: 3, wins: 2 },
        pool: [...pool(64, 'jungle', 8, 5), ...pool(103, 'mid', 4, 1)],
      }),
      new Set(),
    ) as FactList;
    const text = list.facts.map(renderFact).join('\n');
    expect(text).toContain('8 games on Lee Sin');
    expect(text).toContain('8 games in jungle');
    expect(text).not.toContain('Ahri');
    expect(text).not.toContain('mid lane');
  });
});

describe('scoutingCandidates', () => {
  const ratings = new Map([
    ['settled', { games: SETTLING_GAMES, wins: 5 }],
    ['settling', { games: SETTLING_GAMES - 1, wins: 5 }],
    ['out', { games: 30, wins: 15 }],
    ['absent', { games: 30, wins: 15 }],
    ['busy', { games: 40, wins: 20 }],
  ]);
  const week = new Map([
    ['settled', { games: 2, wins: 1 }],
    ['settling', { games: 4, wins: 3 }],
    ['out', { games: 5, wins: 3 }],
    ['busy', { games: 6, wins: 3 }],
    ['stranger', { games: 6, wins: 3 }],
  ]);

  it('settled players who played the week and did not opt out, busiest first', () => {
    expect(scoutingCandidates({ ratings, week, optedOut: new Set(['out']) })).toEqual(['busy', 'settled']);
  });
});

function fakeDeps(overrides: Partial<ScoutingDeps> = {}) {
  const calls: string[] = [];
  const generated: string[] = [];
  let clock = 0;
  const deps: ScoutingDeps = {
    readGate: async () => {
      calls.push('gate');
      return OPEN;
    },
    readOptedOut: async () => new Set(),
    readRatings: async () =>
      new Map([
        ['a', { games: 30, wins: 15 }],
        ['b', { games: 20, wins: 10 }],
        ['c', { games: 12, wins: 6 }],
      ]),
    readWeek: async () =>
      new Map([
        ['a', { games: 5, wins: 3 }],
        ['b', { games: 4, wins: 2 }],
        ['c', { games: 3, wins: 1 }],
      ]),
    readPool: async (_group, playerId) => {
      calls.push(`pool:${playerId}`);
      return pool(64, 'jungle', 10, 6);
    },
    hasLine: async () => false,
    generate: async ({ player }): Promise<GenerateOutcome> => {
      generated.push(player.playerId);
      return { status: 'published', lineId: `line-${player.playerId}`, text: 'x' };
    },
    now: () => clock,
    ...overrides,
  };
  return { deps, calls, generated, setClock: (ms: number) => (clock = ms) };
}

describe('M16.6 code review: limits, paging, opt-outs', () => {
  it('one limiter caps concurrent players across every group of the run', async () => {
    const limiter = createLimiter(4);
    let active = 0;
    let peak = 0;
    const make = () =>
      fakeDeps({
        limiter,
        readRatings: async () =>
          new Map(Array.from({ length: 6 }, (_, i) => [`p${i}`, { games: 20, wins: 10 }])),
        readWeek: async () => new Map(Array.from({ length: 6 }, (_, i) => [`p${i}`, { games: 2, wins: 1 }])),
        generate: async ({ player }): Promise<GenerateOutcome> => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { status: 'published', lineId: player.playerId, text: 'x' };
        },
      }).deps;
    const runs = await Promise.all(
      ['g1', 'g2', 'g3'].map((groupId) =>
        runScouting(make(), { groupId, window: WINDOW, weekStart: WEEK, deadline: 1e12 }),
      ),
    );
    expect(runs.map((run) => run?.outcomes.published)).toEqual([6, 6, 6]);
    expect(peak).toBe(4);
  });

  it('passes the deadline down to generation, and the opt-outs to both group reads', async () => {
    const seen: { deadline?: number; ratings?: string[]; week?: string[] } = {};
    const h = fakeDeps({
      readOptedOut: async () => new Set(['c']),
      readRatings: async (_g, optedOut) => {
        seen.ratings = [...optedOut];
        return new Map([['a', { games: 30, wins: 15 }]]);
      },
      readWeek: async (_g, _w, optedOut) => {
        seen.week = [...optedOut];
        return new Map([['a', { games: 3, wins: 2 }]]);
      },
      generate: async ({ deadline }): Promise<GenerateOutcome> => {
        seen.deadline = deadline;
        return { status: 'published', lineId: 'l', text: 'x' };
      },
    });
    await runScouting(h.deps, { groupId: GROUP, window: WINDOW, weekStart: WEEK, deadline: 123_456_789 });
    expect(seen).toEqual({ deadline: 123_456_789, ratings: ['c'], week: ['c'] });
  });

  it('pages a group read to the end, and throws past the ceiling instead of reading part of it', async () => {
    const pages: number[] = [];
    const rows = await readAllPages('t', async (from) => {
      pages.push(from);
      return { data: from === 0 ? Array(1000).fill(1) : [1, 2], error: null };
    });
    expect(rows).toHaveLength(1002);
    expect(pages).toEqual([0, 1000]);
    await expect(
      readAllPages('the week', async () => ({ data: Array(1000).fill(1), error: null })),
    ).rejects.toThrow(`more than ${READ_MAX_PAGES * 1000} rows`);
    await expect(readAllPages('t', async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow(
      'boom',
    );
  });

  it('a group read that throws (the cap) is no run at all: fails closed', async () => {
    const h = fakeDeps({
      readWeek: async () => {
        throw new Error('ai scouting: the week has more than 20000 rows');
      },
    });
    expect(
      await runScouting(h.deps, { groupId: GROUP, window: WINDOW, weekStart: WEEK, deadline: 1e12 }),
    ).toBeNull();
    expect(h.generated).toEqual([]);
  });
});

describe('runScouting', () => {
  it('a closed gate costs one read: no other read, no call', async () => {
    const h = fakeDeps({ readGate: async () => ({ ...OPEN, premium: false }) });
    expect(
      await runScouting(h.deps, { groupId: GROUP, window: WINDOW, weekStart: WEEK, deadline: 1e12 }),
    ).toBeNull();
    expect(h.calls).toEqual([]);
    expect(h.generated).toEqual([]);
  });

  it('writes every candidate, and skips the pool read for one already stored', async () => {
    const h = fakeDeps({ hasLine: async (_g, playerId) => playerId === 'b' });
    const run = await runScouting(h.deps, {
      groupId: GROUP,
      window: WINDOW,
      weekStart: WEEK,
      deadline: 1e12,
    });
    expect(run).toMatchObject({
      candidates: 3,
      attempted: 3,
      deferred: 0,
      outcomes: { published: 2, cached: 1 },
    });
    expect(h.generated.sort()).toEqual(['a', 'c']);
    expect(h.calls).not.toContain('pool:b');
  });

  it('starts nobody inside the margin before the deadline; the next call picks them up', async () => {
    const h = fakeDeps();
    h.setClock(10_000);
    const run = await runScouting(h.deps, {
      groupId: GROUP,
      window: WINDOW,
      weekStart: WEEK,
      deadline: 10_000 + SCOUTING_START_MARGIN_MS - 1,
    });
    expect(run).toMatchObject({ attempted: 0, deferred: 3 });
    expect(h.generated).toEqual([]);
  });

  it('an unreadable pool is no report, never a guess', async () => {
    const h = fakeDeps({ readPool: async () => null });
    const run = await runScouting(h.deps, {
      groupId: GROUP,
      window: WINDOW,
      weekStart: WEEK,
      deadline: 1e12,
    });
    expect(run?.outcomes).toEqual({ no_pool: 3 });
    expect(h.generated).toEqual([]);
  });

  it('a throwing read is a logged null, never a throw', async () => {
    const h = fakeDeps({
      readRatings: async () => {
        throw new Error('db down');
      },
    });
    expect(
      await runScouting(h.deps, { groupId: GROUP, window: WINDOW, weekStart: WEEK, deadline: 1e12 }),
    ).toBeNull();
  });
});

describe('the page read never writes or calls the model', () => {
  /** A fake service that records every table and verb; answers reads with `data`. */
  function recordingService(answers: Record<string, unknown>) {
    const touched: string[] = [];
    const chain = (table: string) => {
      // A real promise (awaiting the chain reads `answers[table]`) with the builder's verbs on it.
      const query = Object.assign(
        Promise.resolve({ data: answers[table] ?? [], error: null }),
        {},
      ) as Promise<unknown> & Record<string, unknown>;
      for (const verb of ['select', 'eq', 'in', 'order', 'limit', 'is']) {
        query[verb] = () => query;
      }
      for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
        query[verb] = () => {
          touched.push(`${verb}:${table}`);
          return query;
        };
      }
      query.maybeSingle = () => Promise.resolve({ data: answers[`${table}:single`] ?? null, error: null });
      return query;
    };
    return {
      service: {
        from: (table: string) => {
          touched.push(`from:${table}`);
          return chain(table);
        },
        rpc: () => {
          touched.push('rpc');
          return Promise.resolve({ data: null, error: null });
        },
      } as unknown as ServiceClient,
      touched,
    };
  }

  it('reads players, ai_lines and opt-outs only, and renders the stored line', async () => {
    const { service, touched } = recordingService({
      'players:single': { id: 'p1', display_name: 'Raafat', game_name: null },
      ai_lines: [
        {
          id: 'l1',
          status: 'published',
          text: '{P1} means Lee Sin: 31 games on it at 68 percent. Over the week {P1} went 6 wins in 9 games.',
          token_map: { P1: 'p1' },
          published_at: '2026-10-04T04:40:00Z',
          week_start: WEEK,
        },
      ],
      group_memberships: [],
    });
    const shown = await loadPlayerScouting(service, {
      groupId: GROUP,
      puuid: 'puuid',
      timeZone: 'Africa/Cairo',
      gate: OPEN,
    });
    expect(shown).toEqual({
      lineId: 'l1',
      text: 'Raafat means Lee Sin: 31 games on it at 68 percent. Over the week Raafat went 6 wins in 9 games.',
      written: 'Written Sunday 4 Oct',
    });
    expect(touched.every((entry) => entry.startsWith('from:'))).toBe(true);
    expect(new Set(touched)).toEqual(new Set(['from:players', 'from:ai_lines', 'from:group_memberships']));
  });

  it('M16.19: a report naming the duo partner renders their name too', async () => {
    const { service } = recordingService({
      'players:single': { id: 'p1', display_name: 'Raafat', game_name: null },
      players: [{ id: 'p2', display_name: 'Sami', game_name: null }],
      ai_lines: [
        {
          id: 'l3',
          status: 'published',
          text: '{P1} and {P2} win together: 7 wins in 9 games on the same team. Over the week {P1} went 1 win in 3 games.',
          token_map: { P1: 'p1', P2: 'p2' },
          published_at: '2026-10-04T04:40:00Z',
          week_start: WEEK,
        },
      ],
      group_memberships: [],
    });
    const shown = await loadPlayerScouting(service, {
      groupId: GROUP,
      puuid: 'puuid',
      timeZone: 'Africa/Cairo',
      gate: OPEN,
    });
    expect(shown?.text).toBe(
      'Raafat and Sami win together: 7 wins in 9 games on the same team. Over the week Raafat went 1 win in 3 games.',
    );
  });

  it('a hidden newest report shows nothing (no fallback to an older week)', async () => {
    const { service } = recordingService({
      'players:single': { id: 'p1', display_name: 'Raafat', game_name: null },
      ai_lines: [
        { id: 'l2', status: 'hidden', text: 'x', token_map: {}, published_at: null, week_start: WEEK },
      ],
    });
    expect(
      await loadPlayerScouting(service, {
        groupId: GROUP,
        puuid: 'puuid',
        timeZone: 'Africa/Cairo',
        gate: OPEN,
      }),
    ).toBeNull();
  });

  // The page loading no generator or model client at all: `readOnly.test.ts` walks its import graph.
});

describe('describes, never prescribes (checker, player kind)', () => {
  const list = buildPlayerFacts(
    scoutingInputOf({
      playerId: 'p',
      weekStart: WEEK,
      rating: { games: 20, wins: 12 },
      week: { games: 3, wins: 2 },
      pool: pool(64, 'jungle', 8, 5),
    }),
    new Set(),
  ) as FactList;

  it.each([
    ['because', '{P1} plays Lee Sin in 8 games. {P1} wins because of the jungle.'],
    ['thanks to', '{P1} plays Lee Sin in 8 games. {P1} won thanks to the jungle.'],
    ['should', '{P1} plays Lee Sin in 8 games. {P1} should play more Lee Sin.'],
    ['needs to', '{P1} plays Lee Sin in 8 games. {P1} needs to branch out.'],
    ['led to', '{P1} plays Lee Sin in 8 games. That focus led to 5 wins.'],
  ])('rejects %s', (_label, line) => {
    expect(checkLine(line, list).ok).toBe(false);
  });

  it('a plain description passes', () => {
    expect(
      checkLine('{P1} means Lee Sin: 8 games on it. Over the week {P1} went 2 wins in 3 games.', list),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe('design round 1: the report never says this week (it stays up for weeks)', () => {
  const list = buildPlayerFacts(
    scoutingInputOf({
      playerId: 'p',
      weekStart: WEEK,
      rating: { games: 20, wins: 12 },
      week: { games: 6, wins: 4 },
      pool: pool(64, 'jungle', 8, 5),
    }),
    new Set(),
  ) as FactList;

  it('labels the week facts as the week before the report', () => {
    const text = list.facts.map(renderFact).join('\n');
    expect(text).toContain('6 games in the week before this report');
    expect(text).toContain('4 wins in the week before this report');
    expect(text).not.toMatch(/this week/);
  });

  it.each([
    ['this week', 'This week {P1} went 4 wins in 6 games. {P1} means Lee Sin.'],
    ['last week', 'Last week {P1} went 4 wins in 6 games. {P1} means Lee Sin.'],
    ['lately', '{P1} went 4 wins in 6 games lately. {P1} means Lee Sin.'],
    ['recently', '{P1} recently went 4 wins in 6 games. {P1} means Lee Sin.'],
    ['right now', '{P1} is on Lee Sin right now, 8 games on it. {P1} went 4 wins in 6 games.'],
    ['these days', '{P1} plays Lee Sin these days, 8 games on it. {P1} went 4 wins in 6 games.'],
    ['currently', '{P1} currently plays Lee Sin, 8 games on it. {P1} went 4 wins in 6 games.'],
  ])('rejects %s for a player', (phrase, line) => {
    expect(checkLine(line, list)).toMatchObject({
      ok: false,
      code: 'forbidden',
      reason: expect.stringContaining(phrase),
    });
  });

  it('the past-tense week passes', () => {
    expect(
      checkLine(
        'Over the week {P1} went 4 wins in 6 games, so the form was solid. {P1} means Lee Sin.',
        list,
      ),
    ).toMatchObject({ ok: true });
  });

  it("M16.13: a scouting report's percent is the player's, token or not; a wrong one still fails", () => {
    // Lee Sin: 5 wins in 8 games, 63 percent.
    expect(checkLine('{P1} means Lee Sin, 8 games on it. The pick sits at 63 percent.', list)).toMatchObject({
      ok: true,
    });
    expect(checkLine('{P1} means Lee Sin, 8 games on it. The pick sits at 64 percent.', list)).toMatchObject({
      ok: false,
      code: 'number',
    });
  });
});

describe('M16.19 the scouting report leads with what the page does not show', () => {
  const W = closedWindow('last-week', new Date('2026-10-12T12:00:00Z'), 'Africa/Cairo');
  const at = (days: number) => new Date(W.start.getTime() + days * 86_400_000).toISOString();
  const game = (days: number, patch: Partial<PoolRow> & { teammates?: string[] } = {}): PoolRow => ({
    championId: null,
    champion: 'Lee Sin',
    role: 'jungle',
    won: true,
    startedAt: at(days),
    kills: 5,
    assists: 5,
    teammates: ['a', 'b', 'c', 'd'],
    ...patch,
  });

  it('the duo: most wins together over 5+ games; a tie or an opted-out partner is nobody', () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) =>
        game(-10 - i, { teammates: ['ana', `u${i}`, `v${i}`, `w${i}`] }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        game(-20 - i, { teammates: ['bo', `s${i}`, `t${i}`, `y${i}`], won: i < 3 }),
      ),
    ];
    expect(scoutingExtrasOf({ pool, window: W, optedOut: new Set() }).duo).toEqual({
      partnerId: 'ana',
      games: 6,
      wins: 6,
    });
    expect(scoutingExtrasOf({ pool, window: W, optedOut: new Set(['ana']) }).duo).toEqual({
      partnerId: 'bo',
      games: 5,
      wins: 3,
    });
    const tied = [
      ...Array.from({ length: 5 }, (_, i) => game(-10 - i, { teammates: ['ana'] })),
      ...Array.from({ length: 5 }, (_, i) => game(-20 - i, { teammates: ['bo'] })),
    ];
    expect(scoutingExtrasOf({ pool: tied, window: W, optedOut: new Set() }).duo).toBeUndefined();
    const short = Array.from({ length: 4 }, (_, i) => game(-10 - i, { teammates: ['ana'] }));
    expect(scoutingExtrasOf({ pool: short, window: W, optedOut: new Set() }).duo).toBeUndefined();
  });

  it("the week's best game, a champion new to the pool, and a role shift", () => {
    const before = Array.from({ length: 6 }, (_, i) => game(-3 - i));
    const week = [
      game(1, { champion: 'Ornn', role: 'top', kills: 3, assists: 9 }),
      game(2, { champion: 'Ornn', role: 'top', kills: 11, assists: 7, won: false }),
      game(3, { champion: 'Darius', role: 'top', kills: 2, assists: 2 }),
    ];
    const extras = scoutingExtrasOf({ pool: [...before, ...week], window: W, optedOut: new Set() });
    expect(extras.bestGame).toEqual({ champion: 'Ornn', kills: 11, assists: 7, won: false });
    expect(extras.newChampion).toEqual({ name: 'Ornn', games: 2 });
    expect(extras.roleShift).toEqual({ weekRole: 'top', weekGames: 3, usualRole: 'jungle' });
    // Too few earlier games: nothing is "new".
    expect(
      scoutingExtrasOf({ pool: [...before.slice(0, 4), ...week], window: W, optedOut: new Set() })
        .newChampion,
    ).toBeUndefined();
  });

  it('the facts carry them, the partner as P2; with no extras the list is unchanged', () => {
    const base = scoutingInputOf({
      playerId: 'p',
      weekStart: WEEK,
      rating: { games: 20, wins: 12 },
      week: { games: 3, wins: 1 },
      pool: pool(64, 'jungle', 8, 5),
    });
    const plain = buildPlayerFacts(base, new Set()) as FactList;
    expect(plain.tokenMap).toEqual({ P1: 'p' });
    const list = buildPlayerFacts(
      {
        ...base,
        extras: {
          duo: { partnerId: 'ana', games: 9, wins: 7 },
          bestGame: { champion: 'Lee Sin', kills: 12, assists: 8, won: true },
          newChampion: { name: 'Ornn', games: 2 },
          roleShift: { weekRole: 'top', weekGames: 3, usualRole: 'jungle' },
        },
      },
      new Set(),
    ) as FactList;
    expect(list.tokenMap).toEqual({ P1: 'p', P2: 'ana' });
    const text = list.facts.map(renderFact).join('\n');
    expect(text).toContain('P2 | the teammate the player this report is about wins with most');
    expect(text).toContain('9 games together on the same team | 7 wins together on the same team');
    expect(text).toContain(
      'their best game in the week before this report | it was a win | champion Lee Sin | 12 kills in that game',
    );
    expect(text).toContain('champion Ornn | 2 games on Ornn in the week before this report');
    expect(text).toContain('mostly top lane, away from their usual jungle');
    expect(text).not.toMatch(/deaths/);
    // An opted-out partner is no fact and no token.
    const out = buildPlayerFacts(
      { ...base, extras: { duo: { partnerId: 'ana', games: 9, wins: 7 } } },
      new Set(['ana']),
    ) as FactList;
    expect(out.tokenMap).toEqual({ P1: 'p' });
    // A report naming the partner passes the checker with their numbers.
    expect(
      checkLine(
        '{P1} and {P2} win together: 7 wins in 9 games on the same team. Over the week {P1} went 1 win in 3 games.',
        list,
      ),
    ).toMatchObject({ ok: true });
  });

  it('a losing week is a plain count: rough, tough, quiet, cold are refused for a report, not for a game', () => {
    const list = buildPlayerFacts(
      scoutingInputOf({
        playerId: 'p',
        weekStart: WEEK,
        rating: { games: 20, wins: 12 },
        week: { games: 3, wins: 1 },
        pool: pool(64, 'jungle', 8, 5),
      }),
      new Set(),
    ) as FactList;
    for (const word of ['rough', 'tough', 'quiet', 'quieter', 'cold']) {
      expect(
        checkLine(`{P1} means Lee Sin. Over the week {P1} had a ${word} 1 win in 3 games.`, list),
      ).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
    }
    expect(checkLine('{P1} means Lee Sin. Over the week {P1} went 1 win in 3 games.', list)).toMatchObject({
      ok: true,
    });
  });
});
