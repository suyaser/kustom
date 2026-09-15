import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NO_DUOS } from '@/lib/stats/copy';
import {
  BEST_DUO_TITLE,
  duoRecordLine,
  NEMESIS_TITLE,
  NO_NEMESIS,
  nemesisLine,
  ofGamesLine,
  RIVALS_HEADING,
  SEE_GAMES,
  THIS_GAME,
} from '@/lib/stats/funCopy';
import { assembleFunFacts } from '@/lib/stats/funView';
import type { StatsGame } from '@/lib/stats/types';
import { rosterFor, statsGame, tenPlayerGame } from '@/lib/testing/statsFixtures';
import { FunView } from './FunView';

/**
 * Friends and enemies on `/fun` (M8.1), rendered.
 *
 * Every custom names **fresh spare seats**, so the only pairs that reach the five-game minimum
 * are Lena and Theo (same side) and Lena against Yuki (opposite sides).
 */

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

let spare = 0;

function seats(count: number): string[] {
  return Array.from({ length: count }, () => {
    spare += 1;
    return `s${spare}`;
  });
}

/** Ten customs: Lena and Theo on blue, Yuki on red, blue winning six of them. */
function nights(): StatsGame[] {
  return Array.from({ length: 10 }, (_, index) =>
    statsGame({
      id: `night-${index}`,
      at: `2026-09-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
      durationS: 1_800,
      winner: index < 6 ? 100 : 200,
      blue: ['lena', 'theo', ...seats(3)],
      red: ['yuki', ...seats(4)],
    }),
  );
}

function view(games: readonly StatsGame[]) {
  return assembleFunFacts({
    window: 'this-month',
    games: [...games],
    players: rosterFor(games),
    range: MONTH,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
  });
}

function card(): HTMLElement {
  return screen.getByText(RIVALS_HEADING).closest('.cn-card') as HTMLElement;
}

describe('FunView — friends and enemies', () => {
  it('names the group and both lists, in English and in 3ameya', () => {
    render(<FunView facts={view(nights())} />);
    const group = card();
    expect(within(group).getByText('صحابه وخصومه')).toBeInTheDocument();
    expect(within(group).getByText(NEMESIS_TITLE)).toBeInTheDocument();
    expect(within(group).getByText('اللي دايما بيكسبه')).toBeInTheDocument();
    expect(within(group).getByText(BEST_DUO_TITLE)).toBeInTheDocument();
    expect(within(group).getByText('التنائي اللي مبيخسرش')).toBeInTheDocument();
  });

  it('prints the count with its denominator, and the sentence under it', () => {
    render(<FunView facts={view(nights())} />);
    const group = card();
    expect(within(group).getAllByRole('link', { name: 'Yuki' })[0]).toHaveAttribute('href', '/p/u-yuki');
    expect(within(group).getByText(ofGamesLine(6, 10))).toBeInTheDocument();
    expect(within(group).getByText(nemesisLine('Lena', 6, 10))).toBeInTheDocument();
  });

  it('prints the pair line the partners block prints', () => {
    render(<FunView facts={view(nights())} />);
    const group = card();
    expect(within(group).getByText('Lena and Theo')).toBeInTheDocument();
    expect(within(group).getByText(duoRecordLine(6, 4, 60))).toBeInTheDocument();
  });

  it('opens every custom behind a row, closed by default', () => {
    render(<FunView facts={view(nights())} />);
    const nemesis = screen.getByText(NEMESIS_TITLE).closest('.cn-role-block') as HTMLElement;
    const duos = screen.getByText(BEST_DUO_TITLE).closest('.cn-role-block') as HTMLElement;

    const first = nemesis.querySelector('details');
    expect(first).not.toBeNull();
    expect(first).not.toHaveAttribute('open');
    expect(within(nemesis).getAllByText(SEE_GAMES).length).toBeGreaterThan(0);
    // Ten meetings behind Yuki's row, each its own scoreboard.
    expect(within(first as HTMLElement).getAllByText(THIS_GAME).length).toBe(10);

    const pair = duos.querySelector('details');
    expect(within(duos).getByText(SEE_GAMES)).toBeInTheDocument();
    expect(within(pair as HTMLElement).getAllByText(THIS_GAME).length).toBe(10);
  });

  it('prints both empty sentences on a window nobody has met five times in', () => {
    const game = tenPlayerGame({ at: '2026-09-02T20:00:00Z', durationS: 1_800, winner: 100 });
    render(<FunView facts={view([game])} />);
    const group = card();
    expect(within(group).getByText(NO_NEMESIS)).toBeInTheDocument();
    expect(within(group).getByText(NO_DUOS)).toBeInTheDocument();
  });

  it('draws the group on ARAM too', () => {
    const games = nights().map((game) => ({ ...game, gameMode: 'ARAM' }));
    render(<FunView facts={assembleFunFacts({ ...aramInput(games) }, 'aram')} />);
    expect(screen.getByText(RIVALS_HEADING)).toBeInTheDocument();
    expect(screen.getByText(nemesisLine('Lena', 6, 10))).toBeInTheDocument();
  });
});

function aramInput(games: readonly StatsGame[]) {
  return {
    window: 'this-month' as const,
    games: [...games],
    players: rosterFor(games),
    range: MONTH,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
  };
}
