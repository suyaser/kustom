import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './chip';

describe('Chip (M14.1)', () => {
  it('is a static span by default', () => {
    render(<Chip>In play</Chip>);
    const chip = screen.getByText('In play');
    expect(chip.tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes a toggle button with aria-pressed when pressed is given', () => {
    const onClick = vi.fn();
    render(
      <>
        <Chip pressed={false} onClick={onClick}>
          top
        </Chip>
        <Chip pressed>jungle</Chip>
      </>,
    );
    const top = screen.getByRole('button', { name: 'top' });
    expect(top).toHaveAttribute('type', 'button');
    expect(top).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'jungle' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(top);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('a side chip names the side in words beside a hidden glyph, and is marked as a side fill', () => {
    const { container } = render(
      <>
        <Chip variant="side" side="blue" />
        <Chip variant="side" side="red">
          51% Red
        </Chip>
      </>,
    );
    const blue = screen.getByText('BLUE');
    expect(blue).toHaveAttribute('data-side-fill', 'blue');
    expect(screen.getByText('51% Red')).toHaveAttribute('data-side-fill', 'red');
    const glyphs = container.querySelectorAll('svg[data-slot="side-glyph"]');
    expect(glyphs).toHaveLength(2);
    for (const glyph of glyphs) expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('only a side chip carries the side-fill marker', () => {
    render(<Chip variant="you">You</Chip>);
    expect(screen.getByText('You')).not.toHaveAttribute('data-side-fill');
  });
});
