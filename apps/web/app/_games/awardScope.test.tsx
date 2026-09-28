import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assembleFunFacts } from '@/lib/stats/funView';
import type { StatsGame } from '@/lib/stats/types';
import { statsView } from '@/lib/stats/view';
import { rosterFor, scoredSeats, statsGame, withoutAwardColumns } from '@/lib/testing/statsFixtures';
import { FunView } from '../_fun/FunView';
import { StatsView } from '../_stats/StatsView';

/**
 * M7.23 acceptance 4: naming the MVP and the ACE touches `/games` and nothing else.
 *
 * `/stats` and `/fun` read the same `game_players` select M7.23 widened, and `/fun` renders the
 * same `MatchSheet` the word lives in. The proof that neither page moved is that they render the
 * **same bytes** for a window of games that carries the three new columns and for the same window
 * with them blanked — i.e. as the loader handed it to them before this task — on games where
 * `/games` itself *would* print a word.
 */

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function month(): StatsGame[] {
  return [0, 1, 2, 3, 4, 5].map((day) =>
    statsGame({
      id: `g-${day}`,
      at: `2026-09-0${day + 2}T20:00:00Z`,
      lcuGameId: String(day + 1),
      winner: day % 2 === 0 ? 100 : 200,
      ...scoredSeats(),
    }),
  );
}

function input(games: readonly StatsGame[]) {
  return {
    window: 'this-month' as const,
    games,
    players: rosterFor(games),
    range: MONTH,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
  };
}

describe('M7.23 leaves /stats and /fun alone', () => {
  const games = month();
  const before = games.map(withoutAwardColumns);

  it('renders /fun byte for byte as before, and never prints the word', () => {
    const now = render(<FunView facts={assembleFunFacts(input(games))} />).container.innerHTML;
    const then = render(<FunView facts={assembleFunFacts(input(before))} />).container.innerHTML;
    expect(now).toBe(then);
    expect(now).toContain('cn-sheet');
    expect(now).not.toContain('cn-game-award');
    expect(now).not.toMatch(/\b(MVP|ACE)\b/);
  });

  it('renders /stats byte for byte as before', () => {
    const now = render(<StatsView stats={statsView(input(games))} />).container.innerHTML;
    const then = render(<StatsView stats={statsView(input(before))} />).container.innerHTML;
    expect(now).toBe(then);
    expect(now).not.toContain('cn-game-award');
  });
});
