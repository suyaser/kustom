import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { KustomReason } from '@/lib/breakdown/read';
import { WhyText } from './why-text';

/**
 * M14.64, Kustom since M18.6: the footnote under every Why? is true whichever way the game went and
 * whoever's row it is (05-design 11.6), and the rounding line shows only when the sum is off.
 */

const FOOTNOTE = 'Upsets and first games move the most.';

function reason(result: 'win' | 'loss', points: number, share = 1): KustomReason {
  return {
    track: 'all-time',
    gamesBefore: 20,
    allTime: null,
    parts: {
      side: 100,
      result,
      expectedPct: 50,
      k: 16,
      firstTenGames: false,
      shareRank: 3,
      share,
      award: 'none',
      points,
    },
  };
}

const YOU = { kind: 'you' } as const;
const OMAR = { kind: 'name', name: 'Omar' } as const;

const cases = [
  {
    label: 'a win on your own row',
    reason: reason('win', 8),
    subject: YOU,
    lead: 'It was an even game (50%)',
  },
  { label: 'a loss on your own row', reason: reason('loss', -8), subject: YOU, lead: 'so the loss cost' },
  {
    label: "a win on someone else's row",
    reason: reason('win', 8),
    subject: OMAR,
    lead: "It was an even game for Omar's side (50%)",
  },
  {
    label: "a loss on someone else's row",
    reason: reason('loss', -8),
    subject: OMAR,
    lead: 'Their game was',
  },
];

describe('WhyText footnote (M14.64, 05-design 11.6)', () => {
  for (const c of cases) {
    it(`reads the same true line under ${c.label}`, () => {
      const { container } = render(<WhyText reason={c.reason} subject={c.subject} />);
      expect(container).toHaveTextContent(c.lead);
      expect(screen.getByText(FOOTNOTE)).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/you're new|settl/i);
      expect(container).not.toHaveTextContent(/decimals/);
    });
  }

  it('adds the rounding line when the sum is off by a point (11.6.4)', () => {
    const { container } = render(<WhyText reason={reason('loss', -9, 1)} subject={YOU} />);
    expect(container).toHaveTextContent(
      'Ratings keep their decimals, so the change shown is 1 off this sum.',
    );
  });
});

describe('the inline sum for a screen reader (M18.7, 05-design 11.6.5)', () => {
  /** What a screen reader reads: everything but the `aria-hidden` glyphs. */
  function spoken(element: Element): string {
    const clone = element.cloneNode(true) as Element;
    for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
    return (clone.textContent ?? '').replace(/\s+/g, ' ');
  }

  it('reads 16 times 50% equals 8, and times 1 for the share; the glyphs are hidden', () => {
    const { container } = render(<WhyText reason={reason('win', 8)} subject={YOU} />);
    const text = spoken(container);
    expect(text).toContain('so the win was worth 16 times 50% equals 8.');
    expect(text).toContain(': times 1.');
    expect(text).not.toMatch(/[×=]/);
    for (const glyph of Array.from(container.querySelectorAll('[aria-hidden="true"]'))) {
      expect(['×', '=']).toContain(glyph.textContent);
    }
  });

  it('shows the glyphs and not the words to the eye', () => {
    const { container } = render(<WhyText reason={reason('win', 8)} subject={YOU} />);
    const clone = container.cloneNode(true) as Element;
    for (const hidden of Array.from(clone.querySelectorAll('.sr-only'))) hidden.remove();
    expect(clone.textContent).toContain('16\u2009×\u200950%\u2009=\u20098.');
    expect(clone.textContent).not.toMatch(/times|equals/);
  });
});
