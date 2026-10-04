import { describe, expect, it } from 'vitest';
import { formatDelta, renderName } from '../discord/embeds';
import { rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { awardBlocks, awardPeriod, awardsView } from './awards';
import { countedGames } from './fold';
import type { AwardBlock, StatsGame } from './types';

/**
 * The two awards a closed window hands out (M5.4; `Most improved` retired by M14.57), against a
 * hand-built week.
 *
 * Acceptance 7 and 8: the closed windows show both with product's copy, the running ones
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

function blocksOf(): AwardBlock[] {
  const games = week();
  return awardBlocks(games, rosterFor(games, ['omar:top']), 'week');
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
    expect(awardsView('all-time', games, players)).toBeNull();

    const closed = awardsView('last-week', games, players);
    expect(closed?.kind).toBe('closed');
    expect(closed).toMatchObject({ intro: 'Two awards for the week. Nobody votes; the numbers pick.' });
  });

  it('names the period and whether it has closed, and gives all time neither', () => {
    expect(awardPeriod('this-week')).toEqual({ period: 'week', closed: false });
    expect(awardPeriod('last-week')).toEqual({ period: 'week', closed: true });
    expect(awardPeriod('all-time')).toBeNull();
  });
});

describe('the two awards of a closed week', () => {
  /** M14.57: `Most improved` is retired (decision row 2026-10-04); the week board is its answer. */
  it('are product s two labels, in product s order, with their rule lines', () => {
    const blocks = blocksOf();

    expect(blocks.map((block) => block.label)).toEqual(['Best off-role', 'Cursed duo']);
    expect(blocks.map((block) => block.rule)).toEqual([
      'Best record away from their main role, over at least 4 of those games.',
      'The pair with the worst record on the same team, over at least 4 games together.',
    ]);
  });

  it('gives best off-role the best record away from a main, and names the main', () => {
    const offRole = blocksOf()[0];

    expect(offRole?.won).toBe(true);
    expect(offRole?.lines.map((line) => line.text)).toEqual(['Omar · 9W 3L · 75% · their main is top']);
    // Everybody else in this week is flexible, so the line under it is true and prints.
    expect(offRole?.note).toBe('Players with no main role are not in this one — every role is theirs.');
  });

  it('gives the cursed duo to the worst pair on the same team', () => {
    const cursed = blocksOf()[1];

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

    expect(awardBlocks(games, players, 'week')[0]?.note).toBeNull();
  });
});

describe('the minimums, and what they say when nobody clears them', () => {
  it('says nobody spent games off their main, and nobody played together', () => {
    // A window where nobody has a main and no pair reaches four games together.
    const games = countedGames([
      tenPlayerGame({ at: '2026-09-01T10:00:00Z', blue: ['yuki'], red: [] }),
      tenPlayerGame({ at: '2026-09-01T11:00:00Z', blue: ['theo'], red: [] }),
    ]);
    const blocks = awardBlocks(games, rosterFor(games), 'week');

    expect(blocks[0]?.lines.map((line) => line.text)).toEqual([
      'Nobody spent 4 games off their main. That is the balancer doing its job.',
    ]);
    // A line about nobody is keyed on that, not on words that move with the minimum.
    expect(blocks[0]?.lines.map((line) => line.key)).toEqual(['nobody']);
    expect(blocks[1]?.lines.map((line) => line.text)).toEqual(['No pair played 4 games together this week.']);
    expect(blocks.every((block) => block.won)).toBe(false);
  });

  /** The duo award's own bar: four together in a week. */
  it('flips the cursed duo at four in a week', () => {
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
    expect(awardBlocks(three, rosterFor(three), 'week')[1]?.won).toBe(false);
    const four = together(4);
    expect(awardBlocks(four, rosterFor(four), 'week')[1]?.won).toBe(true);
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

    const cursed = awardBlocks(games, rosterFor(games), 'week')[1];

    expect(cursed?.won).toBe(true);
    expect(cursed?.lines.map((line) => line.text)).toEqual([
      'Iris and Omar · 1W 3L · 25%',
      'Theo and Yuki · 1W 3L · 25%',
    ]);
    // Keyed on the two people, so two lines that read alike are still two rows.
    expect(cursed?.lines.map((line) => line.key)).toEqual(['u-iris|u-omar', 'u-theo|u-yuki']);
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
      Array.from({ length: 4 }, (_, index) =>
        statsGame({
          at: `2026-09-01T1${index}:00:00Z`,
          // Fresh spares every game, so only the named pair reaches four games together.
          blue: ['na_dia', 'theo', ...Array.from({ length: 3 }, (_, seat) => `s${index}x${seat}`)],
          red: Array.from({ length: 5 }, (_, seat) => `s${index}x${seat + 3}`),
          winner: 200,
        }),
      ),
    );
    const players = rosterFor(games);

    expect(awardBlocks(games, players, 'week')[1]?.lines.map((line) => line.text)).toEqual([
      'Na_dia and Theo · 0W 4L · 0%',
    ]);
    // The same words, with the underscore escaped so a name cannot italicise the message.
    expect(
      awardBlocks(games, players, 'week', { name: renderName, delta: formatDelta })[1]?.lines.map(
        (line) => line.text,
      ),
    ).toEqual(['Na\\_dia and Theo · 0W 4L · 0%']);
  });
});

/** `All time` has no awards block; the month windows went with M14.48. */
describe('all time', () => {
  it('has no block', () => {
    const games = week();
    expect(awardsView('all-time', games, rosterFor(games, ['omar:top']))).toBeNull();
  });
});
