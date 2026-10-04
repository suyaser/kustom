import type { WeekNotesInput, WeekNotesPlayer } from '../og/weekNotes';

/**
 * The research week (`redesign/research/patch-image.md` §5, the 05-design 10.6 roster): 14 rated
 * games over 4 nights, a first night, a record, nine first picks, two rule runs and Fearless. Every
 * puuid starts `puuid-` so a test can prove none reaches a model or a PNG's text.
 */
export function weekPlayer(overrides: Partial<WeekNotesPlayer> & { name: string }): WeekNotesPlayer {
  return {
    puuid: `puuid-${overrides.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    nameSuffix: null,
    points: 0,
    wins: 2,
    losses: 2,
    games: 4,
    ratedGames: 40,
    settling: false,
    role: 'mid',
    ...overrides,
  };
}

export const WEEK_PLAYERS: WeekNotesPlayer[] = [
  weekPlayer({ name: 'Ramzyinhović', role: 'mid', points: 212, wins: 5, losses: 2, games: 7 }),
  weekPlayer({ name: 'Syndrome Axes', role: 'jungle', points: 140, wins: 6, losses: 3, games: 9 }),
  weekPlayer({ name: 'knifiy', role: 'mid', points: 88, wins: 4, losses: 3, games: 7 }),
  weekPlayer({ name: 'XETA', role: 'jungle', points: 41, wins: 3, losses: 3, games: 6 }),
  weekPlayer({ name: 'H4RDC0R33', role: 'top', points: 30, wins: 4, losses: 4, games: 8 }),
  weekPlayer({ name: 'PRT Khokha', role: 'adc', points: 12, wins: 3, losses: 3, games: 6 }),
  weekPlayer({ name: 'FoxHound', role: 'top', points: -18, wins: 2, losses: 3, games: 5 }),
  weekPlayer({ name: 'SugarPapy', role: 'adc', points: -44, wins: 2, losses: 4, games: 6 }),
  weekPlayer({ name: 'TheSHADOWREAPER', role: 'support', points: -61, wins: 1, losses: 3, games: 4 }),
  weekPlayer({
    name: 'Chaos',
    role: 'support',
    points: -96,
    wins: 1,
    losses: 4,
    games: 5,
    ratedGames: 5,
    settling: true,
  }),
];

export function weekInput(overrides: Partial<WeekNotesInput> = {}): WeekNotesInput {
  return {
    group: 'Customs Night',
    weekNumber: 12,
    range: 'Sunday 27 Sep to Saturday 3 Oct',
    games: 14,
    nights: 4,
    players: WEEK_PLAYERS,
    firstNights: [{ puuid: 'puuid-chaos', day: 'Tuesday' }],
    records: [
      {
        title: 'Most damage',
        puuid: 'puuid-syndromeaxes',
        name: 'Syndrome Axes',
        valueLabel: '48,213 damage',
      },
    ],
    firstPicks: ['Smolder', 'Aurora', 'Ambessa', 'Mel', 'Yunara', 'Hwei', 'Briar', 'Naafiri', 'Milio'],
    modes: [
      { name: 'Tanks only', count: 2, rated: true },
      { name: 'Ionia vs Noxus', count: 1, rated: false },
    ],
    fearless: { total: 34, added: 12, open: 138 },
    awards: [
      { label: 'Best off-role', line: 'XETA · 4W 1L · 80% · their main is jungle' },
      { label: 'Cursed duo', line: 'FoxHound and SugarPapy · 1W 5L · 17%' },
    ],
    settlingGames: 10,
    ...overrides,
  };
}
