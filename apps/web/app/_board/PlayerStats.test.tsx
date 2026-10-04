import { render, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';
import {
  averageGameLine,
  CURRENT_STREAK,
  LONGEST_LOSS,
  LONGEST_WIN,
  NO_PARTNERS,
  noRoleFootnote,
  PARTNERS_HEADING,
  SIDE_RECORD_HEADING,
  STREAKS_HEADING,
} from '@/lib/stats/copy';
import type { PlayerStatsView } from '@/lib/stats/types';
import { emptyPlayerStats, workedPlayerStats } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { PlayerStats } from './PlayerStats';

/**
 * The player page's records (M5.20), 2.0 since M14.15: what the page does with `lib/stats`' folded
 * answer. Role and text queries only.
 */

const playerHref = (puuid: string) => `/g/customs/p/${puuid}` as Route;

function draw(stats: PlayerStatsView = workedPlayerStats()) {
  return render(<PlayerStats stats={stats} playerHref={playerHref} />);
}

/** The rows of the card titled `title`, with the screen-reader-only count taken back out. */
function rowsOf(title: string): string[] {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('[data-slot="card"]') as HTMLElement;
  return within(card)
    .getAllByRole('listitem')
    .map((row) => row.textContent?.replace(/ over \d+ games?/, '') ?? '');
}

describe('by role', () => {
  it('prints the percentage over the minimum and the bare record under it', () => {
    draw(
      workedPlayerStats({
        roles: [
          { role: 'jungle', puuid: 'u', name: 'Hana', games: 17, wins: 12, losses: 5, winRate: 71 },
          { role: 'mid', puuid: 'u', name: 'Hana', games: 1, wins: 1, losses: 0, winRate: null },
        ],
      }),
    );
    expect(rowsOf('By role')).toEqual(['jungle12W 5L · 71%', 'mid1W 0L']);
  });

  it('is the no-role footnote alone when the client recorded no position of theirs', () => {
    draw(workedPlayerStats({ roles: [], noRoleGames: 12 }));
    expect(screen.getAllByText(noRoleFootnote(12))).toHaveLength(1);
  });

  it('prints the footnote under the rows when only some of their games are missing one', () => {
    draw(workedPlayerStats({ noRoleGames: 3 }));
    expect(screen.getByText(noRoleFootnote(3))).toBeInTheDocument();
    expect(rowsOf('By role')).toHaveLength(2);
  });
});

describe('by side', () => {
  it('prints blue then red, by word, and no percentage under the minimum', () => {
    draw();
    expect(rowsOf(SIDE_RECORD_HEADING)).toEqual(['Blue16W 17L · 48%', 'Red3W 1L']);
  });
});

describe('partners', () => {
  it('is three best and two worst, each a link to that person s page in the group', () => {
    draw();
    expect(rowsOf(PARTNERS_HEADING)).toEqual([
      'Iris9W 3L · 75%',
      'Karim7W 4L · 64%',
      'Theo6W 4L · 60%',
      'Bilal2W 9L · 18%',
      'Omar3W 8L · 27%',
    ]);
    expect(screen.getByRole('link', { name: 'Iris' })).toHaveAttribute(
      'href',
      `/g/customs/p/${workedPuuid('Iris')}`,
    );
  });

  it('says the empty line once, with neither group label, when nobody qualifies', () => {
    draw(workedPlayerStats({ bestPartners: [], worstPartners: [] }));
    expect(screen.getAllByText(NO_PARTNERS)).toHaveLength(1);
    expect(screen.queryByText('Best together')).not.toBeInTheDocument();
    expect(screen.queryByText('Worst together')).not.toBeInTheDocument();
  });
});

describe('streaks', () => {
  it('is three rows: the run they are on and the longest of each kind', () => {
    draw();
    expect(rowsOf(STREAKS_HEADING)).toEqual([`${CURRENT_STREAK}W3`, `${LONGEST_WIN}W6`, `${LONGEST_LOSS}L4`]);
  });

  it('draws no row for a kind that never happened, and never `L0`', () => {
    draw(
      workedPlayerStats({
        streaks: {
          puuid: 'u',
          name: 'Hana',
          current: { kind: 'W', length: 8 },
          longestWin: 8,
          longestLoss: 0,
        },
      }),
    );
    expect(rowsOf(STREAKS_HEADING)).toEqual([`${CURRENT_STREAK}W8`, `${LONGEST_WIN}W8`]);
    expect(document.body.textContent).not.toContain('L0');
  });
});

describe('the rest', () => {
  it('prints the average game length, the award line and the cap line', () => {
    draw(workedPlayerStats({ awards: ['Most improved, week of 6 Sep.'], capped: true, cap: 2_000 }));
    expect(screen.getByText(averageGameLine(32))).toHaveTextContent('Average game 32 min.');
    expect(screen.getByText('Most improved, week of 6 Sep.')).toBeInTheDocument();
    expect(screen.getByText('Showing the most recent 2000 games.')).toBeInTheDocument();
  });

  it('draws nothing for a window this player did not play', () => {
    const { container } = draw(emptyPlayerStats('last-week'));
    expect(container).toBeEmptyDOMElement();
  });
});
