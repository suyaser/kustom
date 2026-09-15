import { describe, expect, it } from 'vitest';
import { rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { funFactsView } from './fun';
import {
  champTimesLine,
  DOUBLE_TITLE,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_TAKEN_EMPTY,
  FIRST_BLOOD_TITLE,
  fearBanLine,
  funRoast,
  LUCKY_TRASH,
  ODDS_EMPTY,
  ODDS_NONE_TWICE,
  ODDS_TITLE,
  OTP_TITLE,
  otpLine,
  PENTA_EMPTY,
  PENTA_TITLE,
  POOL_EMPTY,
  QUADRA_TITLE,
  ROBBED,
  TRIPLE_TITLE,
  TURRET_TITLE,
  timesLine,
  VARIETY_TITLE,
  varietyLine,
  WON_UGLY,
} from './funCopy';
import { playerFacts, type RawGameFacts } from './rawFacts';

function loudLena() {
  return tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    blue: [
      {
        key: 'lena',
        role: 'adc',
        kills: 18,
        deaths: 2,
        assists: 9,
        cs: 280,
        damageToChamps: 32_000,
        gold: 16_000,
      },
      {
        key: 'iris',
        role: 'top',
        kills: 4,
        deaths: 5,
        assists: 6,
        cs: 190,
        damageToChamps: 14_000,
        gold: 11_000,
      },
      {
        key: 'rami',
        role: 'jungle',
        kills: 6,
        deaths: 4,
        assists: 12,
        cs: 160,
        damageToChamps: 12_000,
        gold: 12_000,
      },
      {
        key: 'omar',
        role: 'mid',
        kills: 8,
        deaths: 3,
        assists: 7,
        cs: 220,
        damageToChamps: 18_000,
        gold: 13_000,
      },
      {
        key: 'theo',
        role: 'support',
        kills: 1,
        deaths: 6,
        assists: 20,
        cs: 40,
        damageToChamps: 4_000,
        gold: 8_000,
      },
    ],
    red: [
      {
        key: 'yuki',
        role: 'adc',
        kills: 2,
        deaths: 11,
        assists: 1,
        cs: 90,
        damageToChamps: 6_000,
        gold: 9_000,
      },
      {
        key: 'nadia',
        role: 'top',
        kills: 3,
        deaths: 7,
        assists: 2,
        cs: 140,
        damageToChamps: 8_000,
        gold: 9_500,
      },
      {
        key: 'karim',
        role: 'jungle',
        kills: 1,
        deaths: 8,
        assists: 3,
        cs: 80,
        damageToChamps: 5_000,
        gold: 8_500,
      },
      {
        key: 'hana',
        role: 'mid',
        kills: 4,
        deaths: 6,
        assists: 2,
        cs: 150,
        damageToChamps: 9_000,
        gold: 10_000,
      },
      {
        key: 'bilal',
        role: 'support',
        kills: 0,
        deaths: 9,
        assists: 4,
        cs: 18,
        damageToChamps: 2_000,
        gold: 7_000,
      },
    ],
  });
}

describe('funFactsView', () => {
  it('uses the same counted-game gate as /stats — a remake is not a record', () => {
    const remake = statsGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 120,
      blue: ['lena:adc', 'iris:top', 'rami:jungle', 'omar:mid', 'theo:support'],
      red: ['yuki:adc', 'nadia:top', 'karim:jungle', 'hana:mid', 'bilal:support'],
    });
    const facts = funFactsView([remake], rosterFor([remake]));
    expect(facts.games).toBe(0);
    expect(facts.records.find((record) => record.id === 'kills')?.holders).toEqual([]);
    expect(facts.fates.every((block) => block.holders.length === 0)).toBe(true);
  });

  it('names the highest and lowest CS at a role in one counted game', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    const adc = facts.csByRole.find((pair) => pair.role === 'adc');
    expect(adc?.highest?.name).toBe('Lena');
    expect(adc?.highest?.valueLabel).toContain('280 CS');
    expect(adc?.lowest?.name).toBe('Yuki');
  });

  it('roasts the English titles in Egyptian 3ameya, not a translation', () => {
    expect(funRoast(FIRST_BLOOD_TITLE)).toBe('مين فتحها');
    expect(funRoast(PENTA_TITLE)).toBe('كنسهم كنس');
    expect(funRoast(WON_UGLY)).toBe('كسب وهو زبالة');
    expect(funRoast(OTP_TITLE)).toBe('اكتر واحد معرق');
    expect(funRoast(VARIETY_TITLE)).toBe('لعيب بيلعب بشامبيونات مختلفة');
    expect(funRoast(LUCKY_TRASH)).toBe('المحظوظ طرش');
    expect(funRoast(ROBBED)).toBe('المظلوم بزيادة');
    expect(funRoast('not a /fun title')).toBeNull();
  });

  it('crowns one-game combat records from the stored scoreboard', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    const kills = facts.records.find((record) => record.id === 'kills')?.holders[0];
    expect(kills?.name).toBe('Lena');
    expect(kills?.game?.blue.seats.some((seat) => seat.puuid === 'u-lena')).toBe(true);
    expect(kills?.game?.red.seats.length).toBe(5);
    expect(facts.deathHall.find((record) => record.id === 'deaths')?.holders[0]?.name).toBe('Yuki');
    expect(facts.records.find((record) => record.id === 'assists')?.holders[0]?.name).toBe('Theo');
    expect(facts.records.find((record) => record.id === 'damage')?.holders[0]?.name).toBe('Lena');
  });

  it('leaves the museum empty when the stored block named no killer', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.museum.rows).toEqual([]);
    expect(facts.museum.empty).toBe(FIRST_BLOOD_EMPTY);
    expect(facts.donated.rows).toEqual([]);
    expect(facts.donated.empty).toBe(FIRST_BLOOD_TAKEN_EMPTY);
    expect(facts.notes).toEqual([]);
    expect(facts.halls.map((hall) => hall.title)).toEqual([
      PENTA_TITLE,
      QUADRA_TITLE,
      TRIPLE_TITLE,
      DOUBLE_TITLE,
      TURRET_TITLE,
    ]);
    expect(facts.halls.every((hall) => hall.rows.length === 0)).toBe(true);
    expect(facts.halls[0]?.empty).toBe(PENTA_EMPTY);
    expect(facts.records.find((record) => record.id === 'spree')?.holders).toEqual([]);
  });

  it('names the first-blood killer, their champion, and the night', () => {
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 6 }],
      rawFacts: rawFacts({
        players: { 'u-lena': { firstBloodKill: true, championName: 'Ahri' } },
      }),
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.museum.rows[0]?.taker).toEqual({ puuid: 'u-lena', name: 'Lena' });
    expect(facts.museum.rows[0]?.countLabel).toBe('1 first blood');
    expect(facts.museum.rows[0]?.openings[0]).toMatchObject({
      champion: 'Ahri',
      victim: null,
      when: expect.stringContaining('Sep'),
    });
    expect(facts.donated.rows).toEqual([]);
  });

  it('names who donated first blood only when the block flagged the death', () => {
    const named = tenPlayerGame({
      id: 'fb-named',
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 0, assists: 6 }],
      red: [{ key: 'yuki', role: 'adc', championId: 22, kills: 1, deaths: 4, assists: 1 }],
      rawFacts: rawFacts({
        players: {
          'u-lena': { firstBloodKill: true, championName: 'Ahri' },
          'u-yuki': { firstBloodDeath: true, championName: 'Ashe' },
        },
      }),
    });
    const guessed = tenPlayerGame({
      id: 'fb-guess',
      at: '2026-09-03T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 3, deaths: 0, assists: 2 }],
      red: [{ key: 'yuki', role: 'adc', championId: 22, kills: 0, deaths: 8, assists: 1 }],
      rawFacts: rawFacts({
        players: {
          'u-lena': { firstBloodKill: true },
          'u-yuki': { longestLivedS: 40 },
        },
      }),
    });
    const facts = funFactsView([named, guessed], rosterFor([named, guessed]));
    expect(facts.donated.rows).toHaveLength(1);
    expect(facts.donated.rows[0]?.taker).toEqual({ puuid: 'u-yuki', name: 'Yuki' });
    expect(facts.donated.rows[0]?.countLabel).toBe('1 first blood taken');
    expect(facts.donated.rows[0]?.openings[0]).toMatchObject({
      champion: 'Ashe',
      victim: { puuid: 'u-lena', name: 'Lena' },
      foeVerb: 'to',
    });
    expect(facts.museum.rows[0]?.openings.map((row) => row.victim?.puuid ?? null)).toEqual([null, 'u-yuki']);
  });

  it('crowns a deathless streak and a steal from the stored extras', () => {
    const clean = (id: string, at: string) =>
      tenPlayerGame({
        id,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', deaths: 0, kills: 3, assists: 4 }],
        red: [{ key: 'yuki', role: 'adc', deaths: 4, kills: 1, assists: 1 }],
        rawFacts: rawFacts({
          players: {
            'u-lena': { longestLivedS: 1_800, objectivesStolen: 2, dragonKills: 1 },
            'u-yuki': { longestLivedS: 90 },
          },
        }),
      });
    const games = [
      othersDied(clean('g-a', '2026-09-01T20:00:00Z'), 'lena'),
      othersDied(clean('g-b', '2026-09-02T20:00:00Z'), 'lena'),
      othersDied(
        tenPlayerGame({
          id: 'g-c',
          at: '2026-09-03T20:00:00Z',
          durationS: 1_800,
          winner: 200,
          blue: [{ key: 'lena', role: 'adc', deaths: 3, kills: 1, assists: 1 }],
          rawFacts: rawFacts({ players: { 'u-lena': { longestLivedS: 400 } } }),
        }),
        'yuki',
      ),
    ];
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.deathHall.find((record) => record.id === 'deathless-streak')?.holders[0]?.name).toBe('Lena');
    expect(facts.deathHall.find((record) => record.id === 'shortest-life')?.holders[0]?.name).toBe('Yuki');
    expect(facts.thieves.find((record) => record.id === 'steals')?.holders[0]?.name).toBe('Lena');
    expect(facts.thieves.find((record) => record.id === 'steals')?.holders[0]?.valueLabel).toBe(
      '2 dragon steals',
    );
    expect(
      facts.deathHall.find((record) => record.id === 'deathless-games')?.holders[0]?.openings,
    ).toHaveLength(2);
    expect(facts.thieves.find((record) => record.id === 'steals-window')?.holders[0]?.openings.length).toBe(
      2,
    );
  });

  it('groups first bloods by the taker and ranks the lobby champions', () => {
    const first = (id: string, at: string, key: 'lena' | 'omar', championId: number) =>
      tenPlayerGame({
        id,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key, role: 'adc', championId, kills: 3, deaths: 1, assists: 2 }],
        rawFacts: rawFacts({
          players: { [`u-${key}`]: { firstBloodKill: true } },
          bans: [{ championId: 35, teamId: 200 }],
        }),
      });
    const games = [
      first('fb-a', '2026-09-01T20:00:00Z', 'lena', 103),
      first('fb-b', '2026-09-02T20:00:00Z', 'lena', 103),
      first('fb-c', '2026-09-03T20:00:00Z', 'omar', 35),
    ];
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.museum.rows.map((row) => [row.taker.name, row.count])).toEqual([
      ['Lena', 2],
      ['Omar', 1],
    ]);
    expect(facts.museum.rows[0]?.openings).toHaveLength(2);
    expect(facts.mostBanned.rows[0]).toMatchObject({ champion: 'Shaco', valueLabel: '3 bans' });
    expect(facts.mostPicked.rows[0]).toMatchObject({ champion: 'Ahri', valueLabel: '2 picks' });
  });

  it('counts Master Yi and Zac from stored draft bans, one per team per game', () => {
    const game = tenPlayerGame({
      id: 'bans-yi-zac',
      at: '2026-09-12T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
      rawFacts: rawFacts({
        bans: [
          { championId: 11, teamId: 100 },
          { championId: 154, teamId: 200 },
        ],
      }),
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.mostBanned.rows.map((row) => [row.champion, row.count])).toEqual([
      ['Master Yi', 1],
      ['Zac', 1],
    ]);
  });

  it('sums stored multi-kills per person and does not invent a penta from KDA', () => {
    const games = [
      tenPlayerGame({
        id: 'mk-a',
        at: '2026-09-01T20:00:00Z',
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: 'lena', role: 'adc', championId: 103, kills: 18, deaths: 1, assists: 4 },
          { key: 'omar', role: 'mid', championId: 35, kills: 8, deaths: 2, assists: 6 },
        ],
        rawFacts: rawFacts({
          players: {
            'u-lena': { tripleKills: 2, doubleKills: 3, largestKillingSpree: 8, championName: 'Ahri' },
            'u-omar': { tripleKills: 1, firstTowerKill: true, championName: 'Shaco' },
          },
        }),
      }),
      tenPlayerGame({
        id: 'mk-b',
        at: '2026-09-02T20:00:00Z',
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 12, deaths: 2, assists: 5 }],
        rawFacts: rawFacts({
          players: {
            'u-lena': { pentaKills: 1, quadraKills: 1, tripleKills: 1, championName: 'Ahri' },
          },
        }),
      }),
    ];
    const facts = funFactsView(games, rosterFor(games));
    const pentas = facts.halls.find((hall) => hall.title === PENTA_TITLE);
    const quadras = facts.halls.find((hall) => hall.title === QUADRA_TITLE);
    const triples = facts.halls.find((hall) => hall.title === TRIPLE_TITLE);
    const doubles = facts.halls.find((hall) => hall.title === DOUBLE_TITLE);
    const turrets = facts.halls.find((hall) => hall.title === TURRET_TITLE);
    expect(pentas?.rows.map((row) => [row.taker.name, row.count, row.countLabel])).toEqual([
      ['Lena', 1, '1 penta'],
    ]);
    expect(quadras?.rows[0]?.countLabel).toBe('1 quadra');
    expect(triples?.rows.map((row) => [row.taker.name, row.count, row.countLabel])).toEqual([
      ['Lena', 3, '3 triples'],
      ['Omar', 1, '1 triple'],
    ]);
    expect(triples?.rows[0]?.openings.map((row) => row.haul)).toEqual([null, '2 triples']);
    expect(doubles?.rows[0]).toMatchObject({ taker: { name: 'Lena' }, count: 3, countLabel: '3 doubles' });
    expect(turrets?.rows[0]).toMatchObject({
      taker: { name: 'Omar' },
      countLabel: '1 first turret',
      openings: [{ champion: 'Shaco', haul: null }],
    });
    expect(facts.records.find((record) => record.id === 'spree')?.holders[0]).toMatchObject({
      name: 'Lena',
      valueLabel: '8 kill streak',
    });
  });

  it('writes a fear-ban sentence from enemy draft bans', () => {
    const games = [1, 2, 3, 4, 5].map((n) =>
      tenPlayerGame({
        id: `g-fear-${n}`,
        at: `2026-09-0${n}T20:00:00Z`,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'omar', role: 'mid', championId: 35 }],
        rawFacts: rawFacts({
          bans: n <= 3 ? [{ championId: 35, teamId: 200 }] : [],
        }),
      }),
    );
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.fearBans.rows[0]?.line).toBe(fearBanLine('Omar', 'Shaco', 60, 3, 5));
  });

  it('ranks the one-trick and the player who never repeats a champion', () => {
    const champs = [103, 22, 51, 67, 222];
    const games = champs.map((championId, index) =>
      tenPlayerGame({
        id: `pool-${index}`,
        at: `2026-09-0${index + 1}T20:00:00Z`,
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: 'omar', role: 'mid', championId: 35 },
          { key: 'lena', role: 'adc', championId },
        ],
      }),
    );
    const facts = funFactsView(games, rosterFor(games));
    const otp = facts.pools.find((pool) => pool.id === 'otp');
    const variety = facts.pools.find((pool) => pool.id === 'variety');
    expect(otp?.rows[0]?.name).toBe('Omar');
    expect(otp?.rows[0]?.valueLabel).toBe(otpLine('Shaco', 5, 5));
    expect(otp?.rows[0]?.champs).toEqual([
      { championId: 35, champion: 'Shaco', count: 5, valueLabel: champTimesLine(5) },
    ]);
    expect(variety?.rows[0]?.name).toBe('Lena');
    expect(variety?.rows[0]?.valueLabel).toBe(varietyLine(5, 5));
    expect(variety?.rows[0]?.champs.map((row) => [row.champion, row.count])).toEqual([
      ['Ahri', 1],
      ['Ashe', 1],
      ['Caitlyn', 1],
      ['Jinx', 1],
      ['Vayne', 1],
    ]);
  });

  it('leaves both pools empty under five counted games with a champion', () => {
    const games = [1, 2, 3, 4].map((n) =>
      tenPlayerGame({
        id: `short-${n}`,
        at: `2026-09-0${n}T20:00:00Z`,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'omar', role: 'mid', championId: 35 }],
      }),
    );
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.pools.every((pool) => pool.rows.length === 0)).toBe(true);
    expect(facts.pools[0]?.empty).toBe(POOL_EMPTY);
  });

  it('ranks who was the worst scoreboard on a win and the best on a loss', () => {
    const fine = { kills: 4, deaths: 4, assists: 4 };
    const trash = { kills: 0, deaths: 8, assists: 1 };
    const carry = { kills: 12, deaths: 2, assists: 8 };
    const seat = (key: string, role: 'top' | 'jungle' | 'mid' | 'adc' | 'support') => ({
      key,
      role,
      championId: 1,
      ...fine,
    });
    const game = (id: string, at: string, passenger: 'bilal' | 'omar') =>
      tenPlayerGame({
        id,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: passenger, role: 'support', championId: passenger === 'bilal' ? 12 : 35, ...trash },
          seat('iris', 'top'),
          seat('rami', 'jungle'),
          seat('theo', 'mid'),
          seat('hana', 'adc'),
        ],
        red: [
          { key: 'lena', role: 'adc', championId: 103, ...carry },
          seat('yuki', 'support'),
          seat('nadia', 'top'),
          seat('karim', 'jungle'),
          seat(passenger === 'bilal' ? 'omar' : 'bilal', 'mid'),
        ],
      });
    const games = [
      game('fate-a', '2026-09-01T20:00:00Z', 'bilal'),
      game('fate-b', '2026-09-02T20:00:00Z', 'bilal'),
      game('fate-c', '2026-09-03T20:00:00Z', 'omar'),
    ];
    const facts = funFactsView(games, rosterFor(games));
    const lucky = facts.fates.find((block) => block.id === 'lucky-trash');
    const robbed = facts.fates.find((block) => block.id === 'robbed');
    expect(lucky?.holders.map((row) => [row.name, row.valueLabel])).toEqual([
      ['Bilal', timesLine(2)],
      ['Omar', timesLine(1)],
    ]);
    expect(lucky?.holders[0]?.openings.map((row) => row.label)).toEqual([
      '0/8/1 · Alistar',
      '0/8/1 · Alistar',
    ]);
    expect(robbed?.holders.map((row) => [row.name, row.valueLabel])).toEqual([['Lena', timesLine(3)]]);
    expect(robbed?.holders[0]?.openings).toHaveLength(3);
    expect(robbed?.holders[0]?.openings[0]?.label).toBe('12/2/8 · Ahri');
  });

  it('names a fountain resident only when CS and takedowns are both that low', () => {
    const farmed = { kills: 4, deaths: 3, assists: 5, cs: 180 };
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_400,
      winner: 100,
      blue: [
        { key: 'lena', role: 'adc', kills: 0, deaths: 4, assists: 1, cs: 12 },
        { key: 'iris', role: 'top', ...farmed },
        { key: 'rami', role: 'jungle', ...farmed },
        { key: 'omar', role: 'mid', ...farmed },
        { key: 'theo', role: 'support', ...farmed },
      ],
      red: [
        { key: 'yuki', role: 'adc', ...farmed },
        { key: 'nadia', role: 'top', ...farmed },
        { key: 'karim', role: 'jungle', ...farmed },
        { key: 'hana', role: 'mid', ...farmed },
        { key: 'bilal', role: 'support', ...farmed },
      ],
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.records.find((record) => record.id === 'fountain')?.holders[0]?.name).toBe('Lena');
  });
});

function othersDied(
  game: ReturnType<typeof tenPlayerGame>,
  except: string,
): ReturnType<typeof tenPlayerGame> {
  return {
    ...game,
    rows: game.rows.map((row) =>
      row.playerId === `p-${except}` ? row : { ...row, deaths: Math.max(1, row.deaths) },
    ),
  };
}

function rawFacts(spec: {
  players?: Record<string, Partial<RawGameFacts['byPuuid'][string]>>;
  bans?: RawGameFacts['bans'];
}): RawGameFacts {
  const byPuuid: RawGameFacts['byPuuid'] = {};
  for (const [puuid, extras] of Object.entries(spec.players ?? {})) {
    byPuuid[puuid] = playerFacts(extras);
  }
  return { byPuuid, bans: spec.bans ?? [] };
}

/* ---------------------------------------------------------------------------
 * Won against the odds (M8.2).
 *
 * Every number here came out of `splits.blue_win_prob` on the night. Nothing in these tests sets
 * a `mu`, and one of them proves that on purpose: change every rating in the fixture and the
 * section comes back the same, which is the property the rejected "biggest rating swing" version
 * could not have had.
 * ------------------------------------------------------------------------- */

/** One custom the balancer gave blue `prob`, won by `winner`. The same ten every time. */
function oddsGame(spec: { id: string; at: string; winner?: 100 | 200; prob?: number | null }) {
  return tenPlayerGame({
    id: spec.id,
    at: spec.at,
    durationS: 1_800,
    winner: spec.winner ?? 100,
    ...(spec.prob === undefined ? {} : { blueWinProb: spec.prob }),
    blue: ['lena:adc', 'iris:top', 'rami:jungle', 'omar:mid', 'theo:support'],
    red: ['yuki:adc', 'nadia:top', 'karim:jungle', 'hana:mid', 'bilal:support'],
  });
}

const FIVE_BLUE = ['Iris', 'Lena', 'Omar', 'Rami', 'Theo'];
const FIVE_RED = ['Bilal', 'Hana', 'Karim', 'Nadia', 'Yuki'];

describe('funFactsView: won against the odds', () => {
  it('puts all five of a 31% winning side on the list and names that game as the record', () => {
    const games = [
      oddsGame({ id: 'odds-1', at: '2026-09-01T20:00:00Z', prob: 0.31 }),
      oddsGame({ id: 'odds-2', at: '2026-09-02T20:00:00Z', prob: 0.4 }),
    ];
    const odds = funFactsView(games, rosterFor(games), 'Africa/Cairo').odds;

    expect(odds.title).toBe(ODDS_TITLE);
    expect(odds.rows.map((row) => row.name).sort()).toEqual(FIVE_BLUE);
    expect(odds.rows.every((row) => row.wins === 2)).toBe(true);
    expect(odds.rows[0]?.valueLabel).toBe('2 wins');
    // Newest first, like every other `See games` list on the page.
    expect(odds.rows[0]?.games.map((win) => win.percent)).toEqual([40, 31]);
    expect(odds.rows[0]?.games[1]?.line).toBe('31% · Won · Tuesday');

    expect(odds.record?.percent).toBe(31);
    expect(odds.record?.line).toBe('Blue won at 31%.');
    expect(odds.record?.players.map((player) => player.name).sort()).toEqual(FIVE_BLUE);
    expect(odds.record?.game.id).toBe('odds-1');
  });

  it('reads the same number from the other end for red: blue at 0.72 is a 28% red win', () => {
    const games = [oddsGame({ id: 'odds-red', at: '2026-09-01T20:00:00Z', winner: 200, prob: 0.72 })];
    const odds = funFactsView(games, rosterFor(games)).odds;

    expect(odds.record?.percent).toBe(28);
    expect(odds.record?.line).toBe('Red won at 28%.');
    expect(odds.record?.players.map((player) => player.name).sort()).toEqual(FIVE_RED);
    // One win is a record and not a list: the list wants two, and says which thin window it is.
    expect(odds.rows).toEqual([]);
    expect(odds.empty).toBe(ODDS_NONE_TWICE);
  });

  it('leaves a backfilled game — no lobby, no split — out of both lists and breaks nothing', () => {
    const games = [
      oddsGame({ id: 'backfilled-1', at: '2026-09-01T20:00:00Z', prob: null }),
      oddsGame({ id: 'backfilled-2', at: '2026-09-02T20:00:00Z' }),
    ];
    const odds = funFactsView(games, rosterFor(games)).odds;

    expect(odds.rows).toEqual([]);
    expect(odds.record).toBeNull();
    expect(odds.empty).toBe(ODDS_EMPTY);
  });

  it('is a strict threshold: 50% and 45% are not against the odds, 44% is', () => {
    const even = [oddsGame({ id: 'even', at: '2026-09-01T20:00:00Z', prob: 0.5 })];
    expect(funFactsView(even, rosterFor(even)).odds.record).toBeNull();

    const onTheLine = [oddsGame({ id: 'line', at: '2026-09-01T20:00:00Z', prob: 0.45 })];
    expect(funFactsView(onTheLine, rosterFor(onTheLine)).odds.record).toBeNull();

    const under = [oddsGame({ id: 'under', at: '2026-09-01T20:00:00Z', prob: 0.44 })];
    expect(funFactsView(under, rosterFor(under)).odds.record?.percent).toBe(44);
  });

  it('counts the winners only — losing from 31% is not a row', () => {
    const games = [oddsGame({ id: 'lost-it', at: '2026-09-01T20:00:00Z', winner: 200, prob: 0.31 })];
    const odds = funFactsView(games, rosterFor(games)).odds;

    // Blue was given 31% and lost; red won at 69% and beat no odds at all.
    expect(odds.record).toBeNull();
    expect(odds.rows).toEqual([]);
  });

  it('ranks on how often first', () => {
    const games = [
      oddsGame({ id: 'r1', at: '2026-09-01T20:00:00Z', prob: 0.4 }),
      oddsGame({ id: 'r2', at: '2026-09-02T20:00:00Z', prob: 0.4 }),
      oddsGame({ id: 'r3', at: '2026-09-03T20:00:00Z', prob: 0.42 }),
      oddsGame({ id: 'r4', at: '2026-09-04T20:00:00Z', winner: 200, prob: 0.8 }),
      oddsGame({ id: 'r5', at: '2026-09-05T20:00:00Z', winner: 200, prob: 0.8 }),
    ];
    const odds = funFactsView(games, rosterFor(games)).odds;

    // Blue's five won three of them, red's five won two, and three beats a longer price.
    expect(odds.rows.slice(0, 5).map((row) => row.name)).toEqual(FIVE_BLUE);
    expect(odds.rows.slice(0, 5).every((row) => row.wins === 3)).toBe(true);
    expect(odds.rows.slice(5).map((row) => row.name)).toEqual(FIVE_RED);
    expect(odds.rows.find((row) => row.name === 'Lena')?.bestPercent).toBe(40);
    expect(odds.rows.find((row) => row.name === 'Yuki')?.bestPercent).toBe(20);
    // Twenty percent is the longest odds anybody beat, and the newest of the two games at it.
    expect(odds.record?.percent).toBe(20);
    expect(odds.record?.game.id).toBe('r5');
  });

  it('breaks a tie in the count on the longest odds beaten', () => {
    const games = [
      oddsGame({ id: 't1', at: '2026-09-01T20:00:00Z', prob: 0.4 }),
      oddsGame({ id: 't2', at: '2026-09-02T20:00:00Z', prob: 0.4 }),
      oddsGame({ id: 't3', at: '2026-09-03T20:00:00Z', winner: 200, prob: 0.8 }),
      oddsGame({ id: 't4', at: '2026-09-04T20:00:00Z', winner: 200, prob: 0.8 }),
    ];
    const odds = funFactsView(games, rosterFor(games)).odds;

    // Everybody has two. Red's came from 20% and blue's from 40%, so red's five are first.
    expect(odds.rows.every((row) => row.wins === 2)).toBe(true);
    expect(odds.rows.slice(0, 5).map((row) => row.name)).toEqual(FIVE_RED);
    expect(odds.rows.slice(5).map((row) => row.name)).toEqual(FIVE_BLUE);
  });

  it('does not move when every rating in the window changes — the point of the section', () => {
    const games = [
      oddsGame({ id: 'reb-1', at: '2026-09-01T20:00:00Z', prob: 0.31 }),
      oddsGame({ id: 'reb-2', at: '2026-09-02T20:00:00Z', prob: 0.4 }),
    ];
    const before = funFactsView(games, rosterFor(games), 'Africa/Cairo').odds;

    // What `rebuild-ratings` does: every `mu` on every row replaced, results untouched.
    const rebuilt = games.map((game) => ({
      ...game,
      rows: game.rows.map((row) => ({ ...row, muBefore: 41, muAfter: 7 })),
    }));
    const after = funFactsView(rebuilt, rosterFor(rebuilt), 'Africa/Cairo').odds;

    expect(after.rows.map((row) => [row.name, row.wins, row.bestPercent])).toEqual(
      before.rows.map((row) => [row.name, row.wins, row.bestPercent]),
    );
    expect(after.record?.line).toBe(before.record?.line);
    expect(after.record?.percent).toBe(before.record?.percent);
  });

  it('counts an unrated custom like any other: it reads results, not ratings', () => {
    const games = [
      tenPlayerGame({
        id: 'unrated',
        at: '2026-09-01T20:00:00Z',
        durationS: 1_800,
        winner: 100,
        unrated: true,
        blueWinProb: 0.33,
        blue: ['lena:adc'],
      }),
    ];
    const odds = funFactsView(games, rosterFor(games)).odds;

    expect(odds.record?.percent).toBe(33);
    expect(odds.record?.players).toHaveLength(5);
  });

  it('roasts its own title in 3ameya', () => {
    expect(funRoast(ODDS_TITLE)).toBe('كسبوا وهما خسرانين');
  });
});
