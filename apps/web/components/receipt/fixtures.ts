import type { Assignment, Calibration, Role } from '@customs/core';
import type { RatingsBefore, ReceiptNames, StoredSplit } from './types';

/**
 * Receipt fixtures for the kit and the component tests: the prototype's night (Direction C,
 * game 4), with the design system's test names (05-design.md 6.14). Not used by any page.
 */

const P = {
  fox: 'p-foxhound',
  xeta: 'p-xeta',
  ramzy: 'p-ramzy',
  sugar: 'p-sugarpapy',
  tahm: 'p-used2be',
  hard: 'p-h4rdc0r33',
  axes: 'p-syndrome',
  knifiy: 'p-knifiy',
  khokha: 'p-khokha',
  shadow: 'p-shadow',
} as const;

export const FIXTURE_NAMES: ReceiptNames = {
  [P.fox]: 'FoxHound',
  [P.xeta]: 'XETA',
  [P.ramzy]: 'Ramzyinhović',
  [P.sugar]: 'SugarPapy',
  [P.tahm]: 'Used2BeATahmMain',
  [P.hard]: 'H4RDC0R33',
  [P.axes]: 'Syndrome Axes',
  [P.knifiy]: 'knifiy',
  [P.khokha]: 'PRT Khokha',
  [P.shadow]: 'TheSHADOWREAPER',
};

/** Every seat a 16-character all-caps name (05-design.md 6.14). */
export const LONG_NAMES: ReceiptNames = Object.fromEntries(
  Object.keys(FIXTURE_NAMES).map((puuid, i) => [puuid, `WWWWWWWWWWWWWWW${i}`]),
);

const roles: Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const side = (...puuids: string[]): Assignment[] =>
  puuids.map((puuid, i) => ({ puuid, role: roles[i] as Role }));

const BLUE_1 = side(P.fox, P.xeta, P.ramzy, P.sugar, P.tahm);
const RED_1 = side(P.hard, P.axes, P.knifiy, P.khokha, P.shadow);

/** #1, in play: Red 51%, gap 45, everyone on a main role. */
export const SPLIT_1: StoredSplit = {
  rank: 1,
  isChosen: true,
  blueWinProb: 0.49,
  gap: 45,
  offRoleCount: 0,
  blue: BLUE_1,
  red: RED_1,
  explanation:
    'Red favored 51%. Everyone on a main role. Gap 45. Next best: swap SugarPapy and PRT Khokha, gap 93.',
};

/** #2: the adc players swap. Blue 52%, a bigger gap. */
export const SPLIT_2: StoredSplit = {
  rank: 2,
  isChosen: false,
  blueWinProb: 0.52,
  gap: 93,
  offRoleCount: 0,
  blue: side(P.fox, P.xeta, P.ramzy, P.khokha, P.tahm),
  red: side(P.hard, P.axes, P.knifiy, P.sugar, P.shadow),
  explanation:
    'Blue favored 52%. Everyone on a main role. Gap 93. Next best: swap XETA and knifiy, gap 31 with 2 off-role.',
};

/** #3: XETA (jungle) and knifiy (mid) swap, two off-role. 50–50: closer odds than #1. */
export const SPLIT_3: StoredSplit = {
  rank: 3,
  isChosen: false,
  blueWinProb: 0.5,
  gap: 31,
  offRoleCount: 2,
  blue: [
    { puuid: P.fox, role: 'top' },
    { puuid: P.knifiy, role: 'jungle' },
    { puuid: P.ramzy, role: 'mid' },
    { puuid: P.sugar, role: 'adc' },
    { puuid: P.tahm, role: 'support' },
  ],
  red: [
    { puuid: P.hard, role: 'top' },
    { puuid: P.axes, role: 'jungle' },
    { puuid: P.xeta, role: 'mid' },
    { puuid: P.khokha, role: 'adc' },
    { puuid: P.shadow, role: 'support' },
  ],
  explanation: 'Even 50%. XETA and knifiy off-role. Gap 31.',
};

export const THREE_SPLITS: readonly StoredSplit[] = [SPLIT_1, SPLIT_2, SPLIT_3];

/** After one reroll: #2 in play. */
export const REROLLED: readonly StoredSplit[] = [
  { ...SPLIT_1, isChosen: false },
  { ...SPLIT_2, isChosen: true },
  SPLIT_3,
];

/** The runner-up has closer odds than the one in play (54 vs 51): the reason line must say why. */
export const CLOSER_RUNNER_UP: readonly StoredSplit[] = [
  {
    ...SPLIT_1,
    blueWinProb: 0.54,
    gap: 60,
    explanation:
      'Blue favored 54%. Everyone on a main role. Gap 60. Next best: swap XETA and knifiy, gap 40 with 2 off-role.',
  },
  { ...SPLIT_3, rank: 2, blueWinProb: 0.51, gap: 40, offRoleCount: 2 },
];

/** A lopsided ten: the best split is still 65%. */
export const CLEAR: readonly StoredSplit[] = [
  {
    ...SPLIT_1,
    blueWinProb: 0.65,
    gap: 210,
    explanation:
      'Blue favored 65%. Everyone on a main role. Gap 210. Next best: swap SugarPapy and PRT Khokha, gap 260.',
  },
  { ...SPLIT_2, blueWinProb: 0.68, gap: 260 },
];

/** Duo locks left one split. */
export const ONLY_ONE: readonly StoredSplit[] = [
  {
    ...SPLIT_1,
    blueWinProb: 0.56,
    gap: 120,
    explanation: 'Blue favored 56%. Everyone on a main role. Gap 120.',
  },
];

/** Same columns, nonsense explanation: nothing on the receipt may move. */
export const GARBAGE_EXPLANATION: readonly StoredSplit[] = THREE_SPLITS.map((s) => ({
  ...s,
  explanation: 'Red favored 99%. Gap 9999. Next best: swap Nobody and Someone. }{ <b>not html</b>',
}));

export const CALIBRATION_READY: Calibration = { n: 103, favoredWon: 58, actualPct: 56, expectedPct: 55 };
export const CALIBRATION_EARLY: Calibration = { n: 7, favoredWon: 5, actualPct: 71, expectedPct: 54 };

export const RATINGS_KNOWN: RatingsBefore = {
  blue: [
    { mu: 22, sigma: 3 },
    { mu: 24, sigma: 3 },
    { mu: 30, sigma: 2.5 },
    { mu: 21, sigma: 3 },
    { mu: 23, sigma: 4 },
  ],
  red: [
    { mu: 21, sigma: 3 },
    { mu: 27, sigma: 2.5 },
    { mu: 24, sigma: 3 },
    { mu: 22, sigma: 3 },
    { mu: 21, sigma: 6 },
  ],
};

export const RATINGS_MISSING: RatingsBefore = {
  blue: RATINGS_KNOWN.blue,
  red: [...RATINGS_KNOWN.red.slice(0, 4), { mu: null, sigma: null }],
};
