import { createHash } from 'node:crypto';
import { aiFactListSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import type { StoredSplit } from '@/components/receipt/types';
import { gameReceiptOf } from '@/lib/games/receipt';
import {
  AI_GAME,
  AI_GROUP_ID,
  AI_GROUP_NAME,
  AI_PLAYER,
  AI_PLAYERS,
  AI_RIOT_IDS,
  AI_WEEK,
  playerId,
} from '@/lib/testing/aiFixtures';
import {
  buildGameFacts,
  buildPlayerFacts,
  buildPrompt,
  buildWeekFacts,
  type FactList,
  FIRST_CHAMPION_MIN_GAMES,
  factHash,
  type GameFactsInput,
  gameHistoryOf,
  gameShape,
  HISTORY_MAX_PAGES,
  type HistoryRow,
  leadAngleOf,
  openingOf,
  PERSONAL_BEST_MIN_GAMES,
  PLAYER_FIGURE_MIN_GAMES,
  readSeatHistory,
  receiptUpset,
  recentLineForPrompt,
  renderFact,
  renderFactWith,
  storyAngles,
  systemPrompt,
  thousands,
} from './facts';
import { AI_FEATURES } from './meter';

/** M16.3: the fact builder's guarantees, and every prompt builder's request body. */

const game = buildGameFacts(AI_GAME, new Set()) as FactList;

function factOf(list: FactList, token: string) {
  return list.facts.filter((fact) => fact.token === token);
}

describe('buildGameFacts', () => {
  it('validates against the stored schema and numbers the facts F1..Fn', () => {
    expect(aiFactListSchema.safeParse(game.facts).success).toBe(true);
    expect(game.facts.map((fact) => fact.id)).toEqual(game.facts.map((_, index) => `F${index + 1}`));
  });

  it('tokens winners first in lane order, then losers, and maps each to its player id', () => {
    // M16.16: Red's top (P6) and jungler (P7) earned no number, so they hold their place in the order
    // but have no token in the map.
    expect(game.tokenMap).toEqual(
      Object.fromEntries(
        AI_PLAYERS.map((player, index) => [`P${index + 1}`, player.id]).filter(
          ([token]) => token !== 'P6' && token !== 'P7',
        ),
      ),
    );
  });

  it('carries the game, the winning team and the upset; nothing about odds, MVP/ACE or ratings', () => {
    expect(renderFact(game.facts[0] as never)).toBe(
      "F1: game | Summoner's Rift custom game | Blue won | upset: the underdog won | 31 game length",
    );
    expect(renderFact(game.facts[1] as never)).toBe('F2: Blue team | won | 39 team kills');
    const all = JSON.stringify(game.facts).toLowerCase();
    for (const word of [
      'odds',
      'chance',
      'favored',
      'favoured',
      'mvp',
      'ace',
      'rating',
      'mu',
      'sigma',
      '%',
    ]) {
      expect(all).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    expect(game.facts.flatMap((fact) => fact.values.map((v) => v.unit))).not.toContain('rating');
    expect(game.facts.flatMap((fact) => fact.values.map((v) => v.unit))).not.toContain('percent');
  });

  it('gives a winner the whole line and their superlatives', () => {
    expect(renderFact(factOf(game, 'P2')[0] as never)).toBe(
      'F4: P2 | Blue team | won | jungle | champion Lee Sin | 9 kills | 0 deaths | 5 assists | 160 CS | 18220 damage to champions | 31 vision score | 14 of 39 team kills they took part in | most kills in the game | no deaths all game | fewest deaths in the game',
    );
  });

  it('gives a losing player only their best numbers: never deaths, never a low stat, never their total', () => {
    const losers = game.facts.filter((fact) => fact.side === 200);
    expect(losers.length).toBe(3);
    for (const fact of losers) {
      expect(fact.values.map((v) => v.unit)).not.toContain('deaths');
      expect(fact.values.some((v) => v.of !== undefined)).toBe(false);
      expect(fact.values.length).toBeGreaterThan(0);
    }
    // Red's support had 1/11/3, 25 CS and 5,200 damage: only the 40 vision (second in the game).
    expect(factOf(game, 'P10')[0]?.values).toEqual([{ label: 'vision score', value: 40, unit: 'vision' }]);
    // Red's mid: most damage in the game, top kills on Red.
    expect(factOf(game, 'P8')[0]?.claims.map((c) => c.text)).toEqual([
      'most damage to champions in the game',
    ]);
    // No fact about Red as a team (their 25 kills would be a number to mock).
    expect(game.facts.some((fact) => fact.token === null && fact.side === 200)).toBe(false);
  });

  it('M16.16: a loser is named only for a number that is top 2 in the game or a personal best', () => {
    // Red's top, P6: 2/6/8 on Darius, no stat in the game's top two: no fact, no token.
    expect(Object.keys(game.tokenMap)).not.toContain('P6');
    expect(game.facts.some((fact) => fact.token === 'P6')).toBe(false);
    for (const fact of game.facts.filter((f) => f.side === 200 && f.token !== null)) {
      for (const v of fact.values) {
        const stat = v.label;
        const seats = AI_GAME.seats;
        const pick = (s: (typeof seats)[number]) =>
          stat === 'kills'
            ? s.kills
            : stat === 'assists'
              ? s.assists
              : stat === 'CS'
                ? s.cs
                : stat === 'vision score'
                  ? (s.visionScore ?? 0)
                  : s.damageToChamps;
        const better = seats.filter((s) => pick(s) > v.value).length;
        expect(better, `${fact.token} ${stat}`).toBeLessThan(2);
      }
    }
    // A personal best brings P6 back, with that number only.
    const withBest = buildGameFacts(
      withSeat(5, { history: { winStreak: null, firstOnChampion: false, personalBests: ['assists'] } }),
      new Set(),
    ) as FactList;
    expect(factOf(withBest, 'P6')[0]?.values).toEqual([
      { label: 'assists', value: (AI_GAME.seats[5] as { assists: number }).assists, unit: 'assists' },
    ]);
  });

  it('leaves an opted-out player out entirely; totals still count them; their superlative goes to nobody', () => {
    const optedOut = new Set([playerId(1)]);
    const list = buildGameFacts(AI_GAME, optedOut) as FactList;
    expect(Object.values(list.tokenMap)).not.toContain(playerId(1));
    expect(Object.keys(list.tokenMap)).toHaveLength(7);
    expect(JSON.stringify(list)).not.toContain('Lee Sin');
    expect(list.facts[1]?.values).toEqual([{ label: 'team kills', value: 39, unit: 'kills' }]);
    expect(list.facts.some((fact) => fact.claims.some((c) => c.text === 'most kills in the game'))).toBe(
      false,
    );
  });

  it('is null when everyone opted out', () => {
    expect(buildGameFacts(AI_GAME, new Set(AI_PLAYERS.map((player) => player.id)))).toBeNull();
  });

  it('drops a champion the roster does not know, and keeps notes free of digits', () => {
    const list = buildGameFacts(
      { ...AI_GAME, seats: AI_GAME.seats.map((seat) => ({ ...seat, champion: 'Champion 950' })) },
      new Set(),
    ) as FactList;
    expect(list.facts.every((fact) => fact.champions.length === 0)).toBe(true);
    expect(list.facts.every((fact) => fact.notes.every((note) => !/\d/.test(note)))).toBe(true);
  });

  it('a tie for the lead gives nobody the claim', () => {
    const tied = buildGameFacts(
      { ...AI_GAME, seats: AI_GAME.seats.map((seat, index) => (index === 2 ? { ...seat, kills: 9 } : seat)) },
      new Set(),
    ) as FactList;
    expect(tied.facts.some((fact) => fact.claims.some((c) => c.text === 'most kills in the game'))).toBe(
      false,
    );
  });
});

describe('buildWeekFacts', () => {
  const week = buildWeekFacts(AI_WEEK, new Set()) as FactList;

  it('talks about the top of the board, positive climbs, streaks and awards only', () => {
    expect(aiFactListSchema.safeParse(week.facts).success).toBe(true);
    // The sixth row (1 win in 8, a -140 climb) is in no fact.
    expect(Object.values(week.tokenMap)).not.toContain(playerId(9));
    expect(week.facts.flatMap((fact) => fact.values).some((v) => v.value === 140 || v.value === 1101)).toBe(
      false,
    );
    const leader = factOf(week, 'P1')[0];
    expect(leader?.claims.map((c) => c.claim)).toEqual(['first', 'max', 'max', 'max']);
    expect(leader?.notes).toEqual(['won the most improved award']);
  });

  it('leaves an opted-out leader out, and gives their first place to nobody', () => {
    const list = buildWeekFacts(AI_WEEK, new Set([playerId(1)])) as FactList;
    expect(Object.values(list.tokenMap)).not.toContain(playerId(1));
    expect(list.facts.some((fact) => fact.claims.some((c) => c.claim === 'first'))).toBe(false);
  });
});

describe('M16.13 week facts the model kept reaching for', () => {
  it('the one player with the most games on the whole board, and a week won game for game', () => {
    const list = buildWeekFacts(
      {
        ...AI_WEEK,
        board: [
          { playerId: playerId(1), games: 6, wins: 6 },
          { playerId: playerId(2), games: 14, wins: 7 },
          { playerId: playerId(0), games: 10, wins: 6 },
        ],
      },
      new Set(),
    ) as FactList;
    expect(factOf(list, 'P1')[0]?.claims).toContainEqual({
      claim: 'all',
      text: 'won every game they played in the week',
    });
    expect(factOf(list, 'P2')[0]?.claims).toContainEqual({
      claim: 'max',
      text: 'most games played in the week',
    });
    expect(JSON.stringify(factOf(list, 'P3'))).not.toMatch(/most games|every game/);
  });

  it('a tie for most games, or a perfect week under five games, is no claim', () => {
    const list = buildWeekFacts(
      {
        ...AI_WEEK,
        board: [
          { playerId: playerId(1), games: 4, wins: 4 },
          { playerId: playerId(2), games: 9, wins: 5 },
          { playerId: playerId(0), games: 9, wins: 6 },
        ],
      },
      new Set(),
    ) as FactList;
    expect(JSON.stringify(list.facts)).not.toMatch(/most games|every game/);
  });
});

describe('buildPlayerFacts', () => {
  it('is null for a settling or opted-out player', () => {
    expect(buildPlayerFacts({ ...AI_PLAYER, ratedGames: 9 }, new Set())).toBeNull();
    expect(buildPlayerFacts(AI_PLAYER, new Set([AI_PLAYER.playerId]))).toBeNull();
  });

  it(`names a champion or a role only from ${PLAYER_FIGURE_MIN_GAMES}+ games`, () => {
    const list = buildPlayerFacts(AI_PLAYER, new Set()) as FactList;
    const champions = list.facts.flatMap((fact) => fact.champions);
    expect(champions).toEqual(['Lee Sin', 'Vi']);
    expect(champions).not.toContain('Ahri'); // 3 games
    const text = list.facts.map(renderFact).join('\n');
    expect(text).toContain('30 games in jungle');
    expect(text).not.toContain('top lane'); // 4 games
  });

  it('prints a win rate only when it is at least half', () => {
    const list = buildPlayerFacts(AI_PLAYER, new Set()) as FactList;
    const text = list.facts.map(renderFact).join('\n');
    expect(text).toContain('71 win rate on Lee Sin');
    expect(text).not.toContain('win rate on Vi'); // 2 of 6
  });
});

describe('every prompt builder: no names, Riot IDs, PUUIDs, Discord names, group names or ids', () => {
  const lists: [string, FactList][] = [
    ['game', game],
    ['game, retry', game],
    ['week', buildWeekFacts(AI_WEEK, new Set()) as FactList],
    ['player', buildPlayerFacts(AI_PLAYER, new Set()) as FactList],
  ];
  const forbidden = [
    ...AI_PLAYERS.flatMap((player) => [player.name, player.puuid, player.id]),
    ...AI_RIOT_IDS,
    AI_GROUP_NAME,
    AI_GROUP_ID,
    AI_GAME.gameId,
    'customs',
  ];

  it.each(lists)('%s', (label, list) => {
    const prompt = buildPrompt(
      list,
      label.includes('retry') ? 'number: "10 kills" is not in the facts' : null,
    );
    const body = JSON.stringify({
      model: prompt.model,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    for (const needle of forbidden) expect(body, needle).not.toContain(needle);
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(prompt.model).toBe(AI_FEATURES[list.kind].model);
    expect(prompt.maxTokens).toBe(AI_FEATURES[list.kind].maxTokens);
  });
});

describe('factHash', () => {
  it('is stable for the same facts and changes with them', () => {
    expect(factHash(game)).toMatch(/^[0-9a-f]{64}$/);
    expect(factHash(buildGameFacts(AI_GAME, new Set()) as FactList)).toBe(factHash(game));
    expect(factHash(buildGameFacts(AI_GAME, new Set([playerId(0)])) as FactList)).not.toBe(factHash(game));
  });
});

/* ---------------------------------------------------------------------------------------------
 * M16.8: the facts that make a recap a story, and the prompt they go into
 * ------------------------------------------------------------------------------------------- */

const seatAt = (index: number) => AI_GAME.seats[index] as GameFactsInput['seats'][number];
const withSeat = (index: number, patch: Partial<GameFactsInput['seats'][number]>): GameFactsInput => ({
  ...AI_GAME,
  seats: AI_GAME.seats.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)),
});

describe('M16.8 game shape', () => {
  const shapeOf = (minutes: number, winner: number, loser: number) =>
    gameShape({ ...AI_GAME, durationS: minutes * 60 + 5 }, winner, loser);

  it('names short, long, lopsided, close and won-with-fewer-kills games in words', () => {
    expect(shapeOf(16, 20, 4)).toEqual(['short game', 'lopsided game']);
    expect(shapeOf(48, 40, 38)).toEqual(['long game', 'close game: the team kills were nearly level']);
    expect(shapeOf(30, 24, 29)).toEqual(['the winners had fewer team kills than the losers']);
    expect(shapeOf(30, 30, 20)).toEqual([]);
    // A scoreboard with no kills on it is not a close game.
    expect(shapeOf(30, 0, 0)).toEqual([]);
  });

  it('goes last, as a fact of words only, so every other fact keeps its id', () => {
    const list = buildGameFacts({ ...AI_GAME, durationS: 15 * 60 }, new Set()) as FactList;
    const last = list.facts.at(-1);
    expect(last).toMatchObject({ token: null, side: null, values: [], notes: ['short game'] });
    expect(list.facts.slice(1, game.facts.length).map(renderFact)).toEqual(
      game.facts.slice(1).map(renderFact),
    );
    // AI_GAME itself (31 minutes, 39 to 25) has no shape, so its facts are unchanged.
    expect(game.facts.at(-1)?.token).toBe('P10');
  });
});

describe('M16.8 winners can be teased, losers get credit', () => {
  it('gives the most deaths in the game to a winner who holds it alone, with "still won"', () => {
    const list = buildGameFacts(withSeat(0, { deaths: 12 }), new Set()) as FactList;
    const garen = factOf(list, 'P1')[0];
    expect(garen?.claims.map((c) => c.text)).toContain('most deaths in the game, on the winning team');
    expect(garen?.notes).toContain('still won');
  });

  it('never gives it to a loser (AI_GAME: Red support has the most deaths)', () => {
    expect(JSON.stringify(game.facts)).not.toContain('most deaths');
  });

  it('marks a losing player who led the game in something as a standout', () => {
    expect(factOf(game, 'P8')[0]?.notes).toContain('standout on the losing side');
    expect(factOf(game, 'P10')[0]?.notes).not.toContain('standout on the losing side');
  });
});

describe('M16.8 history facts', () => {
  it('a winner on a streak gets "wins in a row"; a loser never does', () => {
    const list = buildGameFacts(
      {
        ...AI_GAME,
        seats: AI_GAME.seats.map((seat, i) =>
          i === 1 || i === 7
            ? { ...seat, history: { winStreak: 4, firstOnChampion: false, personalBests: [] } }
            : seat,
        ),
      },
      new Set(),
    ) as FactList;
    expect(factOf(list, 'P2')[0]?.values).toContainEqual({
      label: 'wins in a row',
      value: 4,
      unit: 'streak',
    });
    expect(factOf(list, 'P8')[0]?.values.some((v) => v.unit === 'streak')).toBe(false);
  });

  it('a first on a champion and a personal best are claims, for either side', () => {
    const list = buildGameFacts(
      withSeat(9, { history: { winStreak: null, firstOnChampion: true, personalBests: ['assists'] } }),
      new Set(),
    ) as FactList;
    const support = factOf(list, 'P10')[0];
    expect(support?.claims).toEqual(
      expect.arrayContaining([
        { claim: 'first', text: `first game on ${seatAt(9).champion} in the group` },
        { claim: 'max', text: 'personal best: their most assists in the group' },
      ]),
    );
    // The personal best's number is given even though it was no top-three number.
    expect(support?.values).toContainEqual({ label: 'assists', value: seatAt(9).assists, unit: 'assists' });
    expect(support?.values.map((v) => v.unit)).not.toContain('deaths');
  });

  const row = (n: number, patch: Partial<HistoryRow> = {}): HistoryRow => ({
    startedAt: `2026-09-${String(10 + n).padStart(2, '0')}T20:00:00Z`,
    won: false,
    aram: false,
    championId: 64,
    kills: 5,
    assists: 5,
    cs: 150,
    damageToChamps: 15_000,
    visionScore: 20,
    ...patch,
  });
  const seat = { ...seatAt(1), championId: 64, won: true, aram: false };

  it('M16.15: a streak only when it is news: 5+, or a new longest run of theirs from 4', () => {
    // Rows in any order; the run counts back from this game, newest first.
    const won = (n: number) => row(n, { won: true });
    // 5 in a row (four earlier wins): news.
    expect(gameHistoryOf(seat, [won(4), won(2), row(1), won(3), won(5)])?.winStreak).toBe(5);
    // 4 in a row, longer than anything before: a record, news.
    const record = gameHistoryOf(seat, [won(6), won(5), won(4), row(3), won(2), row(1)]);
    expect(record).toMatchObject({ winStreak: 4, longestStreak: true });
    // 4 in a row, but they once won 4 straight: not news.
    expect(
      gameHistoryOf(seat, [won(9), won(8), won(7), row(6), won(5), won(4), won(3), won(2)])?.winStreak ??
        null,
    ).toBeNull();
    // 3 in a row, the old threshold: never news any more.
    expect(gameHistoryOf(seat, [won(4), won(3), row(2)])).toBeNull();
    expect(gameHistoryOf({ ...seat, won: false }, [won(4), won(3), won(2), won(1)])).toBeNull();
  });

  it('M16.15: a record streak carries a claim the line may lead with', () => {
    const list = buildGameFacts(
      withSeat(1, {
        history: { winStreak: 4, longestStreak: true, firstOnChampion: false, personalBests: [] },
      }),
      new Set(),
    ) as FactList;
    expect(factOf(list, 'P2')[0]?.claims).toContainEqual({
      claim: 'max',
      text: 'their longest run of wins in a row in the group',
    });
  });

  it(`a first on a champion needs ${FIRST_CHAMPION_MIN_GAMES} earlier games and none on it`, () => {
    const fresh = { ...seat, championId: 7 };
    const four = [1, 2, 3, 4].map((n) => row(n));
    expect(gameHistoryOf(fresh, four)).toBeNull();
    expect(gameHistoryOf(fresh, [...four, row(5)])?.firstOnChampion).toBe(true);
    expect(gameHistoryOf(seat, [...four, row(5)])).toBeNull();
  });

  it(`a personal best beats every earlier Rift game, against ${PERSONAL_BEST_MIN_GAMES} of them; ARAM is not compared`, () => {
    const nine = Array.from({ length: 9 }, (_, n) => row(n + 1));
    expect(gameHistoryOf(seat, nine)?.personalBests ?? []).toEqual([]);
    const ten = [...nine, row(10)];
    // seatAt(1): 9 kills, 5 assists, 160 CS, 18220 damage, 31 vision against 5 / 5 / 150 / 15000 / 20.
    expect(gameHistoryOf(seat, ten)?.personalBests).toEqual(['kills', 'cs', 'damage', 'vision']);
    // A tie is not a best; an ARAM game neither counts nor is compared.
    expect(gameHistoryOf(seat, [...ten, row(11, { kills: 9 })])?.personalBests).not.toContain('kills');
    expect(gameHistoryOf(seat, [...ten, row(11, { kills: 30, aram: true })])?.personalBests).toContain(
      'kills',
    );
    expect(gameHistoryOf({ ...seat, aram: true }, ten)).toBeNull();
  });

  it('a history that could not be read is no fact', () => {
    expect(gameHistoryOf(seat, null)).toBeNull();
  });
});

describe('M16.8 the game prompt', () => {
  it('lists the strongest angles first, at most four, read off the facts', () => {
    const list = buildGameFacts(
      {
        ...withSeat(9, { history: { winStreak: null, firstOnChampion: true, personalBests: ['assists'] } }),
        durationS: 15 * 60,
      },
      new Set(),
    ) as FactList;
    expect(storyAngles(list)).toEqual([
      'the underdog won: an upset',
      'P10: personal best: their most assists in the group',
      `P10: first game on ${seatAt(9).champion} in the group`,
      'P2: no deaths all game, and won',
    ]);
    expect(storyAngles(buildWeekFacts(AI_WEEK, new Set()) as FactList)).toEqual([]);
  });

  it('prints damage in thousands for the game prompt only; renderFact is unchanged', () => {
    expect(thousands(18_220)).toBe('18.2k');
    expect(thousands(29_880)).toBe('29.9k');
    expect(thousands(31_000)).toBe('31k');
    expect(thousands(950)).toBe('950');
    const p2 = factOf(game, 'P2')[0] as FactList['facts'][number];
    expect(renderFactWith(p2, { thousands: true })).toContain('18.2k damage to champions');
    expect(renderFact(p2)).toContain('18220 damage to champions');
    expect(buildPrompt(game).user).toContain('18.2k damage to champions');
  });

  it("tells the model not to echo the group's recent lines, with no token or number of theirs", () => {
    expect(recentLineForPrompt('{P3} went 14 kills and 29.9k damage on Jinx.')).toBe(
      'someone went N kills and N damage on Jinx.',
    );
    const recent = ['{P1} makes it 5 wins in a row.', '{P4} played 22 minutes without a death.'];
    const prompt = buildPrompt(game, null, recent);
    expect(prompt.user).toContain('- someone makes it N wins in a row.');
    expect(prompt.user).not.toContain('{P1} makes');
    // Only the game line gets the list.
    expect(buildPrompt(buildWeekFacts(AI_WEEK, new Set()) as FactList, null, recent).user).not.toContain(
      'someone',
    );
  });
});

describe('M16.9 readSeatHistory: ordered pages and a ceiling', () => {
  /** A fake PostgREST chain: records the calls, answers each `range` with `pageOf(from)`. */
  function fakeService(pageOf: (from: number) => unknown[]) {
    const calls: { method: string; args: unknown[] }[] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ['from', 'select', 'eq', 'lt', 'order']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    }
    chain.range = (from: unknown) => {
      calls.push({ method: 'range', args: [from] });
      return Promise.resolve({ data: pageOf(from as number), error: null });
    };
    return { service: chain as unknown as Parameters<typeof readSeatHistory>[0], calls };
  }
  const gameRow = {
    side: 100,
    champion_id: 64,
    kills: 3,
    assists: 4,
    cs: 120,
    damage_to_champs: 9000,
    vision_score: 10,
    games: { started_at: '2026-09-01T20:00:00Z', winning_side: 100, game_mode: 'CLASSIC' },
  };

  it('pages in a stable order and stops at a short page', async () => {
    const { service, calls } = fakeService((from) => (from === 0 ? Array(1000).fill(gameRow) : [gameRow]));
    const rows = await readSeatHistory(service, 'g', 'p', '2026-10-01T00:00:00Z');
    expect(rows).toHaveLength(1001);
    expect(rows?.[0]).toMatchObject({ won: true, aram: false, championId: 64 });
    expect(calls.filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual(['game_id', 'game_id']);
  });

  it(`gives no history past ${HISTORY_MAX_PAGES} full pages (a partial history could fake a first)`, async () => {
    const { service, calls } = fakeService(() => Array(1000).fill(gameRow));
    expect(await readSeatHistory(service, 'g', 'p', '2026-10-01T00:00:00Z')).toBeNull();
    expect(calls.filter((c) => c.method === 'range')).toHaveLength(HISTORY_MAX_PAGES);
  });
});

describe('receiptUpset (M15.18)', () => {
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  const blue = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const red = ['r1', 'r2', 'r3', 'r4', 'r5'];
  // Blue was the bot's 30% pick and won: an upset by the rolled odds.
  const run: StoredSplit[] = [
    {
      rank: 1,
      isChosen: true,
      blueWinProb: 0.3,
      gap: 40,
      offRoleCount: 0,
      blue: blue.map((puuid, i) => ({ puuid, role: ROLES[i] ?? 'top' })),
      red: red.map((puuid, i) => ({ puuid, role: ROLES[i] ?? 'top' })),
      explanation: 'Red favored 70%.',
    },
  ];
  const seat = (puuid: string, side: 100 | 200, mu: number) => ({
    puuid,
    side,
    muBefore: mu,
    sigmaBefore: 3,
  });
  const asRolled = [...blue.map((p) => seat(p, 100, 20)), ...red.map((p) => seat(p, 200, 30))];
  // Two swapped after the roll; ratings still say Blue was the underdog.
  const changed = [
    ...['r1', 'b2', 'b3', 'b4', 'b5'].map((p) => seat(p, 100, 20)),
    ...['b1', 'r2', 'r3', 'r4', 'r5'].map((p) => seat(p, 200, 30)),
  ];

  it('a not-rated game keeps the rolled odds and its Upset', () => {
    const receipt = gameReceiptOf({ aram: false, rated: false, seats: asRolled, splits: run });
    expect(receiptUpset(receipt, 100)).toBe(true);
  });

  it('a not-rated game whose teams changed has no odds, so no Upset', () => {
    const receipt = gameReceiptOf({ aram: false, rated: false, seats: changed, splits: run });
    expect(receipt).toEqual({ kind: 'none' });
    expect(receiptUpset(receipt, 100)).toBe(false);
  });

  it('a rated game whose teams changed is judged on pre-game odds, as before', () => {
    const receipt = gameReceiptOf({ aram: false, rated: true, seats: changed, splits: run });
    expect(receiptUpset(receipt, 100)).toBe(true);
  });

  it('ARAM is unchanged: rolled keeps its Upset, no roll has none', () => {
    expect(receiptUpset(gameReceiptOf({ aram: true, rated: false, seats: asRolled, splits: run }), 100)).toBe(
      true,
    );
    expect(receiptUpset(gameReceiptOf({ aram: true, rated: false, seats: asRolled, splits: [] }), 100)).toBe(
      false,
    );
  });
});

describe('M16.15 angle rotation', () => {
  it('reads the lead angle off the first sentence', () => {
    expect(leadAngleOf('{P1} makes it 5 wins in a row on Garen. {P2} had 9 kills.')).toBe('streak');
    expect(leadAngleOf('Top damage went to {P8}, from the losing side. {P1} made it 5 wins in a row.')).toBe(
      'loser',
    );
    expect(leadAngleOf('Red took the upset in 27 minutes.')).toBe('upset');
    expect(leadAngleOf('{P2} had 9 kills on Lee Sin.')).toBe('other');
  });

  it("drops the previous line's lead angle from the angles and says so, unless exceptional", () => {
    const withStreak = (wins: number) =>
      buildGameFacts(
        {
          ...AI_GAME,
          upset: false,
          seats: AI_GAME.seats.map((seat, i) =>
            i === 0
              ? { ...seat, history: { winStreak: wins, firstOnChampion: false, personalBests: [] } }
              : seat,
          ),
        },
        new Set(),
      ) as FactList;
    const five = withStreak(5);
    expect(storyAngles(five)).toContain('P1: 5 wins in a row');
    expect(storyAngles(five, 'streak')).not.toContain('P1: 5 wins in a row');
    const prompt = buildPrompt(five, null, ['{P4} makes it 6 wins in a row on Jinx.']);
    expect(prompt.user).toContain(
      'The previous line led with a win streak. Lead with something else this time.',
    );
    expect(prompt.user).not.toContain('- P1: 5 wins in a row');

    // A 7-game streak is news even right after another streak line.
    const again = buildPrompt(withStreak(7), null, ['{P4} makes it 6 wins in a row on Jinx.']);
    expect(again.user).toContain('- P1: 7 wins in a row');
    expect(again.user).not.toContain('Lead with something else');
  });

  it('spells out the openings already used, masked', () => {
    expect(openingOf('someone set a personal best with N kills.')).toBe('someone set a');
    const prompt = buildPrompt(game, null, [
      '{P3} set a personal best with 14 kills.',
      '{P1} set a group best with 300 CS.',
      'Red took the upset in 27 minutes.',
    ]);
    expect(prompt.user).toContain(
      'Openings already used, do not start with any of them: someone set a / Red took the.',
    );
  });

  it('an upset is no exception: a second upset line in a row is asked to lead with something else', () => {
    const upset = buildGameFacts({ ...AI_GAME, upset: true }, new Set()) as FactList;
    const prompt = buildPrompt(upset, null, ['Red took the upset in 27 minutes.']);
    expect(prompt.user).toContain('The previous line led with an upset. Lead with something else this time.');
    expect(prompt.user).not.toContain('- the underdog won: an upset');
  });
});

describe('system prompts per provider (DeepSeek, 2026-10-04)', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

  it("keeps Claude's prompts byte for byte what M16.8-M16.19 tuned", () => {
    expect(sha(systemPrompt('game', 'anthropic'))).toBe('4f424a950ab457fe');
    expect(sha(systemPrompt('week', 'anthropic'))).toBe('07c13f69006efaec');
    expect(sha(systemPrompt('player', 'anthropic'))).toBe('5f5dc0d3fa252474');
  });

  it.each(['game', 'week', 'player'] as const)('gives DeepSeek its binding rules last (%s)', (kind) => {
    const prompt = systemPrompt(kind, 'deepseek');
    expect(prompt).toContain('Binding rules, checked by a program');
    expect(prompt).toContain('Plain ASCII only');
    expect(prompt.split('\n').at(-1)).toMatch(/^Reply with the line only/);
    expect(systemPrompt(kind, 'anthropic')).not.toContain('Binding rules');
    // The same strict rules block as Claude's: DeepSeek's wording only adds.
    expect(prompt).toContain('Rules, all of them strict; a line that breaks one is thrown away:');
  });

  it('defaults to the provider of the process feature table', () => {
    for (const kind of ['game', 'week', 'player'] as const) {
      const provider = AI_FEATURES[kind].model.startsWith('deepseek') ? 'deepseek' : 'anthropic';
      expect(systemPrompt(kind)).toBe(systemPrompt(kind, provider));
    }
  });
});
