import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JoinedNotice } from './JoinedNotice';

let query = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }));

/** `You're in.` on `?joined=1`, and nothing otherwise (STRATEGY 3.3). */
describe("You're in", () => {
  it('says it, politely, after a join', () => {
    query = 'joined=1';
    render(<JoinedNotice />);
    expect(screen.getByRole('status')).toHaveTextContent("You're in.");
  });

  it('draws nothing on every other visit', () => {
    query = '';
    const { container } = render(<JoinedNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
