import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StatsGame } from '@/lib/stats/types';
import { playerIdOf, puuidOf, rosterFor, tenPlayerGame } from '@/lib/testing/statsFixtures';
import {
  HEATS_HEADING,
  LANES_HEADING,
  PICK_HEADING,
  PICK_IDLE,
  PICK_ONE,
  PICK_SAME,
  TYRANTS_HEADING,
  VERSUS_INTRO,
  VERSUS_LABEL,
  versusRoast,
} from '@/lib/versus/copy';
import type { VersusView as VersusModel } from '@/lib/versus/types';
import { versusView } from '@/lib/versus/view';
import { VersusView } from './VersusView';

const RANGE = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function at(n: number): string {
  return `2026-09-01T${String(10 + n).padStart(2, '0')}:00:00Z`;
}

function topRun(blueWins: number, redWins: number): StatsGame[] {
  const games: StatsGame[] = [];
  for (let index = 0; index < blueWins; index += 1) {
    games.push(tenPlayerGame({ at: at(index), winner: 100, blue: ['omar:top'], red: ['ahmed:top'] }));
  }
  for (let index = 0; index < redWins; index += 1) {
    games.push(
      tenPlayerGame({ at: at(blueWins + index), winner: 200, blue: ['omar:top'], red: ['ahmed:top'] }),
    );
  }
  return games;
}

function snapshot(games: StatsGame[], extra: { leftPuuid?: string; rightPuuid?: string } = {}): VersusModel {
  return versusView({
    window: 'all-time',
    games,
    players: rosterFor(games),
    range: RANGE,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
    ...extra,
  });
}

describe('VersusView', () => {
  it('names the window and the page', () => {
    render(<VersusView view={snapshot(topRun(8, 2))} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`All time ${VERSUS_LABEL}`);
    expect(screen.getByText(VERSUS_INTRO)).toBeInTheDocument();
    expect(screen.getByText(PICK_HEADING)).toBeInTheDocument();
    expect(screen.getByText(LANES_HEADING)).toBeInTheDocument();
    expect(screen.getByText(TYRANTS_HEADING)).toBeInTheDocument();
    expect(screen.getByText(HEATS_HEADING)).toBeInTheDocument();
    expect(screen.getByText(versusRoast(LANES_HEADING) as string)).toBeInTheDocument();
    expect(screen.getByText(PICK_IDLE)).toBeInTheDocument();
  });

  it('lists the top series in a lane with both names linked', () => {
    render(<VersusView view={snapshot(topRun(8, 2))} />);
    expect(screen.getAllByRole('link', { name: 'Omar' })[0]).toHaveAttribute('href', `/p/${puuidOf('omar')}`);
    expect(screen.getAllByRole('link', { name: 'Ahmed' })[0]).toHaveAttribute(
      'href',
      `/p/${puuidOf('ahmed')}`,
    );
    expect(screen.getAllByText('8W 2L · 80%').length).toBeGreaterThan(0);
  });

  it('opens a series when two different people are picked', () => {
    const view = snapshot(topRun(8, 2), { leftPuuid: puuidOf('omar'), rightPuuid: puuidOf('ahmed') });
    render(<VersusView view={view} />);
    expect(screen.getByText("Omar has Ahmed's number.")).toBeInTheDocument();
    expect(screen.getByText('8–2')).toBeInTheDocument();
    expect(screen.queryByText(PICK_IDLE)).not.toBeInTheDocument();
  });

  it('asks for the other player when only one is picked', () => {
    render(<VersusView view={snapshot(topRun(3, 0), { leftPuuid: puuidOf('omar') })} />);
    expect(screen.getByText(PICK_ONE)).toBeInTheDocument();
  });

  it('refuses a person compared with themselves', () => {
    render(
      <VersusView
        view={snapshot(topRun(3, 0), { leftPuuid: puuidOf('omar'), rightPuuid: puuidOf('omar') })}
      />,
    );
    expect(screen.getByText(PICK_SAME)).toBeInTheDocument();
    expect(playerIdOf('omar')).toBe('p-omar');
  });
});
