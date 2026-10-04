import type { GameFactsInput, PlayerFactsInput, WeekFactsInput } from '@/lib/ai/facts';

/**
 * M16.3 fixtures: one finished game, one closed week and one player, shaped like what the
 * loaders hand the fact builder, plus the identities the request bodies must never carry. Tests
 * only: nothing in the app imports this.
 */

export const AI_GROUP_ID = '20000000-0000-4000-8000-000000000001';
export const AI_GAME_ID = '30000000-0000-4000-8000-000000000001';

/** Ten players: id, the PUUID and names the site knows them by. None may reach a prompt. */
export const AI_PLAYERS = [
  { id: '40000000-0000-4000-8000-000000000001', puuid: 'a1b2c3d4-0001-4000-8000-0000000000aa', name: 'Sami' },
  {
    id: '40000000-0000-4000-8000-000000000002',
    puuid: 'a1b2c3d4-0002-4000-8000-0000000000aa',
    name: 'Nadia',
  },
  { id: '40000000-0000-4000-8000-000000000003', puuid: 'a1b2c3d4-0003-4000-8000-0000000000aa', name: 'Omar' },
  {
    id: '40000000-0000-4000-8000-000000000004',
    puuid: 'a1b2c3d4-0004-4000-8000-0000000000aa',
    name: 'Layla',
  },
  {
    id: '40000000-0000-4000-8000-000000000005',
    puuid: 'a1b2c3d4-0005-4000-8000-0000000000aa',
    name: 'Karim',
  },
  {
    id: '40000000-0000-4000-8000-000000000006',
    puuid: 'a1b2c3d4-0006-4000-8000-0000000000aa',
    name: 'Youssef',
  },
  { id: '40000000-0000-4000-8000-000000000007', puuid: 'a1b2c3d4-0007-4000-8000-0000000000aa', name: 'Hana' },
  {
    id: '40000000-0000-4000-8000-000000000008',
    puuid: 'a1b2c3d4-0008-4000-8000-0000000000aa',
    name: 'Tarek',
  },
  { id: '40000000-0000-4000-8000-000000000009', puuid: 'a1b2c3d4-0009-4000-8000-0000000000aa', name: 'Mona' },
  { id: '40000000-0000-4000-8000-000000000010', puuid: 'a1b2c3d4-0010-4000-8000-0000000000aa', name: 'Ziad' },
] as const;

export const AI_RIOT_IDS = AI_PLAYERS.map((player) => `${player.name}#EUW`);
export const AI_GROUP_NAME = 'Thursday Customs Crew';

export const playerId = (index: number): string => (AI_PLAYERS[index] as (typeof AI_PLAYERS)[number]).id;

/**
 * Blue (players 0-4) beat Red (5-9) in 31 minutes, 39 kills to 25, as the underdog. Red's support
 * (index 9) had a rough game: 1/11/3, the lowest damage. Blue's jungler (index 1) went 9/0/5 on
 * Lee Sin with the most kills; Red's mid (index 7) did the most damage on Ahri.
 */
export const AI_GAME: GameFactsInput = {
  gameId: AI_GAME_ID,
  aram: false,
  durationS: 31 * 60 + 24,
  winningSide: 100,
  upset: true,
  seats: [
    {
      playerId: playerId(0),
      side: 100,
      role: 'top',
      champion: 'Garen',
      kills: 7,
      deaths: 4,
      assists: 6,
      cs: 210,
      damageToChamps: 21_040,
      visionScore: 18,
    },
    {
      playerId: playerId(1),
      side: 100,
      role: 'jungle',
      champion: 'Lee Sin',
      kills: 9,
      deaths: 0,
      assists: 5,
      cs: 160,
      damageToChamps: 18_220,
      visionScore: 31,
    },
    {
      playerId: playerId(2),
      side: 100,
      role: 'mid',
      champion: 'Orianna',
      kills: 8,
      deaths: 3,
      assists: 10,
      cs: 240,
      damageToChamps: 26_300,
      visionScore: 20,
    },
    {
      playerId: playerId(3),
      side: 100,
      role: 'adc',
      champion: 'Jinx',
      kills: 8,
      deaths: 5,
      assists: 8,
      cs: 255,
      damageToChamps: 24_312,
      visionScore: 14,
    },
    {
      playerId: playerId(4),
      side: 100,
      role: 'support',
      champion: 'Thresh',
      kills: 7,
      deaths: 6,
      assists: 21,
      cs: 40,
      damageToChamps: 8_100,
      visionScore: 66,
    },
    {
      playerId: playerId(5),
      side: 200,
      role: 'top',
      champion: 'Darius',
      kills: 6,
      deaths: 7,
      assists: 4,
      cs: 230,
      damageToChamps: 19_500,
      visionScore: 15,
    },
    {
      playerId: playerId(6),
      side: 200,
      role: 'jungle',
      champion: 'Vi',
      kills: 5,
      deaths: 8,
      assists: 9,
      cs: 150,
      damageToChamps: 14_200,
      visionScore: 28,
    },
    {
      playerId: playerId(7),
      side: 200,
      role: 'mid',
      champion: 'Ahri',
      kills: 8,
      deaths: 6,
      assists: 6,
      cs: 245,
      damageToChamps: 31_204,
      visionScore: 22,
    },
    {
      playerId: playerId(8),
      side: 200,
      role: 'adc',
      champion: 'Caitlyn',
      kills: 5,
      deaths: 7,
      assists: 5,
      cs: 262,
      damageToChamps: 22_000,
      visionScore: 12,
    },
    {
      playerId: playerId(9),
      side: 200,
      role: 'support',
      champion: 'Lulu',
      kills: 1,
      deaths: 11,
      assists: 3,
      cs: 25,
      damageToChamps: 5_200,
      visionScore: 40,
    },
  ],
};

export const AI_WEEK: WeekFactsInput = {
  weekStart: '2026-09-27',
  ratedGames: 23,
  board: [
    { playerId: playerId(1), games: 12, wins: 9 },
    { playerId: playerId(2), games: 11, wins: 7 },
    { playerId: playerId(0), games: 10, wins: 6 },
    { playerId: playerId(3), games: 9, wins: 5 },
    { playerId: playerId(4), games: 12, wins: 6 },
    { playerId: playerId(9), games: 8, wins: 1 },
  ],
  climbs: [
    { playerId: playerId(1), climb: 212 },
    { playerId: playerId(2), climb: 80 },
    { playerId: playerId(9), climb: -140 },
  ],
  streaks: [{ playerId: playerId(1), wins: 5 }],
  awards: [{ label: 'Most improved', playerId: playerId(1), value: null, unit: null }],
};

export const AI_PLAYER: PlayerFactsInput = {
  playerId: playerId(1),
  weekStart: '2026-09-27',
  ratedGames: 48,
  wins: 29,
  weekGames: 12,
  weekWins: 9,
  champions: [
    { name: 'Lee Sin', games: 14, wins: 10 },
    { name: 'Vi', games: 6, wins: 2 },
    { name: 'Ahri', games: 3, wins: 3 },
  ],
  roles: [
    { role: 'jungle', games: 30, wins: 20 },
    { role: 'top', games: 4, wins: 3 },
  ],
};
