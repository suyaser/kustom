import type { YouVersusRow } from '../versus/you';

/** Sample You-vs-them rows for the dev kit (M14.35): the prototype's three, one long name. */
export const KIT_VERSUS: YouVersusRow[] = [
  {
    them: { puuid: 'kit-lux', name: 'Lux Aeterna' },
    together: { wins: 12, losses: 3 },
    against: { wins: 5, losses: 5 },
    lanes: [],
    games: 25,
  },
  {
    them: { puuid: 'kit-baron', name: 'Baron Nashor Lover' },
    together: { wins: 9, losses: 3 },
    against: { wins: 2, losses: 6 },
    lanes: [{ role: 'top', you: 1, them: 4 }],
    games: 20,
  },
  {
    them: { puuid: 'kit-used', name: 'Used2BeATahmMain' },
    together: { wins: 4, losses: 6 },
    against: { wins: 7, losses: 1 },
    lanes: [{ role: 'mid', you: 4, them: 1 }],
    games: 18,
  },
];
