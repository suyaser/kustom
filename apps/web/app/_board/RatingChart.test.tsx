import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RatingChart } from './RatingChart';

/** Where the reference label lands (M18.7 design re-check): the geometry decides, the markup follows. */
describe('RatingChart reference label', () => {
  const label = (container: HTMLElement) => container.querySelector('[data-placement]');

  it('sits under the dashed line when the line stays above it across the label', () => {
    const { container } = render(
      <RatingChart history={[1_200, 1_220, 1_240, 1_260]} reference={1_200} window="all-time" />,
    );
    expect(label(container)).toHaveAttribute('data-placement', 'below');
    expect(label(container)).toHaveTextContent('Start 1200');
    expect(label(container)).toHaveClass('absolute');
  });

  it('drops into the gutter under the plot when the line crosses the reference under the words', () => {
    const { container } = render(
      <RatingChart history={[0, 12, 30, 41, 18, -9, 6]} reference={0} window="this-week" />,
    );
    const span = label(container);
    expect(span).toHaveAttribute('data-placement', 'gutter');
    expect(span).toHaveTextContent('Week start');
    expect(span).not.toHaveClass('absolute');
    expect(span?.getAttribute('style')).toBeNull();
    // After the plot, in flow.
    expect(container.querySelector('svg')?.nextElementSibling).toBe(span);
  });
});
