import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  MYSTERY_BLAME,
  MYSTERY_COMMUNITY,
  MYSTERY_EMPTY,
  MYSTERY_FIRST,
  MYSTERY_WHO,
} from '@/lib/mystery/copy';
import type { MysteryPageState } from '@/lib/mystery/service';
import type { MysteryPlayView, MysteryResultView } from '@/lib/mystery/types';
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

describe('MysteryView', () => {
  it('shows the crime and names, and hides community numbers before a guess', () => {
    const state: MysteryPageState = { kind: 'play', play };
    render(<MysteryView state={state} />);

    expect(screen.getByText('2 / 11 / 4')).toBeInTheDocument();
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

  it('says when there is not yet a custom to expose', () => {
    const state: MysteryPageState = {
      kind: 'empty',
      empty: { empty: true, expiresAt: '2026-09-13T21:00:00.000Z' },
    };
    render(<MysteryView state={state} />);
    expect(screen.getByText(MYSTERY_EMPTY)).toBeInTheDocument();
  });
});
