import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Delta } from './Delta';

/** A game's rating change on the games list and the game page (M14.42, quality G1). */
describe('Delta', () => {
  it('prints a zero as ±0, muted, and says no change', () => {
    const { container } = render(<Delta value={0} />);
    expect(screen.getByText('±0')).toBeInTheDocument();
    expect(screen.queryByText('+0')).toBeNull();
    expect(screen.getByText('no change')).toBeInTheDocument();
    // Not the gain's weight: muted 400 like a loss (05-design 5.3).
    expect(container.firstElementChild).not.toHaveClass('font-semibold');
  });

  it('keeps the sign on a gain and the real minus on a loss', () => {
    render(
      <>
        <Delta value={12} />
        <Delta value={-7} />
      </>,
    );
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(screen.getByText('gained 12')).toBeInTheDocument();
    expect(screen.getByText('−7')).toBeInTheDocument();
    expect(screen.getByText('lost 7')).toBeInTheDocument();
  });

  it('says not rated for a game that moved nothing', () => {
    render(<Delta value={null} />);
    expect(screen.getByText('not rated')).toBeInTheDocument();
  });
});
