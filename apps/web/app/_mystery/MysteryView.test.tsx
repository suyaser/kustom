import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { awardHookLines } from '@/lib/mystery/clues';
import {
  AWARD_BLAME,
  AWARD_CASE_CLOSED,
  AWARD_CRIME,
  AWARD_TODAY_CLOSED,
  awardStatLabel,
  categoryLabel,
  DAILY_NEXT,
  MYSTERY_BLAME,
  MYSTERY_CASE_CLOSED,
  MYSTERY_COMMUNITY,
  MYSTERY_CRIME,
  MYSTERY_EMPTY,
  MYSTERY_FIRST,
  MYSTERY_NO_STAT,
  MYSTERY_TODAY_CLOSED,
  MYSTERY_WHO,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import type { AwardCategory, MysteryPlayView, MysteryResultView } from '@/lib/mystery/types';
import { MysteryView } from './MysteryView';

const AHMED = '22222222-2222-4222-8222-222222222222';
const OMAR = '33333333-3333-4333-8333-333333333333';

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
    lines: [
      { label: 'Deaths', value: '11' },
      { label: 'Game', value: '31:42' },
    ],
  },
  suspects: [
    { playerId: AHMED, name: 'Ahmed' },
    { playerId: OMAR, name: 'Omar' },
  ],
  cluesRevealed: 0,
  revealedClues: [],
  clueCount: 5,
  completed: false,
};

const result: MysteryResultView = {
  ...play,
  revealedClues: [],
  performance: {
    kills: 2,
    deaths: 11,
    assists: 4,
    kda: '2 / 11 / 4',
    champion: 'Yasuo',
    role: 'mid',
    damage: 18420,
    damageLabel: '18.4k',
    cs: 143,
    gold: 9800,
    goldLabel: '9.8k',
    damageTaken: null,
    damageTakenLabel: null,
    visionScore: null,
    damageSelfMitigated: null,
    damageToObjectives: null,
    durationS: 1902,
    durationLabel: '31:42',
    won: false,
    startedLabel: '12 Sep',
  },
  personal: {
    guessedPlayerId: AHMED,
    guessedName: 'Ahmed',
    actualPlayerId: AHMED,
    actualName: 'Ahmed',
    correct: true,
    cluesUsed: 1,
    completionTimeMs: 8400,
    firstDetective: true,
    percentile: 'top-15',
  },
  community: {
    attempts: 47,
    correct: 27,
    wrong: 20,
    accuracyPercent: 57.4,
    wrongPercent: 42.6,
    averageCluesUsed: 2.1,
    zeroClueCorrect: 4,
    fastestCorrectMs: 8400,
    mostFalselyAccused: { playerId: OMAR, name: 'Omar', count: 12 },
    distribution: [
      { playerId: AHMED, name: 'Ahmed', count: 27, percent: 57 },
      { playerId: OMAR, name: 'Omar', count: 20, percent: 43 },
    ],
    firstDetectiveClaimed: true,
  },
};

/**
 * The same day on the other game (M8.4). Everything but `kind`, `category` and the hook's own
 * line is identical on purpose: the card is one component and the test is about which words
 * it reaches for, not about a second layout.
 */
const awardPlay: MysteryPlayView = {
  ...play,
  kind: 'award',
  category: 'mitigation',
  hook: {
    ...play.hook,
    lines: awardHookLines({ category: 'mitigation', value: 41_200, durationS: 1902 }),
  },
};

/**
 * A scoreboard with every award's number on it, and all seven distinct, so a row that reads
 * the wrong field prints the wrong string instead of the right one by coincidence.
 */
const awardPerformance: MysteryResultView['performance'] = {
  ...result.performance,
  kills: 9,
  deaths: 2,
  assists: 8,
  kda: '9 / 2 / 8',
  damage: 18_420,
  damageLabel: '18.4k',
  cs: 241,
  gold: 12_700,
  goldLabel: '12.7k',
  visionScore: 58,
  damageSelfMitigated: 41_200,
  damageToObjectives: 23_500,
};

const awardResult: MysteryResultView = {
  ...result,
  kind: 'award',
  category: 'mitigation',
  hook: awardPlay.hook,
  performance: awardPerformance,
};

/** Label and value, per award, as the reveal must print them. `(9 + 8) / 2 = 8.50`. */
const AWARD_REVEALS: readonly [AwardCategory, string][] = [
  ['kda', '8.50'],
  ['damage', '18.4k'],
  ['gold', '12.7k'],
  ['vision', '58'],
  ['mitigation', '41.2k'],
  ['cs', '241'],
  ['objectives', '23.5k'],
];

describe('MysteryView', () => {
  it('shows the crime and names, and hides community numbers before a guess', () => {
    const state: MysteryPageState = { kind: 'play', play };
    render(<MysteryView state={state} />);

    expect(screen.getByText('2 / 11 / 4')).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_CRIME)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ahmed' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: MYSTERY_WHO })).toBeInTheDocument();
    expect(screen.queryByText(MYSTERY_BLAME)).not.toBeInTheDocument();
    expect(screen.queryByText(MYSTERY_COMMUNITY)).not.toBeInTheDocument();
    expect(screen.queryByText('It was Ahmed')).not.toBeInTheDocument();
  });

  it('unlocks the reveal and the blame after a locked guess', () => {
    const state: MysteryPageState = { kind: 'closed', result };
    render(<MysteryView state={state} />);

    expect(screen.getByText('It was Ahmed')).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_FIRST, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_BLAME)).toBeInTheDocument();
    expect(screen.getByText('Most falsely accused: Omar')).toBeInTheDocument();
    expect(screen.getByText('Top 15%')).toBeInTheDocument();
  });

  it('keeps the case vocabulary on a closed mystery', () => {
    const state: MysteryPageState = { kind: 'closed', result };
    render(<MysteryView state={state} />);

    expect(screen.getByText(MYSTERY_CASE_CLOSED)).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_TODAY_CLOSED)).toBeInTheDocument();
    // The closed card names what today asked, not just whether the guess was right.
    expect(screen.getByText(categoryLabel('disaster'))).toBeInTheDocument();
    expect(
      screen.getByText('You are the first person today to solve the mystery correctly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(AWARD_CASE_CLOSED)).not.toBeInTheDocument();
  });

  /**
   * The countdown runs to civil midnight, which is when the *other* game starts. A label that
   * names today's game is wrong by exactly one day, so the label names neither — on both
   * cards and on the empty one.
   */
  it('counts down to the next game, never to another of today’s', () => {
    for (const state of [
      { kind: 'closed', result } as MysteryPageState,
      { kind: 'closed', result: awardResult } as MysteryPageState,
      {
        kind: 'empty',
        empty: { empty: true, expiresAt: '2026-09-13T21:00:00.000Z' },
      } as MysteryPageState,
    ]) {
      const view = render(<MysteryView state={state} />);
      expect(screen.getByText(DAILY_NEXT)).toBeInTheDocument();
      expect(screen.queryByText('Next mystery')).not.toBeInTheDocument();
      expect(screen.queryByText('Next award')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('says when there is not yet a custom to expose', () => {
    const state: MysteryPageState = {
      kind: 'empty',
      empty: { empty: true, expiresAt: '2026-09-13T21:00:00.000Z' },
    };
    render(<MysteryView state={state} />);
    expect(screen.getByText(MYSTERY_EMPTY)).toBeInTheDocument();
    // Nothing was built, so the empty card names neither game's countdown.
    expect(screen.getByText(DAILY_NEXT)).toBeInTheDocument();
  });
});

describe('MysteryView on an award day', () => {
  it('asks about the award, not a crime, and prints the service label on the hook', () => {
    const state: MysteryPageState = { kind: 'play', play: awardPlay };
    render(<MysteryView state={state} />);

    expect(screen.getByText(AWARD_CRIME)).toBeInTheDocument();
    expect(screen.queryByText(MYSTERY_CRIME)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: categoryLabel('mitigation') })).toBeInTheDocument();
    // `awardHookLines` already labelled the number; the view must not relabel it.
    expect(screen.getByText(awardStatLabel('mitigation'))).toBeInTheDocument();
    expect(screen.getByText('41.2k')).toBeInTheDocument();
    // The question, the suspects and the guess flow are the same on both days.
    expect(screen.getByRole('heading', { name: MYSTERY_WHO })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ahmed' })).toBeInTheDocument();
  });

  it('settles the award instead of closing a case', () => {
    const state: MysteryPageState = { kind: 'closed', result: awardResult };
    render(<MysteryView state={state} />);

    expect(screen.getByText(AWARD_CASE_CLOSED)).toBeInTheDocument();
    expect(screen.getByText(AWARD_TODAY_CLOSED)).toBeInTheDocument();
    expect(screen.getByText(AWARD_BLAME)).toBeInTheDocument();
    expect(screen.getByText(DAILY_NEXT)).toBeInTheDocument();
    expect(screen.getByText('Most wrong picks: Omar')).toBeInTheDocument();
    expect(screen.getByText('You are the first person today to name the right player.')).toBeInTheDocument();

    expect(screen.queryByText(MYSTERY_CASE_CLOSED)).not.toBeInTheDocument();
    expect(screen.queryByText(MYSTERY_TODAY_CLOSED)).not.toBeInTheDocument();
    expect(screen.queryByText(MYSTERY_BLAME)).not.toBeInTheDocument();
    expect(screen.queryByText('Most falsely accused: Omar')).not.toBeInTheDocument();
  });

  it('keeps the shared verdict and panel words on both days', () => {
    const state: MysteryPageState = { kind: 'closed', result: awardResult };
    render(<MysteryView state={state} />);

    expect(screen.getByText(MYSTERY_COMMUNITY)).toBeInTheDocument();
    expect(screen.getByText('Your result')).toBeInTheDocument();
    expect(screen.getByText('It was Ahmed')).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_FIRST, { exact: false })).toBeInTheDocument();
  });
});

/**
 * The reveal, once per award. Four of the seven (gold, vision, mitigation, objectives) have no
 * other row in the performance panel, so before M8.4's fix pass those four settled without
 * ever showing the number the award was about — and without naming the award either.
 */
describe('MysteryView reveals the award it asked about', () => {
  for (const [category, value] of AWARD_REVEALS) {
    it(`prints ${category}'s own label and number on the closed card`, () => {
      const state: MysteryPageState = {
        kind: 'closed',
        result: { ...awardResult, category, performance: awardPerformance },
      };
      render(<MysteryView state={state} />);

      // The award is named, not just the verdict.
      expect(screen.getByText(categoryLabel(category))).toBeInTheDocument();
      // Exactly one row carries the number, under the hook's own label.
      expect(screen.getByText(awardStatLabel(category))).toBeInTheDocument();
      expect(screen.getByText(value)).toBeInTheDocument();
      expect(screen.queryByText(MYSTERY_NO_STAT)).not.toBeInTheDocument();
    });
  }

  it('says a column stored before M7.7 was not recorded, rather than calling it zero', () => {
    const state: MysteryPageState = {
      kind: 'closed',
      result: {
        ...awardResult,
        category: 'vision',
        performance: { ...awardPerformance, visionScore: null },
      },
    };
    render(<MysteryView state={state} />);

    expect(screen.getByText(awardStatLabel('vision'))).toBeInTheDocument();
    expect(screen.getByText(MYSTERY_NO_STAT)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('leaves a mystery day with no award row at all', () => {
    const state: MysteryPageState = { kind: 'closed', result };
    render(<MysteryView state={state} />);

    for (const [category] of AWARD_REVEALS) {
      if (category === 'damage' || category === 'cs') continue; // panel rows of their own
      expect(screen.queryByText(awardStatLabel(category))).not.toBeInTheDocument();
    }
  });
});
