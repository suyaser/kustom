import type { Mode, Role } from '@customs/core';
import type { RuleCheck } from '@customs/db/schemas';
import { WINDOW_LABELS } from '../board/copy';
import { listChampions } from '../champs/names';
import { postIdentity } from '../discord/assemble';
import type {
  FearlessEmbedInput,
  LeaderboardEmbedInput,
  LeaderboardEntry,
  PostIdentity,
  ResultEmbedInput,
  ResultPlayer,
  TeamsEmbedInput,
  TeamsPlayer,
  TeamsReceipt,
  WindowSummaryEmbedInput,
} from '../discord/embeds';
import type { RatingsResetEmbedInput } from '../discord/ratingsReset';
import type { FearlessChampion } from '../fearless/types';
import { groupPageUrl, leaderboardPageUrl, modePageUrl } from '../siteUrl';

/**
 * 05-design section 10's worked examples as builder inputs (M14.61, acceptance check 1): game 4
 * of the prototype night, Fearless standing, Chaos sitting out, Red winning in 31 minutes. The
 * Discord snapshot tests and the render harness (`scripts/discord-posts-harness.ts`) both read
 * these, so the screenshots are the builders' own JSON.
 */

export const GAME4_ORIGIN = 'https://kustom-delta.vercel.app';
export const GAME4_GROUP = { slug: 'customs', name: 'Customs Night' } as const;
export const GAME4_GAME_ID = '0b6f6d7e-5c1a-4a8e-9d3b-2f4e6a8c0d12';

/** The identity of every post: the real `postIdentity`, on a public origin. */
export function game4Identity(origin: string | null = GAME4_ORIGIN): PostIdentity {
  return postIdentity(GAME4_GROUP, origin);
}

interface Seat {
  name: string;
  role: Role;
  rating: number;
  after: number;
  delta: number;
}

const BLUE: readonly Seat[] = [
  { name: 'FoxHound', role: 'top', rating: 1224, after: 1210, delta: -14 },
  { name: 'XETA', role: 'jungle', rating: 1378, after: 1363, delta: -15 },
  { name: 'Ramzyinhović', role: 'mid', rating: 2638, after: 2625, delta: -13 },
  { name: 'SugarPapy', role: 'adc', rating: 1218, after: 1203, delta: -15 },
  { name: 'Used2BeATahmMain', role: 'support', rating: 1322, after: 1305, delta: -17 },
];

const RED: readonly Seat[] = [
  { name: 'H4RDC0R33', role: 'top', rating: 1531, after: 1546, delta: 15 },
  { name: 'Syndrome Axes', role: 'jungle', rating: 2291, after: 2305, delta: 14 },
  { name: 'knifiy', role: 'mid', rating: 1454, after: 1470, delta: 16 },
  { name: 'PRT Khokha', role: 'adc', rating: 1287, after: 1302, delta: 15 },
  { name: 'TheSHADOWREAPER', role: 'support', rating: 1262, after: 1277, delta: 15 },
];

const puuidOf = (name: string): string => `puuid-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

const teamsSeat = (seat: Seat): TeamsPlayer => ({
  puuid: puuidOf(seat.name),
  name: seat.name,
  role: seat.role,
  rating: seat.rating,
  offRole: false,
});

const resultSeat = (seat: Seat): ResultPlayer => ({
  puuid: puuidOf(seat.name),
  name: seat.name,
  role: seat.role,
  rating: seat.after,
  delta: seat.delta,
});

const assignments = (seats: readonly Seat[]) =>
  seats.map((seat) => ({ puuid: puuidOf(seat.name), role: seat.role }));

/** Split 1 (Blue 49%, gap 45) and split 2: the two adc players swapped (Blue 53%, gap 61). */
export function game4Receipt(blueWinProb = 0.49): TeamsReceipt {
  const swapAdc = (seats: readonly Seat[], from: readonly Seat[]) =>
    seats.map((seat) => (seat.role === 'adc' ? (from.find((other) => other.role === 'adc') ?? seat) : seat));
  return {
    chosen: {
      rank: 1,
      blue: assignments(BLUE),
      red: assignments(RED),
      gap: 45,
      offRoleCount: 0,
      blueWinProb,
    },
    next: {
      rank: 2,
      blue: assignments(swapAdc(BLUE, RED)),
      red: assignments(swapAdc(RED, BLUE)),
      gap: 61,
      offRoleCount: 0,
      blueWinProb: 0.53,
    },
    splitCount: 3,
  };
}

/** Core's sentence for split 1, as `splits.explanation` stores it. */
export const GAME4_EXPLANATION =
  'Red favored 51%. Everyone on a main role. Gap 45. Next best: swap SugarPapy and PRT Khokha, gap 61.';

/** 10.4 "Teams, filled": Fearless standing, Chaos sits, the auto side line, the lobby. */
export function game4Teams(overrides: Partial<TeamsEmbedInput> = {}): TeamsEmbedInput {
  return {
    identity: game4Identity(),
    blue: BLUE.map(teamsSeat),
    red: RED.map(teamsSeat),
    explanation: GAME4_EXPLANATION,
    receipt: game4Receipt(),
    sitOut: { names: ['Chaos'], rule: { kind: 'longest-since', games: 3, everyone: true } },
    seats: [],
    switchSideEnabled: true,
    lobby: { name: 'customs-night', password: '4471' },
    url: groupPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug),
    receiptUrl: groupPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug, 'how-the-bot-decided'),
    mode: { mode: { id: 'fearless' }, rated: true, standing: 'fearless' },
    modeUrl: modePageUrl(GAME4_ORIGIN, GAME4_GROUP.slug),
    ...overrides,
  };
}

export const TANKS: Mode = { id: 'class', tag: 'Tank' };

/**
 * 10.9: a tanks-only rule on a Fearless night, not rated. Same split, receipt and core sentence as
 * {@link game4Teams}, so every number in the post agrees with every other.
 */
export function game4TeamsRule(): TeamsEmbedInput {
  return game4Teams({ mode: { mode: TANKS, rated: false, standing: 'fearless' } });
}

const JINX = 222;

/** 10.5 "Result, filled": Red won in 31 minutes, game 4. */
export function game4Result(overrides: Partial<ResultEmbedInput> = {}): ResultEmbedInput {
  return {
    identity: game4Identity(),
    winningSide: 200,
    durationS: 31 * 60 + 14,
    blue: BLUE.map(resultSeat),
    red: RED.map(resultSeat),
    award: { mvp: 'Syndrome Axes', ace: 'Ramzyinhović' },
    blueWinProb: 0.49,
    topDamage: { name: 'Syndrome Axes', damage: 31_400 },
    gameNumber: 4,
    url: `${groupPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug)}/games/${GAME4_GAME_ID}`,
    badgeUrl: `${GAME4_ORIGIN}/og/g/${GAME4_GROUP.slug}/games/${GAME4_GAME_ID}/badge`,
    ...overrides,
  };
}

/** The tanks rule's stored verdict for game 4: Blue kept it, Red's Jinx is not a tank. */
export const GAME4_RULE_CHECK: RuleCheck = {
  kind: 'sides',
  blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
  red: { side: 200, verdict: 'broke', broke: [JINX], unknown: [] },
};

/** 10.5's not-rated class game: names only on the seat lines, no award. */
export function game4ResultNotRated(): ResultEmbedInput {
  const strip = (player: ResultPlayer): ResultPlayer => ({ ...player, rating: null, delta: null });
  const result = game4Result();
  return {
    ...result,
    blue: result.blue.map(strip),
    red: result.red.map(strip),
    award: null,
    mode: { rated: false, rule: { mode: TANKS, check: GAME4_RULE_CHECK } },
  };
}

/** The recap line the 15-minute edit adds (10.5), Discord-ready. */
export const GAME4_RECAP = 'Syndrome Axes put 31.4k into champions and Red closed it out in 31 minutes.';

const WEEK: readonly [string, number, number, number, number | null][] = [
  ['Ramzyinhović', 212, 5, 2, null],
  ['Syndrome Axes', 140, 6, 3, null],
  ['knifiy', 88, 4, 3, null],
  ['XETA', 41, 3, 3, null],
  ['H4RDC0R33', 30, 4, 4, null],
  ['PRT Khokha', 12, 3, 3, null],
  ['FoxHound', -18, 2, 3, null],
  ['SugarPapy', -44, 2, 4, null],
  ['TheSHADOWREAPER', -61, 1, 3, null],
  ['Chaos', -96, 1, 4, 4],
];

export function game4WeekEntries(): LeaderboardEntry[] {
  return WEEK.map(([name, points, wins, losses, settlingGames]) => ({
    puuid: puuidOf(name),
    name,
    rating: 1200,
    games: wins + losses,
    week: { points, wins, losses, settlingGames },
  }));
}

/** 10.6: the Sunday post, board and two awards; `storyline` for M16.5's E0. */
export function game4Weekly(overrides: Partial<WindowSummaryEmbedInput> = {}): WindowSummaryEmbedInput {
  return {
    identity: game4Identity(),
    windowLabel: WINDOW_LABELS['last-week'],
    description: 'Sunday 27 Sep to Saturday 3 Oct · 14 rated games',
    track: 'week',
    entries: game4WeekEntries(),
    awards: [
      { label: 'Best off-role', line: 'XETA · 4W 1L · 80% · their main is jungle' },
      { label: 'Cursed duo', line: 'FoxHound and SugarPapy · 1W 5L · 17%' },
    ],
    url: leaderboardPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug, 'last-week'),
    ...overrides,
  };
}

/** A storyline as M16.5 would hand it over (at most 600 characters, escaped). */
export const GAME4_STORYLINE =
  'Ramzyinhović took the week with 212 points from seven games, and Syndrome Axes played the most at nine. FoxHound and SugarPapy kept finding each other on the same side and won one of six.';

/** 10.7: the nightly board on this week. */
export function game4Nightly(): LeaderboardEmbedInput {
  return {
    identity: game4Identity(),
    windowLabel: WINDOW_LABELS['this-week'],
    track: 'week',
    entries: game4WeekEntries(),
    url: leaderboardPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug, 'this-week'),
  };
}

const POOL: Readonly<Record<Role, readonly string[]>> = {
  top: ['Aatrox', 'Gnar', 'Camille', 'Darius', 'Fiora', 'Garen', 'Jax'],
  jungle: ['Lee Sin', 'Vi', 'Graves', "Kha'Zix", 'Sylas', 'Viego'],
  mid: ['Ahri', 'Syndra', 'Akali', 'Orianna', 'Viktor', 'Yasuo', 'Zed'],
  adc: ['Jinx', "Kai'Sa", 'Caitlyn', 'Ezreal', 'Miss Fortune', 'Vayne'],
  support: ['Nautilus', 'Thresh', 'Blitzcrank', 'Leona', 'Lulu', 'Lux', 'Morgana', 'Pyke'],
};

/** 10.8: the pool after game 4. Each lane's first two names are the ones game 4 added. */
export function game4Fearless(): FearlessEmbedInput {
  const byName = new Map(listChampions().map((champion) => [champion.name, champion.id]));
  const champions: FearlessChampion[] = [];
  const added = new Set<number>();
  for (const [role, names] of Object.entries(POOL) as [Role, readonly string[]][]) {
    names.forEach((name, index) => {
      const id = byName.get(name);
      if (id === undefined) throw new Error(`no champion named ${name}`);
      champions.push({ id, name, role });
      if (index < 2) added.add(id);
    });
  }
  return {
    identity: game4Identity(),
    champions,
    added,
    url: modePageUrl(GAME4_ORIGIN, GAME4_GROUP.slug),
  };
}

/** 10.10: the ratings reset, the top three before it. */
export function game4RatingsReset(): RatingsResetEmbedInput {
  return {
    identity: game4Identity(),
    topThree: ['Ramzyinhović', 'Syndrome Axes', 'knifiy'],
    url: leaderboardPageUrl(GAME4_ORIGIN, GAME4_GROUP.slug, 'all-time'),
  };
}
