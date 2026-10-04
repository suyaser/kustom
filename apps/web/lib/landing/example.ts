import type { Assignment, Role } from '@customs/core';
import type { ReceiptNames, StoredSplit } from '@/components/receipt/types';

/**
 * The worked example from docs/00-product.md ("Ten friends are in the lobby on an ordinary
 * Tuesday"): the landing page's receipt when the demo group has no rolled game to show
 * (STRATEGY §2.3). Split 1 is the doc's, split 2 the Hana-and-Omar swap it names, split 3 the
 * Karim-and-Nadia swap from STRATEGY §4.6's table. Not a real game, and the caption says so.
 */

const ROLES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const team = (...puuids: string[]): Assignment[] =>
  puuids.map((puuid, i) => ({ puuid, role: ROLES[i] as Role }));

export const EXAMPLE_NAMES: ReceiptNames = {
  'ex-hana': 'Hana',
  'ex-iris': 'Iris',
  'ex-karim': 'Karim',
  'ex-bilal': 'Bilal',
  'ex-theo': 'Theo',
  'ex-omar': 'Omar',
  'ex-rami': 'Rami',
  'ex-nadia': 'Nadia',
  'ex-lena': 'Lena',
  'ex-yuki': 'Yuki',
};

export const EXAMPLE_SPLITS: readonly StoredSplit[] = [
  {
    rank: 1,
    isChosen: true,
    blueWinProb: 0.54,
    gap: 100,
    offRoleCount: 0,
    blue: team('ex-hana', 'ex-iris', 'ex-karim', 'ex-bilal', 'ex-theo'),
    red: team('ex-omar', 'ex-rami', 'ex-nadia', 'ex-lena', 'ex-yuki'),
    explanation:
      'Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
  },
  {
    rank: 2,
    isChosen: false,
    blueWinProb: 0.57,
    gap: 170,
    offRoleCount: 0,
    blue: team('ex-omar', 'ex-iris', 'ex-karim', 'ex-bilal', 'ex-theo'),
    red: team('ex-hana', 'ex-rami', 'ex-nadia', 'ex-lena', 'ex-yuki'),
    explanation: 'Blue favored 57%. Everyone on a main role. Gap 170.',
  },
  {
    rank: 3,
    isChosen: false,
    blueWinProb: 0.48,
    gap: 220,
    offRoleCount: 0,
    blue: team('ex-hana', 'ex-iris', 'ex-nadia', 'ex-bilal', 'ex-theo'),
    red: team('ex-omar', 'ex-rami', 'ex-karim', 'ex-lena', 'ex-yuki'),
    explanation: 'Red favored 52%. Everyone on a main role. Gap 220.',
  },
];
