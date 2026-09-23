import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { awardLine, resultEmbed } from '@/lib/discord/embeds';
import { workedResult } from '@/lib/testing/tonightFixtures';
import type { ResultView } from '@/lib/tonight/types';
import { ResultPoster } from './ResultPoster';

/**
 * The result poster (M11.3): a pure function of one `ResultView`, so the tonight page and the
 * game page (M11.4) draw the same thing. These pin product's acceptance, one case each.
 */

function draw(result: ResultView, explanation: string | null = null) {
  return render(<ResultPoster result={result} explanation={explanation} viewerPuuid={null} />);
}

describe('the odds line', () => {
  it('names the underdog who won, in place of the favourite line', () => {
    const { container } = draw(workedResult({ winningSide: 200, blueWinProb: 0.62 }));
    expect(container.querySelector('.cn-underdog')).toHaveTextContent('Red was 38%. Red won.');
    expect(container.textContent).not.toContain('Blue was favored 62%.');
    expect(container.textContent).not.toContain('favored');
  });

  it('keeps the favourite line when the favourite won, with no underdog line', () => {
    const { container } = draw(workedResult({ winningSide: 100, blueWinProb: 0.62 }));
    expect(container.querySelector('.cn-prediction')).toHaveTextContent('Blue was favored 62%.');
    expect(container.querySelector('.cn-underdog')).toBeNull();
    expect(container.textContent).not.toContain('won.');
  });

  it('says neither side was favoured at 50, whoever won', () => {
    for (const winningSide of [100, 200] as const) {
      const { container, unmount } = draw(workedResult({ winningSide, blueWinProb: 0.5 }));
      expect(container.querySelector('.cn-prediction')).toHaveTextContent('Neither side was favored.');
      expect(container.querySelector('.cn-underdog')).toBeNull();
      unmount();
    }
  });

  it('prints no odds line at all without a stored split', () => {
    const { container } = draw(workedResult({ blueWinProb: null }));
    expect(container.querySelector('.cn-prediction')).toBeNull();
    expect(container.querySelector('.cn-underdog')).toBeNull();
    expect(container.textContent).not.toContain('%');
  });
});

describe('the verdict and the footnotes', () => {
  it('puts the duration above the winner and the facts under the hairline', () => {
    const { container } = draw(
      workedResult({ winningSide: 100, blueWinProb: 0.62, award: { mvp: 'Lena', ace: 'Rami' } }),
    );
    const head = container.querySelector('.cn-result-head');
    expect([...(head?.children ?? [])].map((line) => line.textContent)).toEqual(['34:12', 'BLUE WINS']);
    const notes = container.querySelector('.cn-result-notes');
    expect([...(notes?.children ?? [])].map((line) => line.textContent)).toEqual([
      'Blue was favored 62%.',
      'MVP Lena · ACE Rami',
      'Top damage: Lena, 47.3k',
    ]);
  });

  it("rules the headline card in the winner's side colour, and draws no hairline with nothing under it", () => {
    const { container } = draw(workedResult({ blueWinProb: null, topDamage: null }));
    expect(container.querySelector('.cn-result')?.className).toContain('cn-result-red');
    expect(container.querySelector('.cn-result')?.className).not.toContain('cn-team-won');
    expect(container.querySelector('.cn-result-notes')).toBeNull();
  });
});

describe('MVP and ACE', () => {
  it("prints the result post's line, byte for byte", () => {
    const award = { mvp: 'Lena', ace: 'Iris' };
    const { container } = draw(workedResult({ award }));
    const line = container.querySelector('.cn-result-award')?.textContent;
    expect(line).toBe(awardLine(award));
    expect(line).toBe('MVP Lena · ACE Iris');
    // And the field the Discord result embed posts for the same two names.
    const embed = resultEmbed({
      winningSide: 200,
      durationS: 2_052,
      blue: [],
      red: [],
      award,
      blueWinProb: 0.54,
      topDamage: null,
      gameNumber: 1,
      url: 'https://example.test',
      timestamp: '2026-09-08T21:00:00.000Z',
    }).embeds[0];
    expect(embed?.fields.at(-1)?.value).toBe(line);
  });

  it('prints no MVP anywhere in the block when the game has none', () => {
    const { container } = draw(workedResult({ award: null }), 'Blue favored 54%.');
    expect(container.querySelector('.cn-result-award')).toBeNull();
    expect(container.textContent).not.toContain('MVP');
    expect(container.textContent).not.toContain('ACE');
  });
});

describe('what the poster never prints', () => {
  it('has no team total of deltas, no side sums, no trophy, no emoji and no champion icon', () => {
    const { container } = draw(workedResult({ award: { mvp: 'Lena', ace: 'Iris' } }), 'Blue favored 54%.');
    expect(container.querySelectorAll('.cn-sum')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('champion');
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(container.textContent).not.toMatch(/UPSET|VICTORY|underdog/i);
  });

  it('keeps the explanation verbatim, and leaves it out when there is none', () => {
    const { container, unmount } = draw(workedResult(), 'Blue favored 54%. Gap 100.');
    expect(container.querySelector('.cn-explain-text')?.textContent).toBe('Blue favored 54%. Gap 100.');
    unmount();
    expect(draw(workedResult()).container.querySelector('.cn-explain')).toBeNull();
  });
});
