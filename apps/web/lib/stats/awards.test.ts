import { type Rating, seedFromRank } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { formatDelta, renderName } from '../discord/embeds';
import { playerIdOf, rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { awardBlocks, awardPeriod, awardsView, climbs, type WeeklySeeds, weeklyClimbs } from './awards';
import { countedGames } from './fold';
import type { AwardBlock, StatsGame, StatsPlayer } from './types';

/**
 * The three awards a closed window hands out (M5.4), against a hand-built week.
 *
 * Acceptance 7 and 8: the closed windows show all three with product's copy, the running ones
 * show one line, `All time` shows nothing at all, and every minimum flips exactly where the
 * table says it does.
 */

/**
 * A week in which:
 *
 * - **Nadia** plays six games and climbs `1266 → 1478` (`mu` 21.1 to 24.6333, the numbers the
 *   pages would have printed);
 * - **Omar**, whose main is top, plays twelve games on mid and wins nine of them;
 * - **Yuki and Theo** play fourteen games on the same side and win three.
 *
 * The eight filler seats rotate enough that no other pair reaches both a lower rate and the
 * award's minimum, which is what makes the cursed duo a single line rather than a tie.
 */
function week(): StatsGame[] {
  const games: StatsGame[] = [];

  for (let index = 0; index < 12; index += 1) {
    const nadia =
      index === 0
        ? { key: 'nadia', mu: [21.1, 21.5] as [number, number] }
        : index === 5
          ? { key: 'nadia', mu: [24.4, 24.6333333] as [number, number] }
          : { key: 'nadia' };
    games.push(
      statsGame({
        at: `2026-09-0${1 + Math.floor(index / 6)}T${String(10 + (index % 6)).padStart(2, '0')}:00:00Z`,
        // Nadia holds the third blue seat for six games; two spares split the rest three
        // and three, so neither reaches four games beside the pair.
        blue: ['yuki', 'theo', index < 6 ? nadia : index < 9 ? 'f3' : 'f8', 'f1', 'f2'],
        red: ['omar:mid', 'f4', 'f5', 'f6', 'f7'],
        // Blue take the first three; red take the other nine, which is Omar's 9W 3L.
        winner: index < 3 ? 100 : 200,
      }),
    );
  }

  // Two more with the pair on the other side, losing both: it is what makes them the worst
  // qualifying pair rather than one of five pairs tied on blue's record.
  for (let index = 0; index < 2; index += 1) {
    games.push(
      statsGame({
        at: `2026-09-03T1${index}:00:00Z`,
        blue: ['f1', 'f2', 'f3', 'f8', 'f9'],
        red: ['yuki', 'theo', 'f4', 'f5', 'f6'],
        winner: 100,
      }),
    );
  }

  return countedGames(games);
}

function blocksOf(kind: 'last-week' | 'last-month'): AwardBlock[] {
  const games = week();
  return awardBlocks(games, rosterFor(games, ['omar:top']), kind === 'last-week' ? 'week' : 'month');
}

describe('which windows have awards at all', () => {
  /** Acceptance 7: a running window is one line; `All time` has no block at all. */
  it('is the closed ones, and a sentence on the running ones', () => {
    const games = week();
    const players = rosterFor(games, ['omar:top']);

    expect(awardsView('this-week', games, players)).toEqual({
      kind: 'running',
      line: 'Awards are handed out when the week ends.',
    });
    expect(awardsView('this-month', games, players)).toEqual({
      kind: 'running',
      line: 'Awards are handed out when the month ends.',
    });
    expect(awardsView('all-time', games, players)).toBeNull();

    const closed = awardsView('last-week', games, players);
    expect(closed?.kind).toBe('closed');
    expect(closed).toMatchObject({ intro: 'Three awards for the week. Nobody votes; the numbers pick.' });
    expect(awardsView('last-month', games, players)).toMatchObject({
      intro: 'Three awards for the month. Nobody votes; the numbers pick.',
    });
  });

  it('names the period and whether it has closed, and gives all time neither', () => {
    expect(awardPeriod('this-week')).toEqual({ period: 'week', closed: false });
    expect(awardPeriod('last-week')).toEqual({ period: 'week', closed: true });
    expect(awardPeriod('this-month')).toEqual({ period: 'month', closed: false });
    expect(awardPeriod('last-month')).toEqual({ period: 'month', closed: true });
    expect(awardPeriod('all-time')).toBeNull();
  });
});

describe('the three awards of a closed week', () => {
  it('are product s three labels, in product s order, with their rule lines', () => {
    const blocks = blocksOf('last-week');

    expect(blocks.map((block) => block.label)).toEqual(['Most improved', 'Best off-role', 'Cursed duo']);
    expect(blocks.map((block) => block.rule)).toEqual([
      'Biggest climb in Rating from a first game to a last one, over at least 6 games.',
      'Best record away from their main role, over at least 4 of those games.',
      'The pair with the worst record on the same team, over at least 4 games together.',
    ]);
  });

  /**
   * The climb is the subtraction of two numbers the pages printed — `round(mu × 60)` of the
   * last game's `mu_after` minus the first game's `mu_before` — not `round((after - before) × 60)`.
   */
  it('gives most improved to the biggest climb, in the numbers the pages printed', () => {
    const [improved] = blocksOf('last-week');

    expect(improved?.won).toBe(true);
    expect(improved?.lines.map((line) => line.text)).toEqual(['Nadia · +212 · 1266 → 1478']);
  });

  it('gives best off-role the best record away from a main, and names the main', () => {
    const offRole = blocksOf('last-week')[1];

    expect(offRole?.won).toBe(true);
    expect(offRole?.lines.map((line) => line.text)).toEqual(['Omar · 9W 3L · 75% · their main is top']);
    // Everybody else in this week is flexible, so the line under it is true and prints.
    expect(offRole?.note).toBe('Players with no main role are not in this one — every role is theirs.');
  });

  it('gives the cursed duo to the worst pair on the same team', () => {
    const cursed = blocksOf('last-week')[2];

    // Three wins in fourteen games together: `round(3 / 14 * 100)`.
    expect(cursed?.won).toBe(true);
    expect(cursed?.lines.map((line) => line.text)).toEqual(['Theo and Yuki · 3W 11L · 21%']);
  });

  it('drops the flexible note when everybody in the window has a main', () => {
    const games = week();
    const players = rosterFor(games, [
      'omar:top',
      'yuki:adc',
      'theo:support',
      'nadia:mid',
      'f1:top',
      'f2:jungle',
      'f3:mid',
      'f4:adc',
      'f5:support',
      'f6:top',
      'f7:jungle',
      'f8:mid',
      'f9:adc',
    ]);

    expect(awardBlocks(games, players, 'week')[1]?.note).toBeNull();
  });
});

describe('the minimums, and what they say when nobody clears them', () => {
  /** A week of six games each is a month of nothing: the month's bar is 15, 10 and 8. */
  it('prints product s sentence for each award nobody won', () => {
    const blocks = blocksOf('last-month');

    expect(blocks.map((block) => block.won)).toEqual([false, true, true]);
    expect(blocks[0]?.lines.map((line) => line.text)).toEqual(['Nobody played 15 games this month.']);
    // A line about nobody is keyed on that, not on words that move with the minimum.
    expect(blocks[0]?.lines.map((line) => line.key)).toEqual(['nobody']);
  });

  it('says nobody spent games off their main, and nobody played together', () => {
    // A window where nobody has a main and no pair reaches four games together.
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T10:00:00Z', blue: ['yuki'], red: [] }),
      tenPlayerGame({ at: '2026-09-01T11:00:00Z', blue: ['theo'], red: [] }),
    ]);
    const blocks = awardBlocks(games, rosterFor(games), 'week');

    expect(blocks[1]?.lines.map((line) => line.text)).toEqual([
      'Nobody spent 4 games off their main. That is the balancer doing its job.',
    ]);
    expect(blocks[2]?.lines.map((line) => line.text)).toEqual(['No pair played 4 games together this week.']);
    expect(blocks.every((block) => block.won)).toBe(false);
  });

  /**
   * Acceptance 8, the flip: fourteen games and a huge climb wins nothing in a month and
   * fifteen wins it; in a week the same fixture flips at five and six.
   */
  it('flips most improved at exactly the window s number of games', () => {
    const climber = (count: number) =>
      countedGames(
        Array.from({ length: count }, (_, index) =>
          tenPlayerGame({
            at: `2026-09-0${1 + Math.floor(index / 8)}T${String(10 + (index % 8)).padStart(2, '0')}:00:00Z`,
            blue: [
              {
                key: 'nadia',
                mu: index === 0 ? [21.1, 21.5] : index === count - 1 ? [24.4, 24.6333333] : undefined,
              },
            ],
            red: [],
          }),
        ),
      );

    const fourteen = climber(14);
    expect(awardBlocks(fourteen, rosterFor(fourteen), 'month')[0]?.won).toBe(false);
    const fifteen = climber(15);
    expect(awardBlocks(fifteen, rosterFor(fifteen), 'month')[0]?.lines.map((line) => line.text)).toEqual([
      'Nadia · +212 · 1266 → 1478',
    ]);

    const five = climber(5);
    expect(awardBlocks(five, rosterFor(five), 'week')[0]?.won).toBe(false);
    const six = climber(6);
    expect(awardBlocks(six, rosterFor(six), 'week')[0]?.won).toBe(true);
  });

  /** The duo award's own bar: four together in a week, eight in a month. */
  it('flips the cursed duo at four in a week and eight in a month', () => {
    const together = (count: number) =>
      countedGames(
        Array.from({ length: count }, (_, index) =>
          tenPlayerGame({
            at: `2026-09-0${1 + Math.floor(index / 8)}T${String(10 + (index % 8)).padStart(2, '0')}:00:00Z`,
            blue: ['yuki', 'theo'],
            red: [],
            winner: 200,
          }),
        ),
      );

    const three = together(3);
    expect(awardBlocks(three, rosterFor(three), 'week')[2]?.won).toBe(false);
    const four = together(4);
    expect(awardBlocks(four, rosterFor(four), 'week')[2]?.won).toBe(true);

    const seven = together(7);
    expect(awardBlocks(seven, rosterFor(seven), 'month')[2]?.won).toBe(false);
    const eight = together(8);
    expect(awardBlocks(eight, rosterFor(eight), 'month')[2]?.won).toBe(true);
  });

  /**
   * The cursed duo's own tie (acceptance 8): two pairs on the same record over the same number
   * of games together are **both named**, one line each, keyed on the pair and not on the words.
   */
  it('names both pairs of a tied cursed duo', () => {
    // Two pairs, four games each, both 1W 3L: {yuki, theo} on blue and {iris, omar} on red, in
    // four games they do not share, so no third pair reaches the week's minimum with them.
    // Eight seats nobody else fills twice: only the two named pairs reach four games together,
    // so the tie is between them and not between them and half the filler bench.
    const spares = (game: number) => Array.from({ length: 8 }, (_, seat) => `s${game}x${seat}`);
    const games = countedGames([
      ...Array.from({ length: 4 }, (_, index) =>
        statsGame({
          at: `2026-09-01T1${index}:00:00Z`,
          blue: ['yuki', 'theo', ...spares(index).slice(0, 3)],
          red: spares(index).slice(3, 8),
          winner: index === 0 ? 100 : 200,
        }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        statsGame({
          at: `2026-09-02T1${index}:00:00Z`,
          blue: spares(index + 4).slice(3, 8),
          red: ['iris', 'omar', ...spares(index + 4).slice(0, 3)],
          winner: index === 0 ? 200 : 100,
        }),
      ),
    ]);

    const cursed = awardBlocks(games, rosterFor(games), 'week')[2];

    expect(cursed?.won).toBe(true);
    expect(cursed?.lines.map((line) => line.text)).toEqual([
      'Iris and Omar · 1W 3L · 25%',
      'Theo and Yuki · 1W 3L · 25%',
    ]);
    // Keyed on the two people, so two lines that read alike are still two rows.
    expect(cursed?.lines.map((line) => line.key)).toEqual(['u-iris|u-omar', 'u-theo|u-yuki']);
  });

  /** Tied on climb and on games: **both are named**, and neither is picked by a coin toss. */
  it('names both winners of a tied climb', () => {
    const games = countedGames(
      Array.from({ length: 6 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T1${index}:00:00Z`,
          blue: [
            { key: 'nadia', mu: index === 0 ? [21.1, 21.5] : index === 5 ? [24.4, 24.6333333] : undefined },
            { key: 'omar', mu: index === 0 ? [21.1, 21.5] : index === 5 ? [24.4, 24.6333333] : undefined },
          ],
          red: [],
        }),
      ),
    );

    const improved = awardBlocks(games, rosterFor(games), 'week')[0];
    expect(improved?.lines.map((line) => line.text)).toEqual([
      'Nadia · +212 · 1266 → 1478',
      'Omar · +212 · 1266 → 1478',
    ]);
    expect(improved?.lines.map((line) => line.key)).toEqual(['u-nadia', 'u-omar']);
  });

  /** More games breaks a tie on the climb before anybody is named twice. */
  it('gives a tied climb to whoever played more', () => {
    const games = countedGames([
      ...Array.from({ length: 6 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T1${index}:00:00Z`,
          blue: [
            { key: 'nadia', mu: index === 0 ? [21.1, 21.5] : index === 5 ? [24.4, 24.6333333] : undefined },
            { key: 'omar', mu: index === 0 ? [21.1, 21.5] : index === 5 ? [24.4, 24.6333333] : undefined },
          ],
          red: [],
        }),
      ),
      tenPlayerGame({
        at: '2026-09-02T10:00:00Z',
        blue: [{ key: 'omar', mu: [24.6333333, 24.6333333] }],
        red: [],
      }),
    ]);

    expect(awardBlocks(games, rosterFor(games), 'week')[0]?.lines.map((line) => line.text)).toEqual([
      'Omar · +212 · 1266 → 1478',
    ]);
  });
});

describe('the two renderings of one award', () => {
  /**
   * The page and the Sunday Discord post print the **same line** with two glyph sets: the web
   * gets U+2212 and `05-design.md`'s truncation, Discord gets an ASCII minus and its markdown
   * escaped (a name with a `_` in it must not italicise half the channel).
   */
  it('is the same words, in the surface s own glyphs', () => {
    const games = countedGames(
      Array.from({ length: 6 }, (_, index) =>
        tenPlayerGame({
          at: `2026-09-01T1${index}:00:00Z`,
          blue: [
            {
              key: 'na_dia',
              mu: index === 0 ? [21.1, 21.5] : index === 5 ? [24.4, 24.6333333] : undefined,
            },
          ],
          red: [],
        }),
      ),
    );
    const players = rosterFor(games);

    expect(awardBlocks(games, players, 'week')[0]?.lines.map((line) => line.text)).toEqual([
      'Na_dia · +212 · 1266 → 1478',
    ]);
    // The same words, with the underscore escaped so a name cannot italicise the message.
    expect(
      awardBlocks(games, players, 'week', { name: renderName, delta: formatDelta })[0]?.lines.map(
        (line) => line.text,
      ),
    ).toEqual(['Na\\_dia · +212 · 1266 → 1478']);
  });
});

/* ---------------------------------------------------------------------------
 * The week's climb (M7.4).
 * ------------------------------------------------------------------------- */

/**
 * A week of two people's nights, each with eight strangers (M7.4).
 *
 * **Bruno** (Bronze II) plays seven games with four seat-fillers against five more, and wins six
 * of them. **Lena** (Master) does exactly the same on seven other nights: 6W 1L, four teammates,
 * five opponents, all of them Gold IV. Nobody plays twice, so each of the fourteen games is that
 * person's week and nothing else — which is what makes the two records identical and the two
 * climbs not.
 *
 * The stored `mu` columns are the fixture's default on every row, so the **all-time** track says
 * both of them moved nothing at all. That is the point: this week is unreadable on the stored
 * track and is exactly the week the weekly one was built for.
 */
function twoWeeks(): StatsGame[] {
  const games: StatsGame[] = [];
  const spare = (game: number, seat: number) => `s${game}x${seat}`;

  const nightsFor = (key: string, offset: number): void => {
    for (let index = 0; index < 7; index += 1) {
      const game = offset + index;
      games.push(
        statsGame({
          at: `2026-09-0${1 + Math.floor(game / 8)}T${String(10 + (game % 8)).padStart(2, '0')}:00:00Z`,
          lcuGameId: String(100 + game),
          blue: [key, ...Array.from({ length: 4 }, (_, seat) => spare(game, seat))],
          red: Array.from({ length: 5 }, (_, seat) => spare(game, seat + 4)),
          // Six wins and the last one lost, for both of them.
          winner: index === 6 ? 200 : 100,
        }),
      );
    }
  };

  nightsFor('bruno', 0);
  nightsFor('lena', 7);
  return countedGames(games);
}

/** Bronze, Master, and Gold IV for the fourteen nights' worth of strangers. */
function twoWeekSeeds(players: readonly StatsPlayer[]): WeeklySeeds {
  const ranks: Record<string, Rating> = {
    [playerIdOf('bruno')]: seedFromRank('BRONZE', 'II'),
    [playerIdOf('lena')]: seedFromRank('MASTER', null),
  };
  return new Map(
    players.map((player) => [player.playerId, ranks[player.playerId] ?? seedFromRank('GOLD', 'IV')]),
  );
}

describe('most improved, on a week', () => {
  /**
   * **Acceptance 1**: a Bronze who went 6W 1L and a Master who went 6W 1L, and the Bronze is most
   * improved. Same record, same number of games, and the person who beat their rank hardest wins
   * — which is the whole of what the award was asked to mean.
   */
  it('gives the week to whoever beat their rank hardest, not to the better player', () => {
    const games = twoWeeks();
    const players = rosterFor(games);
    const improved = awardBlocks(games, players, 'week', undefined, twoWeekSeeds(players))[0];

    expect(improved?.won).toBe(true);
    expect(improved?.lines.map((line) => line.key)).toEqual(['u-bruno']);
    expect(improved?.lines[0]?.text).toMatch(/^Bruno · \+\d+ · 1110 → \d+$/);

    // Both ends are the weekly track's: the Bronze starts at their own seed (`round(18.5 × 60)`)
    // and the Master at theirs, and the Master's climb is the smaller of the two.
    const climbed = weeklyClimbs(games, players, twoWeekSeeds(players));
    const bruno = climbed.find((climb) => climb.puuid === 'u-bruno');
    const lena = climbed.find((climb) => climb.puuid === 'u-lena');
    expect(bruno).toMatchObject({ games: 7, from: 1110 });
    expect(lena).toMatchObject({ games: 7, from: 2100 });
    expect((bruno?.delta ?? 0) > (lena?.delta ?? 0)).toBe(true);
  });

  /**
   * And the same week on the **stored** track is the week product described as unreadable: the
   * all-time numbers these six nights moved are the forty games of history behind them, which
   * here is no movement at all and a tie between everybody who turned up.
   */
  it('is a different answer from the all-time climb over the same games', () => {
    const games = twoWeeks();
    const players = rosterFor(games);

    expect(climbs(games, players).filter((climb) => climb.delta !== 0)).toEqual([]);
    expect(awardBlocks(games, players, 'week')[0]?.lines.map((line) => line.key)).not.toEqual(['u-bruno']);
  });

  /**
   * **Acceptance 3**: the minimum, its sentence and its rule line are the ones M5.4 shipped. Six
   * games in a week, whichever track measures the climb.
   */
  it('keeps the week s minimum, its rule line and its nobody sentence', () => {
    const games = twoWeeks();
    const players = rosterFor(games);
    const seeds = twoWeekSeeds(players);
    const [improved] = awardBlocks(games, players, 'week', undefined, seeds);

    expect(improved?.rule).toBe(
      'Biggest climb in Rating from a first game to a last one, over at least 6 games.',
    );

    // Five of Bruno's nights: nobody reaches six, and the sentence is the one the page prints.
    const five = countedGames(games.slice(0, 5));
    const shortRoster = rosterFor(five);
    const short = awardBlocks(five, shortRoster, 'week', undefined, twoWeekSeeds(shortRoster))[0];
    expect(short?.won).toBe(false);
    expect(short?.lines).toEqual([{ key: 'nobody', text: 'Nobody played 6 games this week.' }]);
  });

  /**
   * A week whose games the fold never rated — a backfill the rebuild has not folded — moves
   * nobody's weekly rating, so nobody has a climb and nobody wins. The games still count toward
   * the minimum, exactly as they do on the all-time track.
   */
  it('names nobody when the week has no rated game in it', () => {
    const games = countedGames(
      Array.from({ length: 6 }, (_, index) =>
        tenPlayerGame({ at: `2026-09-01T1${index}:00:00Z`, blue: ['nadia'], red: [], unrated: true }),
      ),
    );
    const players = rosterFor(games);
    const seeds: WeeklySeeds = new Map(
      players.map((player) => [player.playerId, seedFromRank('GOLD', 'IV')]),
    );

    expect(weeklyClimbs(games, players, seeds)).toEqual([]);
    expect(awardBlocks(games, players, 'week', undefined, seeds)[0]?.won).toBe(false);
  });

  /**
   * **Acceptance 2, the other two awards**: `Best off-role` and `cursed duo` read games and roles
   * and never a rating, so a week that hands over seeds and a week that does not print the same
   * two blocks, byte for byte.
   */
  it('changes nothing about best off-role or cursed duo', () => {
    const games = week();
    const players = rosterFor(games, ['omar:top']);
    const seeds: WeeklySeeds = new Map(
      players.map((player) => [player.playerId, seedFromRank('GOLD', 'IV')]),
    );

    expect(awardBlocks(games, players, 'week', undefined, seeds).slice(1)).toEqual(
      awardBlocks(games, players, 'week').slice(1),
    );
  });
});

/**
 * **Acceptance 2**: the month windows and `All time` are what they were. The month keeps the
 * all-time climb for ever (product, 2026-09-15), so seeds handed to a month window are read by
 * nothing and the three blocks are byte-identical with them and without.
 */
describe('a month, and all time', () => {
  it('is the stored climb whether or not the caller read the week s seeds', () => {
    const games = week();
    const players = rosterFor(games, ['omar:top']);
    const seeds: WeeklySeeds = new Map(
      players.map((player) => [player.playerId, seedFromRank('BRONZE', 'II')]),
    );

    expect(awardBlocks(games, players, 'month', undefined, seeds)).toEqual(
      awardBlocks(games, players, 'month'),
    );
    expect(awardsView('last-month', games, players, undefined, seeds)).toEqual(
      awardsView('last-month', games, players),
    );
    expect(awardsView('all-time', games, players, undefined, seeds)).toBeNull();
    expect(awardsView('this-month', games, players, undefined, seeds)).toEqual({
      kind: 'running',
      line: 'Awards are handed out when the month ends.',
    });
  });

  /** The same fixture the month reads: a big climb over fourteen games is still 15 games short. */
  it('keeps the month s own numbers', () => {
    const blocks = blocksOf('last-month');

    expect(blocks[0]?.rule).toBe(
      'Biggest climb in Rating from a first game to a last one, over at least 15 games.',
    );
    expect(blocks[0]?.lines.map((line) => line.text)).toEqual(['Nobody played 15 games this month.']);
  });
});

describe('a climb', () => {
  /**
   * A counted game with no stored rating — a backfilled game the rebuild has not folded — still
   * counts toward the minimum, and the climb is measured between the games that do carry one.
   */
  it('is measured between the rated games and counts the unrated ones', () => {
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T10:00:00Z', blue: ['nadia'], red: [], unrated: true }),
      tenPlayerGame({ at: '2026-09-01T11:00:00Z', blue: [{ key: 'nadia', mu: [21.1, 21.5] }], red: [] }),
      tenPlayerGame({
        at: '2026-09-01T12:00:00Z',
        blue: [{ key: 'nadia', mu: [24.4, 24.6333333] }],
        red: [],
      }),
      tenPlayerGame({ at: '2026-09-01T13:00:00Z', blue: ['nadia'], red: [], unrated: true }),
    ]);
    const nadia = climbs(games, rosterFor(games)).find((climb) => climb.puuid === 'u-nadia');

    expect(nadia).toMatchObject({ games: 4, from: 1266, to: 1478, delta: 212 });
  });

  it('is nobody at all when the window has no rated game in it', () => {
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T10:00:00Z', blue: ['nadia'], red: [], unrated: true }),
    ]);

    expect(climbs(games, rosterFor(games))).toEqual([]);
  });
});
