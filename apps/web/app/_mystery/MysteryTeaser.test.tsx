import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AWARD_CASE_CLOSED,
  categoryLabel,
  MYSTERY_CASE_CLOSED,
  MYSTERY_CORRECT,
  MYSTERY_GUESS,
  MYSTERY_WRONG,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import type { MysteryPlayView, MysteryResultView } from '@/lib/mystery/types';
import { MysteryTeaser } from './MysteryTeaser';

const play: MysteryPlayView = {
  challengeId: '11111111-1111-4111-8111-111111111111',
  challengeNumber: 184,
  day: '2026-09-13',
  kind: 'mystery',
  category: 'disaster',
  expiresAt: '2026-09-13T21:00:00.000Z',
  hook: {
    kills: 2,
    deaths: 11,
    assists: 4,
    kda: '2 / 11 / 4',
    durationS: 1902,
    durationLabel: '31:42',
    lines: [{ label: 'Deaths', value: '11' }],
  },
  suspects: [{ playerId: '22222222-2222-4222-8222-222222222222', name: 'Ahmed' }],
  cluesRevealed: 0,
  revealedClues: [],
  clueCount: 5,
  completed: false,
};

/** The teaser reads `personal.correct` and the day's identity off a result, nothing else. */
function closed(correct: boolean, overrides: Partial<MysteryResultView> = {}): MysteryPageState {
  return {
    kind: 'closed',
    result: {
      ...play,
      performance: {} as MysteryResultView['performance'],
      community: {} as MysteryResultView['community'],
      personal: { correct } as MysteryResultView['personal'],
      ...overrides,
    },
  };
}

describe('MysteryTeaser, the daily game on /', () => {
  it('is one link to /mystery with the heading, the question and Guess now', () => {
    render(<MysteryTeaser mystery={{ kind: 'play', play }} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/mystery');
    expect(link).toHaveTextContent('Daily Mystery #184');
    expect(link).toHaveTextContent(categoryLabel('disaster'));
    expect(link).toHaveTextContent('2 / 11 / 4');
    expect(link).toHaveTextContent(MYSTERY_GUESS);
    expect(link.querySelector('.cn-mystery-teaser-go')).not.toBeNull();
  });

  /**
   * The heading wears `cn-card-title` like every other card on the page (2026-10-03). It was the
   * strip's date class, `cn-slug`, and read as a second date line under the night's own.
   */
  it('titles the row like every other card, not like the date line, and keeps the KDA in mono', () => {
    render(<MysteryTeaser mystery={{ kind: 'play', play }} />);
    const link = screen.getByRole('link');
    const title = link.querySelector('.cn-card-title');
    expect(title).toHaveTextContent('Daily Mystery #184');
    expect(link.querySelector('.cn-slug')).toBeNull();
    expect(screen.getByText('2 / 11 / 4')).toHaveClass('cn-num');
  });

  it('never prints a suspect, a clue or the hook lines: the game itself is on /mystery', () => {
    render(<MysteryTeaser mystery={{ kind: 'play', play }} />);
    expect(screen.queryByText('Ahmed')).not.toBeInTheDocument();
    expect(screen.queryByText('Deaths')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the award game on an award day', () => {
    render(<MysteryTeaser mystery={{ kind: 'play', play: { ...play, kind: 'award', category: 'gold' } }} />);
    expect(screen.getByRole('link')).toHaveTextContent('Guess the Award #184');
    expect(screen.getByRole('link')).toHaveTextContent(categoryLabel('gold'));
  });

  it('says settled and how the visitor did once they have guessed, with no brand on it', () => {
    const { unmount } = render(<MysteryTeaser mystery={closed(true)} />);
    let link = screen.getByRole('link');
    expect(link).toHaveTextContent(MYSTERY_CASE_CLOSED);
    expect(link).toHaveTextContent(MYSTERY_CORRECT);
    expect(link).not.toHaveTextContent(MYSTERY_GUESS);
    expect(link.querySelector('.cn-mystery-teaser-go')).toBeNull();
    unmount();

    render(<MysteryTeaser mystery={closed(false, { kind: 'award', category: 'vision' })} />);
    link = screen.getByRole('link');
    expect(link).toHaveTextContent(AWARD_CASE_CLOSED);
    expect(link).toHaveTextContent(MYSTERY_WRONG);
  });

  it('draws nothing on an empty day or with no state at all', () => {
    const { container, rerender } = render(
      <MysteryTeaser mystery={{ kind: 'empty', empty: { empty: true, expiresAt: play.expiresAt } }} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<MysteryTeaser mystery={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries the placement class beside the card classes', () => {
    render(<MysteryTeaser mystery={{ kind: 'play', play }} className="cn-mystery-teaser-inline" />);
    expect(screen.getByRole('link')).toHaveClass('cn-card', 'cn-mystery-teaser', 'cn-mystery-teaser-inline');
  });
});
