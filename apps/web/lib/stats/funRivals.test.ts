import type { SideValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import { rosterFor, statsGame } from '../testing/statsFixtures';
import { MIN_DUO_GAMES, NO_DUOS } from './copy';
import { duoRecords } from './fold';
import { funFactsView } from './fun';
import {
  BEST_DUO_TITLE,
  duoRecordLine,
  NEMESIS_TITLE,
  NO_NEMESIS,
  nemesisLine,
  ofGamesLine,
} from './funCopy';
import type { StatsGame } from './types';

/**
 * Friends and enemies on `/fun` (M8.1): the nemesis fold, and the fact that best duo is
 * `duoRecords` and not a second answer to the same question.
 *
 * Every game below names **fresh spare seats** (`d3b1`), so the only pairs that ever reach
 * {@link MIN_DUO_GAMES} are the ones the test is about. A fixture that reused ten filler names
 * would give every filler a nemesis and hide the row under test behind them.
 */

interface Duel {
  /** The person on blue beside Lena's opponent. Always `lena` here. */
  foe: string;
  winner: SideValue;
}

let spare = 0;

function seats(count: number): string[] {
  return Array.from({ length: count }, () => {
    spare += 1;
    return `x${spare}`;
  });
}

/** One custom: Lena on blue, `foe` on red, eight seats nobody else ever shares. */
function duel(index: number, spec: Duel): StatsGame {
  return statsGame({
    id: `duel-${index}`,
    at: `2026-09-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
    durationS: 1_800,
    winner: spec.winner,
    blue: ['lena', ...seats(4)],
    red: [spec.foe, ...seats(4)],
  });
}

function duels(specs: readonly Duel[]): StatsGame[] {
  return specs.map((spec, index) => duel(index, spec));
}

/** Lena beat Yuki six of ten; Nadia beat Lena six of seven. */
function rivalry(): StatsGame[] {
  return duels([
    ...Array.from({ length: 6 }, () => ({ foe: 'yuki', winner: 100 as SideValue })),
    ...Array.from({ length: 4 }, () => ({ foe: 'yuki', winner: 200 as SideValue })),
    ...Array.from({ length: 6 }, () => ({ foe: 'nadia', winner: 200 as SideValue })),
    { foe: 'nadia', winner: 100 as SideValue },
  ]);
}

function rivalsOf(games: readonly StatsGame[]) {
  return funFactsView(games, rosterFor(games)).rivals;
}

describe('nemesis', () => {
  it('is asymmetric: beating someone six of ten makes them their nemesis, not the other way', () => {
    const games = rivalry();
    const rows = rivalsOf(games).nemesis.rows;

    const yuki = rows.find((row) => row.player.puuid === 'u-yuki');
    expect(yuki?.rival.name).toBe('Lena');
    expect(yuki?.losses).toBe(6);
    expect(yuki?.games).toBe(10);
    expect(yuki?.countLabel).toBe(ofGamesLine(6, 10));
    expect(yuki?.valueLabel).toBe(nemesisLine('Lena', 6, 10));

    // Lena met Yuki ten times and lost four of them — and still is not Yuki's mirror image,
    // because Nadia has beaten her more often. That is the whole point of the word.
    const lena = rows.find((row) => row.player.puuid === 'u-lena');
    expect(lena?.rival.name).toBe('Nadia');
    expect(lena?.valueLabel).toBe(nemesisLine('Nadia', 6, 7));
  });

  it('never names somebody met fewer than the minimum times', () => {
    const games = duels(Array.from({ length: MIN_DUO_GAMES - 1 }, () => ({ foe: 'yuki', winner: 100 })));
    const rows = rivalsOf(games).nemesis.rows;
    expect(rows).toEqual([]);
    expect(rivalsOf(games).nemesis.empty).toBe(NO_NEMESIS);
  });

  it('counts the one game that reaches the minimum', () => {
    const games = duels(Array.from({ length: MIN_DUO_GAMES }, () => ({ foe: 'yuki', winner: 100 })));
    const rows = rivalsOf(games).nemesis.rows;
    // Yuki lost all five to Lena; Lena lost none, so Lena has no nemesis at all.
    expect(rows.map((row) => [row.player.name, row.valueLabel])).toEqual([
      ['Yuki', nemesisLine('Lena', 5, 5)],
    ]);
  });

  it('never names a nemesis out of a perfect record', () => {
    const games = duels(Array.from({ length: 8 }, () => ({ foe: 'yuki', winner: 100 })));
    expect(rivalsOf(games).nemesis.rows.map((row) => row.player.name)).toEqual(['Yuki']);
  });

  it('breaks a tie at the top of one list on the name', () => {
    // Alya and Zein have each beaten Lena five of seven. Deterministic, and it is the name.
    const games = duels([
      ...Array.from({ length: 5 }, () => ({ foe: 'alya', winner: 200 as SideValue })),
      ...Array.from({ length: 2 }, () => ({ foe: 'alya', winner: 100 as SideValue })),
      ...Array.from({ length: 5 }, () => ({ foe: 'zein', winner: 200 as SideValue })),
      ...Array.from({ length: 2 }, () => ({ foe: 'zein', winner: 100 as SideValue })),
    ]);
    const lena = rivalsOf(games).nemesis.rows.find((row) => row.player.puuid === 'u-lena');
    expect(lena?.rival.name).toBe('Alya');
    expect(lena?.valueLabel).toBe(nemesisLine('Alya', 5, 7));
  });

  it('opens every custom the pair met in, newest first, won or lost', () => {
    const games = rivalry();
    const yuki = rivalsOf(games).nemesis.rows.find((row) => row.player.puuid === 'u-yuki');
    // The denominator, not the numerator: all ten meetings are behind the row.
    expect(yuki?.openings).toHaveLength(10);
    expect(yuki?.openings.map((opening) => opening.label)).toEqual([
      ...Array.from({ length: 4 }, () => 'Won'),
      ...Array.from({ length: 6 }, () => 'Lost'),
    ]);
    const days = yuki?.openings.map((opening) => opening.game.startedAt) ?? [];
    expect([...days].sort().reverse()).toEqual(days);
  });

  it('ranks the list by losses, then by the worse record', () => {
    const games = [
      ...duels([
        ...Array.from({ length: 7 }, () => ({ foe: 'yuki', winner: 100 as SideValue })),
        ...Array.from({ length: 2 }, () => ({ foe: 'yuki', winner: 200 as SideValue })),
      ]),
      // A second rivalry, fewer losses: Karim lost five of five to Bilal.
      ...Array.from({ length: 5 }, (_, index) =>
        statsGame({
          id: `other-${index}`,
          at: `2026-09-2${index}T20:00:00Z`,
          durationS: 1_800,
          winner: 100,
          blue: ['bilal', ...seats(4)],
          red: ['karim', ...seats(4)],
        }),
      ),
    ];
    const rows = rivalsOf(games).nemesis.rows;
    expect(rows.map((row) => [row.player.name, row.losses])).toEqual([
      ['Yuki', 7],
      ['Karim', 5],
      ['Lena', 2],
    ]);
  });
});

describe('best duo', () => {
  /** Lena and Theo on blue every night; the reds are strangers every night. */
  function together(wins: number, losses: number): StatsGame[] {
    return Array.from({ length: wins + losses }, (_, index) =>
      statsGame({
        id: `duo-${index}`,
        at: `2026-09-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
        durationS: 1_800,
        winner: index < wins ? 100 : 200,
        blue: ['lena', 'theo', ...seats(3)],
        red: seats(5),
      }),
    );
  }

  it('is the same call `/p/[puuid]` and the cursed-duo award make', () => {
    const games = together(8, 2);
    const players = rosterFor(games);
    const top = duoRecords(games, players)[0];
    const row = rivalsOf(games).duos.rows[0];

    expect(row?.players).toEqual(top?.players);
    expect([row?.games, row?.wins, row?.losses, row?.winRate]).toEqual([
      top?.games,
      top?.wins,
      top?.losses,
      top?.winRate,
    ]);
    expect(row?.valueLabel).toBe(duoRecordLine(8, 2, 80));
    expect(row?.pairLabel).toBe('Lena and Theo');
  });

  it('opens the customs the pair shared a side in, newest first', () => {
    const games = together(8, 2);
    const row = rivalsOf(games).duos.rows[0];
    expect(row?.openings).toHaveLength(10);
    expect(row?.openings.map((opening) => opening.label)).toEqual([
      'Lost',
      'Lost',
      ...Array.from({ length: 8 }, () => 'Won'),
    ]);
  });

  it('prints the page-wide empty sentence under the minimum', () => {
    const games = together(2, 2);
    const duos = rivalsOf(games).duos;
    expect(duos.rows).toEqual([]);
    expect(duos.empty).toBe(NO_DUOS);
  });

  it('titles both lists', () => {
    const rivals = rivalsOf(together(8, 2));
    expect(rivals.nemesis.title).toBe(NEMESIS_TITLE);
    expect(rivals.duos.title).toBe(BEST_DUO_TITLE);
    expect(rivals.nemesis.rule).toContain(String(MIN_DUO_GAMES));
    expect(rivals.duos.rule).toContain(String(MIN_DUO_GAMES));
  });
});
