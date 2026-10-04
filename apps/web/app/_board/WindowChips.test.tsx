import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowChips } from './WindowChips';

/** The All time chip after a `Reset ratings` (M14.18, STRATEGY 3.6). Role and text queries only. */
describe('WindowChips', () => {
  it('reads All time for a group that never reset', () => {
    render(<WindowChips path="/g/customs/leaderboard" selected="all-time" />);
    expect(screen.getByRole('link', { name: 'All time' })).toHaveAttribute('aria-current', 'page');
  });

  it('reads Since <day> once the group has reset, with the same address', () => {
    render(<WindowChips path="/g/customs/leaderboard" selected="this-week" resetDay="5 Nov" />);
    expect(screen.queryByRole('link', { name: 'All time' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Since 5 Nov' })).toHaveAttribute(
      'href',
      '/g/customs/leaderboard?window=all-time',
    );
    expect(screen.getByRole('link', { name: 'Last week' })).toBeInTheDocument();
  });

  it('offers the three windows and no month (M14.48)', () => {
    render(<WindowChips path="/g/customs/leaderboard" selected="this-week" />);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'This week',
      'Last week',
      'All time',
    ]);
    expect(screen.queryByRole('link', { name: /month/i })).toBeNull();
  });
});
