import type { DeltaReason } from '@customs/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WhyText } from './why-text';

/**
 * M14.64: the footnote under every Why? is true whichever way the game went and whoever's row it
 * is. The old line ("Bigger when you're new...") read wrong under a small loss and in the second
 * person on somebody else's row.
 */

const FOOTNOTE = 'Upsets and new players move the most.';

function reason(result: 'won' | 'lost', points: number): DeltaReason {
  return {
    basis: 'stored',
    result,
    points,
    basePoints: points,
    odds: { pct: 60, stance: result === 'won' ? 'underdog' : 'favourite' },
    certainty: 'settled',
    award: 'none',
  };
}

const YOU = { kind: 'you' } as const;
const OMAR = { kind: 'name', name: 'Omar' } as const;

const cases = [
  { label: 'a win on your own row', reason: reason('won', 31), subject: YOU, lead: 'You won 31.' },
  { label: 'a loss on your own row', reason: reason('lost', -24), subject: YOU, lead: 'You lost 24.' },
  { label: "a win on someone else's row", reason: reason('won', 31), subject: OMAR, lead: 'Omar won 31.' },
  {
    label: "a loss on someone else's row",
    reason: reason('lost', -24),
    subject: OMAR,
    lead: 'Omar lost 24.',
  },
];

describe('WhyText footnote (M14.64)', () => {
  for (const c of cases) {
    it(`reads the same true line under ${c.label}`, () => {
      const { container } = render(<WhyText reason={c.reason} subject={c.subject} />);
      expect(container).toHaveTextContent(c.lead);
      expect(screen.getByText(FOOTNOTE)).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/you're new/i);
    });
  }
});
