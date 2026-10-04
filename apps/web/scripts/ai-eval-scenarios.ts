import type { RoleValue } from '@customs/db';
import type { GameFactsInput, GameHistoryInput, PlayerFactsInput, WeekFactsInput } from '../lib/ai/facts.ts';

/**
 * M16.8: the eval's game set when the local stack has no real games (it holds test seeds only).
 * One game is real -- `packages/lcu/fixtures/16.17/match-detail.json`, a ten-human custom of
 * this group, read as ingest would store it -- and the rest are scenarios shaped like this
 * group's customs (bloody, long, everyone on a main), one per situation a recap has to handle:
 * stomp, close, an MVP on the losing side, a deathless carry, a support game, an upset, ARAM, a
 * surrender, a marathon, ties, opt-outs, and the history facts (streaks, firsts, personal bests).
 * Names are the real roster's, so the report reads like Discord; the stats of every game but the
 * first are invented. Dev-only: nothing in the app imports this.
 */

export const ROSTER = [
  'XETA',
  'Raafat',
  'PRT Khokha',
  'FoxHound',
  '1sec Reloading',
  'xXDarkExodiaXx',
  'Menaçe',
  'PRT Empty',
  'Ramzyinhović',
  'Rano of Zaun',
] as const;

export const rosterId = (index: number): string => `eval-player-${index}`;
export const nameOfEvalPlayer = (id: string): string | null => {
  const index = Number(id.replace('eval-player-', ''));
  return Number.isInteger(index) ? (ROSTER[index] ?? null) : null;
};

const ROLES: readonly RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];

type SeatSpec = [champion: string, kda: string, cs: number, damage: number, vision: number | null];

export interface EvalScenario {
  label: string;
  real: boolean;
  input: GameFactsInput;
  /** Players (roster indexes) who opted out. */
  optedOut?: number[];
}

/**
 * Ten seats: blue's five in role order then red's five. `order` remaps who sits where (roster
 * index per seat), so every scenario is not the same ten in the same chairs.
 */
function game(input: {
  label: string;
  real?: boolean;
  minutes: number;
  winner: 100 | 200;
  upset?: boolean;
  aram?: boolean;
  seats: SeatSpec[];
  order?: number[];
  history?: Record<number, GameHistoryInput>;
  optedOut?: number[];
}): EvalScenario {
  const order = input.order ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return {
    label: input.label,
    real: input.real ?? false,
    ...(input.optedOut === undefined ? {} : { optedOut: input.optedOut }),
    input: {
      gameId: `eval-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      aram: input.aram ?? false,
      durationS: input.minutes * 60 + 17,
      winningSide: input.winner,
      upset: input.upset ?? false,
      seats: input.seats.map(([champion, kda, cs, damage, vision], seat) => {
        const [kills, deaths, assists] = kda.split('/').map(Number) as [number, number, number];
        const index = order[seat] as number;
        const history = input.history?.[index];
        return {
          playerId: rosterId(index),
          side: seat < 5 ? 100 : 200,
          role: input.aram ? null : (ROLES[seat % 5] as RoleValue),
          champion,
          kills,
          deaths,
          assists,
          cs,
          damageToChamps: damage,
          visionScore: vision,
          ...(history === undefined ? {} : { history }),
        };
      }),
    },
  };
}

export const SCENARIOS: readonly EvalScenario[] = [
  game({
    label: 'Real: the 49-minute bloodbath (match-detail fixture)',
    real: true,
    minutes: 48,
    winner: 200,
    seats: [
      ['Ornn', '7/10/19', 245, 36779, 18],
      ['Jarvan IV', '12/20/35', 183, 46533, 29],
      ['Malzahar', '18/10/24', 302, 78641, 53],
      ['Draven', '28/22/17', 228, 78836, 8],
      ['Seraphine', '8/14/41', 90, 50037, 90],
      ['Illaoi', '18/9/20', 281, 84408, 18],
      ['Jax', '16/9/12', 284, 47188, 63],
      ['Akali', '15/17/12', 176, 51647, 24],
      ['Veigar', '24/19/16', 294, 119045, 40],
      ['Viktor', '3/19/17', 76, 40888, 110],
    ],
  }),
  game({
    label: 'Stomp: 22 minutes, 38 to 9',
    minutes: 22,
    winner: 100,
    order: [3, 7, 1, 9, 5, 0, 2, 4, 6, 8],
    seats: [
      ['Darius', '8/1/6', 151, 17320, 11],
      ['Lee Sin', '12/0/9', 132, 19804, 21],
      ['Ahri', '9/2/11', 178, 21477, 14],
      ['Jinx', '7/3/10', 190, 18210, 9],
      ['Thresh', '2/3/24', 31, 6420, 47],
      ['Garen', '2/7/1', 120, 8790, 6],
      ['Vi', '3/8/2', 98, 9012, 13],
      ['Zed', '2/9/3', 141, 11260, 8],
      ['Ezreal', '1/7/4', 150, 9801, 7],
      ['Nami', '1/7/5', 18, 4120, 30],
    ],
  }),
  game({
    label: 'Close: 41 minutes, 31 to 30, red wins',
    minutes: 41,
    winner: 200,
    order: [8, 2, 6, 0, 4, 1, 5, 9, 3, 7],
    seats: [
      ['Malphite', '4/6/14', 221, 22104, 24],
      ["Kha'Zix", '9/7/8', 201, 27330, 30],
      ['Orianna', '7/5/13', 276, 33980, 22],
      ['Caitlyn', '8/6/9', 301, 31544, 15],
      ['Leona', '2/7/20', 47, 9870, 71],
      ['Sett', '6/5/12', 230, 25412, 19],
      ['Vi', '7/6/15', 188, 21877, 33],
      ['Yasuo', '10/8/9', 262, 36210, 17],
      ["Kai'Sa", '6/7/13', 289, 30116, 12],
      ['Blitzcrank', '2/5/22', 44, 8312, 66],
    ],
  }),
  game({
    label: 'MVP on the losing side: losing mid had the most kills and damage',
    minutes: 33,
    winner: 100,
    order: [5, 1, 9, 6, 0, 4, 8, 2, 7, 3],
    seats: [
      ['Garen', '6/4/7', 199, 18922, 12],
      ['Jarvan IV', '7/5/12', 160, 17105, 26],
      ['Lux', '5/5/14', 210, 24870, 19],
      ['Jhin', '9/4/8', 240, 23011, 13],
      ['Nami', '1/6/21', 29, 7012, 52],
      ['Ornn', '2/6/8', 188, 14320, 15],
      ['Lee Sin', '3/7/9', 141, 13870, 22],
      ['Akali', '15/4/4', 231, 38421, 11],
      ['Ezreal', '4/6/9', 212, 20130, 10],
      ['Thresh', '0/5/14', 33, 5480, 49],
    ],
  }),
  game({
    label: 'Deathless carry: winning ADC 14/0/9',
    minutes: 29,
    winner: 200,
    order: [2, 0, 4, 8, 6, 7, 3, 5, 1, 9],
    seats: [
      ['Darius', '3/6/2', 170, 14550, 10],
      ['Vi', '2/7/5', 130, 11001, 18],
      ['Zed', '6/5/3', 181, 19870, 9],
      ['Caitlyn', '3/6/4', 200, 15420, 11],
      ['Leona', '1/5/8', 25, 5140, 41],
      ['Sett', '5/2/11', 190, 17320, 14],
      ["Kha'Zix", '7/3/12', 151, 18760, 25],
      ['Orianna', '5/4/14', 219, 22105, 18],
      ['Jinx', '14/0/9', 248, 29880, 12],
      ['Nami', '1/3/26', 21, 6005, 58],
    ],
  }),
  game({
    label: 'Support game: winning support 2/3/31, vision 98',
    minutes: 37,
    winner: 100,
    order: [6, 3, 0, 2, 9, 1, 4, 7, 8, 5],
    seats: [
      ['Malphite', '3/5/18', 210, 16880, 20],
      ['Vi', '8/6/17', 171, 20114, 31],
      ['Ahri', '11/4/13', 245, 31207, 16],
      ['Ezreal', '10/5/14', 262, 28770, 14],
      ['Thresh', '2/3/31', 38, 8710, 98],
      ['Darius', '6/8/5', 201, 21445, 9],
      ['Lee Sin', '5/7/9', 160, 17321, 27],
      ['Yasuo', '7/6/4', 230, 25430, 10],
      ['Jhin', '5/7/8', 244, 24880, 12],
      ['Leona', '1/6/14', 40, 6520, 61],
    ],
  }),
  game({
    label: 'Upset: the underdog side won in 27 minutes',
    minutes: 27,
    winner: 200,
    upset: true,
    order: [4, 8, 3, 6, 2, 9, 0, 1, 5, 7],
    seats: [
      ['Garen', '4/5/3', 150, 13320, 8],
      ["Kha'Zix", '5/6/4', 120, 14410, 19],
      ['Orianna', '3/5/7', 180, 16120, 12],
      ["Kai'Sa", '6/6/3', 177, 15890, 9],
      ['Blitzcrank', '0/6/10', 22, 4012, 37],
      ['Sett', '7/3/8', 170, 16211, 10],
      ['Jarvan IV', '6/2/13', 140, 13580, 24],
      ['Lux', '8/4/10', 182, 23104, 15],
      ['Jinx', '7/4/6', 191, 17770, 8],
      ['Nami', '1/5/19', 18, 5240, 44],
    ],
  }),
  game({
    label: 'ARAM: 18 minutes, 52 to 41',
    minutes: 18,
    winner: 100,
    aram: true,
    order: [1, 3, 5, 7, 9, 0, 2, 4, 6, 8],
    seats: [
      ['Veigar', '13/6/21', 41, 38120, null],
      ['Jax', '9/8/19', 38, 24410, null],
      ['Seraphine', '4/7/33', 22, 21060, null],
      ['Draven', '17/9/14', 47, 33870, null],
      ['Malphite', '9/11/28', 35, 19980, null],
      ['Lux', '11/10/20', 30, 31220, null],
      ['Yasuo', '8/12/11', 44, 22090, null],
      ['Sett', '10/11/17', 39, 25471, null],
      ['Jhin', '7/9/18', 41, 23110, null],
      ['Leona', '5/10/24', 19, 12030, null],
    ],
  }),
  game({
    label: 'Surrender at 16 minutes',
    minutes: 16,
    winner: 200,
    order: [9, 6, 2, 3, 0, 8, 5, 1, 4, 7],
    seats: [
      ['Darius', '1/4/1', 98, 5420, 5],
      ['Vi', '1/5/2', 80, 4870, 9],
      ['Ahri', '2/3/1', 110, 7104, 6],
      ['Caitlyn', '0/4/2', 118, 5512, 4],
      ['Thresh', '0/4/3', 12, 2012, 20],
      ['Malphite', '3/1/6', 101, 6210, 7],
      ['Lee Sin', '6/0/7', 84, 8870, 14],
      ['Zed', '5/1/5', 120, 9420, 6],
      ['Jinx', '5/1/6', 125, 8120, 5],
      ['Nami', '1/1/13', 9, 2410, 22],
    ],
  }),
  game({
    label: 'Marathon: 52 minutes, farm everywhere',
    minutes: 52,
    winner: 100,
    order: [0, 5, 8, 1, 3, 7, 9, 6, 2, 4],
    seats: [
      ['Ornn', '5/9/22', 342, 41120, 38],
      ['Jarvan IV', '10/11/25', 251, 39870, 51],
      ['Orianna', '12/8/24', 412, 61230, 33],
      ["Kai'Sa", '16/9/18', 455, 68120, 21],
      ['Leona', '3/12/34', 61, 18430, 112],
      ['Darius', '9/10/12', 360, 48210, 25],
      ["Kha'Zix", '13/12/14', 247, 42120, 44],
      ['Akali', '14/11/12', 371, 55120, 22],
      ['Jhin', '11/12/16', 430, 57040, 26],
      ['Blitzcrank', '2/13/30', 55, 14320, 96],
    ],
  }),
  game({
    label: 'A tie for most kills, winning top with zero kills',
    minutes: 31,
    winner: 200,
    order: [7, 4, 1, 8, 3, 2, 9, 0, 6, 5],
    seats: [
      ['Garen', '6/5/4', 201, 19870, 10],
      ['Vi', '9/6/6', 161, 18120, 23],
      ['Lux', '4/5/11', 199, 22180, 17],
      ['Ezreal', '5/6/7', 220, 21040, 12],
      ['Nami', '0/6/15', 25, 6120, 46],
      ['Malphite', '0/3/21', 188, 12010, 18],
      ['Lee Sin', '9/4/12', 154, 20880, 30],
      ['Yasuo', '8/5/9', 221, 27410, 11],
      ['Jinx', '9/7/10', 240, 25120, 10],
      ['Thresh', '1/5/22', 28, 6900, 57],
    ],
  }),
  game({
    label: 'Winners carried a 0/9 teammate',
    minutes: 34,
    winner: 100,
    order: [2, 9, 7, 5, 1, 6, 3, 8, 0, 4],
    seats: [
      ['Sett', '0/9/4', 160, 11200, 9],
      ["Kha'Zix", '13/4/7', 170, 26120, 22],
      ['Zed', '11/5/6', 210, 29470, 10],
      ['Jinx', '10/4/9', 246, 27110, 11],
      ['Leona', '1/5/25', 30, 7210, 55],
      ['Darius', '9/6/5', 205, 24210, 10],
      ['Vi', '5/7/9', 150, 15120, 26],
      ['Ahri', '6/8/7', 211, 22140, 15],
      ['Caitlyn', '7/7/6', 230, 21880, 11],
      ['Blitzcrank', '0/7/14', 22, 5410, 41],
    ],
  }),
  game({
    label: 'Fewer kills, still won (blue 24, red 29)',
    minutes: 39,
    winner: 100,
    order: [5, 0, 3, 9, 8, 4, 1, 2, 6, 7],
    seats: [
      ['Ornn', '2/6/12', 250, 23110, 22],
      ['Jarvan IV', '6/7/10', 190, 22340, 35],
      ['Orianna', '7/5/9', 290, 33410, 21],
      ['Jhin', '8/5/8', 301, 31210, 14],
      ['Nami', '1/6/18', 35, 9120, 70],
      ['Garen', '8/5/6', 230, 26120, 12],
      ['Lee Sin', '7/6/13', 170, 21880, 29],
      ['Yasuo', '6/7/9', 251, 28440, 13],
      ["Kai'Sa", '7/5/11', 277, 30120, 11],
      ['Thresh', '1/5/21', 30, 7120, 62],
    ],
  }),
  game({
    label: 'Opt-outs: three players opted out',
    minutes: 30,
    winner: 200,
    optedOut: [1, 6, 8],
    seats: [
      ['Darius', '4/6/5', 180, 17210, 11],
      ['Vi', '5/7/6', 140, 15120, 22],
      ['Lux', '6/5/8', 200, 23040, 16],
      ['Caitlyn', '5/6/6', 221, 19870, 10],
      ['Thresh', '1/5/14', 26, 6010, 49],
      ['Malphite', '3/3/15', 190, 14010, 16],
      ["Kha'Zix", '11/3/9', 160, 24310, 25],
      ['Ahri', '7/5/12', 221, 26120, 14],
      ['Jinx', '8/6/10', 240, 25210, 9],
      ['Leona', '2/4/24', 30, 7430, 58],
    ],
  }),
  game({
    label: 'History: a 4-game win streak, a first champion, a personal best',
    minutes: 32,
    winner: 100,
    order: [3, 1, 5, 7, 9, 0, 2, 4, 6, 8],
    history: {
      1: { winStreak: 4, firstOnChampion: false, personalBests: [] },
      5: { winStreak: null, firstOnChampion: true, personalBests: ['kills'] },
      7: { winStreak: 3, firstOnChampion: false, personalBests: [] },
      4: { winStreak: null, firstOnChampion: false, personalBests: ['damage'] },
    },
    seats: [
      ['Darius', '6/4/8', 188, 19820, 12],
      ['Lee Sin', '8/3/11', 151, 18870, 26],
      ['Kassadin', '13/3/9', 221, 32100, 14],
      ['Jinx', '9/5/10', 240, 26810, 10],
      ['Thresh', '1/6/26', 31, 7210, 54],
      ['Sett', '5/6/4', 201, 21120, 10],
      ['Vi', '3/8/7', 140, 14210, 25],
      ['Zed', '6/7/3', 210, 34870, 10],
      ['Ezreal', '4/7/7', 221, 20120, 9],
      ['Nami', '1/8/12', 22, 5480, 44],
    ],
  }),
  game({
    label: 'History: the losing jungler set a personal best, a winner on their first Yasuo',
    minutes: 36,
    winner: 200,
    order: [8, 6, 4, 2, 0, 9, 7, 5, 3, 1],
    history: {
      6: { winStreak: null, firstOnChampion: false, personalBests: ['assists'] },
      7: { winStreak: null, firstOnChampion: true, personalBests: [] },
      9: { winStreak: 5, firstOnChampion: false, personalBests: [] },
    },
    seats: [
      ['Garen', '5/6/7', 210, 20120, 12],
      ['Vi', '6/7/24', 160, 19210, 31],
      ['Ahri', '6/6/10', 230, 25120, 15],
      ['Caitlyn', '5/6/8', 251, 22140, 11],
      ['Leona', '1/6/19', 30, 7120, 60],
      ['Malphite', '4/4/18', 201, 16210, 18],
      ['Lee Sin', '8/5/14', 170, 22310, 29],
      ['Yasuo', '10/6/8', 240, 30120, 12],
      ['Jhin', '9/5/11', 262, 28870, 13],
      ['Blitzcrank', '2/4/25', 28, 6800, 63],
    ],
  }),
];

/**
 * Three closed weeks for the storyline (M16.5), shaped like `weekFactsFromPost`'s output: the
 * board in net-points order (M14.57), positive net points, the longest win streak, and the one
 * award the storyline may name (`Best off-role`). Invented numbers, the real roster's names.
 */
export interface EvalWeek {
  label: string;
  week: WeekFactsInput;
  optedOut?: number[];
}

function board(rows: [index: number, games: number, wins: number, points: number][]) {
  return {
    board: rows.map(([index, games, wins]) => ({ playerId: rosterId(index), games, wins })),
    climbs: rows
      .filter(([, , , points]) => points > 0)
      .map(([index, , , points]) => ({ playerId: rosterId(index), climb: points })),
  };
}

export const WEEK_SCENARIOS: readonly EvalWeek[] = [
  {
    label: 'Week: a runaway leader on a 6-game streak',
    week: {
      weekStart: '2026-09-13',
      ratedGames: 24,
      ...board([
        [8, 18, 14, 212],
        [2, 20, 13, 141],
        [5, 15, 9, 64],
        [0, 22, 12, 30],
        [6, 12, 6, 4],
        [3, 19, 8, -60],
        [1, 21, 9, -95],
      ]),
      streaks: [{ playerId: rosterId(8), wins: 6 }],
      awards: [{ label: 'Best off-role', playerId: rosterId(5), value: null, unit: null }],
    },
  },
  {
    label: 'Week: a tight race at the top, a quiet week',
    week: {
      weekStart: '2026-09-20',
      ratedGames: 11,
      ...board([
        [4, 9, 6, 58],
        [7, 8, 5, 52],
        [9, 10, 6, 49],
        [2, 11, 5, -12],
        [0, 9, 4, -30],
      ]),
      streaks: [{ playerId: rosterId(7), wins: 4 }],
      awards: [],
    },
  },
  {
    label: 'Week: the leader opted out, a newcomer climbs',
    optedOut: [1],
    week: {
      weekStart: '2026-09-27',
      ratedGames: 19,
      ...board([
        [1, 17, 12, 160],
        [9, 6, 5, 118],
        [3, 16, 10, 77],
        [6, 18, 9, 21],
        [5, 15, 7, -40],
      ]),
      streaks: [
        { playerId: rosterId(9), wins: 5 },
        { playerId: rosterId(1), wins: 5 },
      ],
      awards: [{ label: 'Best off-role', playerId: rosterId(3), value: null, unit: null }],
    },
  },
];

/**
 * Five regulars for the scouting report (M16.6), shaped like `scoutingInputOf`'s output. Invented
 * numbers, the real roster's names.
 */
export interface EvalPlayer {
  label: string;
  player: PlayerFactsInput;
}

const P_WEEK = '2026-09-27';

export const PLAYER_SCENARIOS: readonly EvalPlayer[] = [
  {
    label: 'Player: a Lee Sin one-trick jungler',
    player: {
      playerId: rosterId(1),
      weekStart: P_WEEK,
      ratedGames: 64,
      wins: 38,
      weekGames: 9,
      weekWins: 6,
      champions: [
        { name: 'Lee Sin', games: 31, wins: 21 },
        { name: 'Vi', games: 9, wins: 4 },
        { name: 'Jarvan IV', games: 6, wins: 4 },
        { name: 'Kindred', games: 3, wins: 1 },
      ],
      roles: [
        { role: 'jungle', games: 55, wins: 34 },
        { role: 'top', games: 6, wins: 3 },
        { role: 'mid', games: 3, wins: 1 },
      ],
    },
  },
  {
    label: 'Player: a flex player with no main',
    player: {
      playerId: rosterId(2),
      weekStart: P_WEEK,
      ratedGames: 41,
      wins: 21,
      weekGames: 7,
      weekWins: 4,
      champions: [
        { name: 'Ahri', games: 5, wins: 3 },
        { name: 'Darius', games: 4, wins: 2 },
        { name: 'Ezreal', games: 4, wins: 2 },
        { name: 'Thresh', games: 3, wins: 2 },
      ],
      roles: [
        { role: 'mid', games: 12, wins: 7 },
        { role: 'top', games: 11, wins: 5 },
        { role: 'adc', games: 10, wins: 5 },
        { role: 'support', games: 8, wins: 4 },
      ],
    },
  },
  {
    label: 'Player: a support on a hot week',
    player: {
      playerId: rosterId(4),
      weekStart: P_WEEK,
      ratedGames: 52,
      wins: 30,
      weekGames: 7,
      weekWins: 6,
      champions: [
        { name: 'Nami', games: 18, wins: 12 },
        { name: 'Thresh', games: 14, wins: 7 },
        { name: 'Leona', games: 8, wins: 5 },
      ],
      roles: [{ role: 'support', games: 47, wins: 28 }],
    },
  },
  {
    label: 'Player: a losing record, still a regular',
    player: {
      playerId: rosterId(7),
      weekStart: P_WEEK,
      ratedGames: 38,
      wins: 14,
      weekGames: 8,
      weekWins: 2,
      champions: [
        { name: 'Yasuo', games: 15, wins: 5 },
        { name: 'Zed', games: 7, wins: 3 },
      ],
      roles: [
        { role: 'mid', games: 26, wins: 10 },
        { role: 'top', games: 9, wins: 3 },
      ],
    },
  },
  {
    label: 'Player: just settled, 11 games',
    player: {
      playerId: rosterId(9),
      weekStart: P_WEEK,
      ratedGames: 11,
      wins: 6,
      weekGames: 5,
      weekWins: 3,
      champions: [
        { name: 'Malphite', games: 5, wins: 3 },
        { name: 'Garen', games: 2, wins: 1 },
      ],
      roles: [{ role: 'top', games: 9, wins: 5 }],
    },
  },
];
