import { displayKustom, explainKustomDelta, isSettling, type KustomRow, rateGameKustom } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import type { BoardRow, PlayerBoardView, RecentGame } from '../board/types';
import type { KustomReason } from '../breakdown/read';
import type { ResultEmbedInput } from '../discord/embeds';
import { displayDelta, sumDisplayDeltas } from '../ratingDisplay';

/**
 * M18.7's dev-kit week (`/kit/kustom`): the 05-design 11.8 roster folded through core's
 * `rateGameKustom` on both tracks, so every number on the kit's board, week board, player page and
 * Discord previews is the Kustom rating's own arithmetic, not a hand-typed one. Six games of one
 * week, everyone settled (30 games behind them) except `Chaos`, who is settling at 3.
 *
 * Dev-kit and tests only; nothing here reads the database.
 */

const ROLES: readonly RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** The 11.8 roster's all-time Ratings going into the week, and the games behind them. */
const ROSTER: readonly { name: string; r: number; n: number }[] = [
  { name: 'FoxHound', r: 1191.2, n: 30 },
  { name: 'XETA', r: 1236.5, n: 30 },
  { name: 'Ramzyinhović', r: 1352.4, n: 30 },
  { name: 'SugarPapy', r: 1166.8, n: 30 },
  { name: 'Used2BeATahmMain', r: 1203.3, n: 30 },
  { name: 'H4RDC0R33', r: 1238.9, n: 30 },
  { name: 'Syndrome Axes', r: 1340.1, n: 30 },
  { name: 'knifiy', r: 1288.6, n: 30 },
  { name: 'PRT Khokha', r: 1219.7, n: 30 },
  { name: 'TheSHADOWREAPER', r: 1221.4, n: 30 },
  { name: 'Chaos', r: 1188.0, n: 3 },
];

export const kitPuuid = (name: string): string => `kit-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Blue's five then red's five, lane order; `best` lists each side's five best first. */
interface KitGame {
  blue: readonly string[];
  red: readonly string[];
  winner: SideValue;
  best: readonly string[];
  durationS: number;
  startedAt: string;
}

const GAMES: readonly KitGame[] = [
  {
    blue: ['FoxHound', 'XETA', 'knifiy', 'SugarPapy', 'Used2BeATahmMain'],
    red: ['H4RDC0R33', 'Syndrome Axes', 'Ramzyinhović', 'PRT Khokha', 'TheSHADOWREAPER'],
    winner: 200,
    best: [
      'Ramzyinhović',
      'Syndrome Axes',
      'H4RDC0R33',
      'TheSHADOWREAPER',
      'PRT Khokha',
      'knifiy',
      'XETA',
      'FoxHound',
      'Used2BeATahmMain',
      'SugarPapy',
    ],
    durationS: 1_860,
    startedAt: '2026-09-27T18:10:00.000Z',
  },
  {
    blue: ['H4RDC0R33', 'XETA', 'Ramzyinhović', 'SugarPapy', 'TheSHADOWREAPER'],
    red: ['FoxHound', 'Syndrome Axes', 'knifiy', 'PRT Khokha', 'Used2BeATahmMain'],
    winner: 100,
    best: [
      'Ramzyinhović',
      'XETA',
      'SugarPapy',
      'H4RDC0R33',
      'TheSHADOWREAPER',
      'Syndrome Axes',
      'knifiy',
      'PRT Khokha',
      'FoxHound',
      'Used2BeATahmMain',
    ],
    durationS: 1_710,
    startedAt: '2026-09-27T18:55:00.000Z',
  },
  {
    blue: ['FoxHound', 'Syndrome Axes', 'Ramzyinhović', 'PRT Khokha', 'Used2BeATahmMain'],
    red: ['H4RDC0R33', 'XETA', 'knifiy', 'SugarPapy', 'TheSHADOWREAPER'],
    winner: 200,
    best: [
      'Ramzyinhović',
      'Syndrome Axes',
      'FoxHound',
      'Used2BeATahmMain',
      'PRT Khokha',
      'knifiy',
      'XETA',
      'H4RDC0R33',
      'SugarPapy',
      'TheSHADOWREAPER',
    ],
    durationS: 2_040,
    startedAt: '2026-09-27T19:40:00.000Z',
  },
  {
    blue: ['Chaos', 'XETA', 'Ramzyinhović', 'SugarPapy', 'TheSHADOWREAPER'],
    red: ['H4RDC0R33', 'Syndrome Axes', 'knifiy', 'PRT Khokha', 'Used2BeATahmMain'],
    winner: 100,
    best: [
      'Ramzyinhović',
      'XETA',
      'Chaos',
      'TheSHADOWREAPER',
      'SugarPapy',
      'knifiy',
      'Syndrome Axes',
      'H4RDC0R33',
      'PRT Khokha',
      'Used2BeATahmMain',
    ],
    durationS: 1_620,
    startedAt: '2026-09-28T18:15:00.000Z',
  },
  {
    blue: ['Chaos', 'Syndrome Axes', 'knifiy', 'PRT Khokha', 'Used2BeATahmMain'],
    red: ['H4RDC0R33', 'XETA', 'Ramzyinhović', 'SugarPapy', 'TheSHADOWREAPER'],
    winner: 100,
    best: [
      'Syndrome Axes',
      'knifiy',
      'Used2BeATahmMain',
      'Chaos',
      'PRT Khokha',
      'Ramzyinhović',
      'XETA',
      'H4RDC0R33',
      'TheSHADOWREAPER',
      'SugarPapy',
    ],
    durationS: 1_950,
    startedAt: '2026-09-28T19:00:00.000Z',
  },
  {
    // 05-design 11.8's game: red favoured, red wins, Syndrome Axes MVP, Ramzyinhović ACE.
    blue: ['FoxHound', 'XETA', 'Ramzyinhović', 'SugarPapy', 'Used2BeATahmMain'],
    red: ['H4RDC0R33', 'Syndrome Axes', 'knifiy', 'PRT Khokha', 'TheSHADOWREAPER'],
    winner: 200,
    best: [
      'Syndrome Axes',
      'knifiy',
      'H4RDC0R33',
      'TheSHADOWREAPER',
      'PRT Khokha',
      'Ramzyinhović',
      'XETA',
      'FoxHound',
      'Used2BeATahmMain',
      'SugarPapy',
    ],
    durationS: 1_860,
    startedAt: '2026-09-28T19:44:00.000Z',
  },
];

interface Folded {
  game: KitGame;
  blueWinProb: number;
  allTime: Map<string, KustomRow>;
  week: Map<string, KustomRow>;
}

function fold(): {
  folded: Folded[];
  r: Map<string, number>;
  n: Map<string, number>;
  weekR: Map<string, number>;
  weekN: Map<string, number>;
} {
  const r = new Map(ROSTER.map((p) => [p.name, p.r]));
  const n = new Map(ROSTER.map((p) => [p.name, p.n]));
  const weekR = new Map<string, number>();
  const weekN = new Map<string, number>();
  const folded: Folded[] = [];
  for (const game of GAMES) {
    const score = (name: string) => GAMES.length * 10 - game.best.indexOf(name);
    const seat = (track: 'all' | 'week') => (name: string, side: SideValue) => ({
      puuid: name,
      side,
      r: track === 'all' ? (r.get(name) as number) : (weekR.get(name) ?? 1200),
      n: track === 'all' ? (n.get(name) as number) : (weekN.get(name) ?? 0),
      score: score(name),
    });
    const players = (track: 'all' | 'week') => [
      ...game.blue.map((name) => seat(track)(name, 100)),
      ...game.red.map((name) => seat(track)(name, 200)),
    ];
    const allRows = rateGameKustom({ players: players('all'), winningSide: game.winner });
    const weekRows = rateGameKustom({ players: players('week'), winningSide: game.winner });
    const blueRow = allRows.find((row) => row.side === 100) as KustomRow;
    folded.push({
      game,
      blueWinProb: blueRow.expected,
      allTime: new Map(allRows.map((row) => [row.puuid, row])),
      week: new Map(weekRows.map((row) => [row.puuid, row])),
    });
    for (const row of allRows) {
      r.set(row.puuid, row.rAfter);
      n.set(row.puuid, (n.get(row.puuid) as number) + 1);
    }
    for (const row of weekRows) {
      weekR.set(row.puuid, row.rAfter);
      weekN.set(row.puuid, (weekN.get(row.puuid) ?? 0) + 1);
    }
  }
  return { folded, r, n, weekR, weekN };
}

const STATE = fold();

function reasonOf(
  row: KustomRow,
  track: 'all-time' | 'week',
  gamesBefore: number,
  allTimeRow: KustomRow,
): KustomReason {
  return {
    track,
    parts: explainKustomDelta(row),
    gamesBefore,
    allTime:
      track === 'week'
        ? {
            points: displayDelta(allTimeRow.rBefore, allTimeRow.rAfter),
            rating: displayKustom(allTimeRow.rAfter),
          }
        : null,
  };
}

function recordOf(name: string) {
  let wins = 0;
  let losses = 0;
  for (const { game } of STATE.folded) {
    const side = game.blue.includes(name) ? 100 : game.red.includes(name) ? 200 : null;
    if (side === null) continue;
    if (side === game.winner) wins += 1;
    else losses += 1;
  }
  return { wins, losses, games: wins + losses };
}

/** The all-time board: everyone by unrounded `r`, `Chaos` in the settling section. */
export function kitAllTimeRows(): BoardRow[] {
  return ROSTER.map((p) => {
    const r = STATE.r.get(p.name) as number;
    const n = STATE.n.get(p.name) as number;
    const wins = Math.round(n * 0.52);
    return {
      puuid: kitPuuid(p.name),
      name: p.name,
      track: 'all-time' as const,
      points: null,
      sortKey: r,
      rating: displayKustom(r),
      games: n,
      wins,
      losses: n - wins,
      ratedGames: n,
      climb: { rBefore: 1200, rAfter: r },
      settling: isSettling(n),
      settlingChip: isSettling(n),
      awards: [],
    };
  }).sort((a, b) => Number(a.settling) - Number(b.settling) || b.sortKey - a.sortKey);
}

/** The week board: week points, ties on wins, games, all-time Rating (M18.6's order). */
export function kitWeekRows(): BoardRow[] {
  return ROSTER.map((p) => {
    const weekR = STATE.weekR.get(p.name) ?? 1200;
    const n = STATE.n.get(p.name) as number;
    const r = STATE.r.get(p.name) as number;
    const record = recordOf(p.name);
    return {
      puuid: kitPuuid(p.name),
      name: p.name,
      track: 'week' as const,
      points: displayKustom(weekR) - 1200,
      sortKey: r,
      rating: displayKustom(r),
      games: record.games,
      wins: record.wins,
      losses: record.losses,
      ratedGames: n,
      climb: null,
      settling: false,
      settlingChip: isSettling(n),
      awards: [],
    };
  })
    .filter((row) => row.games > 0)
    .sort(
      (a, b) =>
        (b.points as number) - (a.points as number) ||
        b.wins - a.wins ||
        a.games - b.games ||
        b.sortKey - a.sortKey,
    );
}

function recentFor(name: string, track: 'all-time' | 'week'): RecentGame[] {
  const out: RecentGame[] = [];
  let weekN = 0;
  const startN = ROSTER.find((p) => p.name === name)?.n ?? 0;
  let n = startN;
  for (const [index, f] of STATE.folded.entries()) {
    const side: SideValue | null = f.game.blue.includes(name) ? 100 : f.game.red.includes(name) ? 200 : null;
    if (side === null) continue;
    const all = f.allTime.get(name) as KustomRow;
    const week = f.week.get(name) as KustomRow;
    const team = side === 100 ? f.game.blue : f.game.red;
    // The week's first game was rolled before the switch (M18.7 kit): the bot's stored OpenSkill odds
    // (7 points under the fold's) stay as posted, so the row shows 05-design 11.7's `For points` line.
    const preSwitch = index === 0;
    const botBlue = preSwitch ? Math.max(0, f.blueWinProb - 0.07) : f.blueWinProb;
    out.push({
      gameId: `kit-game-${index + 1}`,
      startedAt: f.game.startedAt,
      durationS: f.game.durationS,
      won: side === f.game.winner,
      side,
      winningSide: f.game.winner,
      role: ROLES[team.indexOf(name)] ?? null,
      rBefore: all.rBefore,
      rAfter: all.rAfter,
      weekRBefore: week.rBefore,
      weekRAfter: week.rAfter,
      award: all.award === 'none' ? null : all.award,
      blueWinProb: botBlue,
      pickRank: 1,
      ratingsBefore: null,
      aram: false,
      team: team.map((teammate, seat) => ({
        puuid: kitPuuid(teammate),
        name: teammate,
        role: ROLES[seat] ?? null,
      })),
      reason: track === 'week' ? reasonOf(week, 'week', weekN, all) : reasonOf(all, 'all-time', n, all),
      odds: preSwitch
        ? {
            botBluePct: Math.round(botBlue * 100),
            ratingBluePct: Math.round(f.blueWinProb * 100),
            differ: true,
            pointsBluePct: Math.round(f.blueWinProb * 100),
            ratingBlueWinProb: f.blueWinProb,
          }
        : null,
    });
    weekN += 1;
    n += 1;
  }
  return out.reverse();
}

/** One player's page on the kit week, either tab. */
export function kitPlayer(name: string, window: 'all-time' | 'last-week'): PlayerBoardView {
  const r = STATE.r.get(name) as number;
  const n = STATE.n.get(name) as number;
  const start = ROSTER.find((p) => p.name === name) as { r: number; n: number };
  const record = recordOf(name);
  const week = window === 'last-week';
  const recent = recentFor(name, week ? 'week' : 'all-time');
  const oldestFirst = [...recent].reverse();
  const allRanked = kitAllTimeRows().filter((row) => !row.settling);
  const rank = allRanked.findIndex((row) => row.puuid === kitPuuid(name));
  return {
    puuid: kitPuuid(name),
    name,
    window,
    track: week ? 'week' : 'all-time',
    rating: displayKustom(r),
    points: week ? displayKustom(STATE.weekR.get(name) ?? 1200) - 1200 : null,
    games: week ? record.games : n,
    wins: week ? record.wins : Math.round(n * 0.52),
    losses: week ? record.losses : n - Math.round(n * 0.52),
    ratedGames: n,
    range: week ? 'Sunday 27 Sep to Saturday 3 Oct' : null,
    settling: !week && isSettling(n),
    rank: week || isSettling(n) ? null : rank + 1,
    reference: week ? 0 : 1200,
    history: week
      ? [0, ...oldestFirst.map((game) => displayKustom(game.weekRAfter as number) - 1200)]
      : [displayKustom(start.r), ...oldestFirst.map((game) => displayKustom(game.rAfter as number))],
    weekTotal: week
      ? sumDisplayDeltas(
          oldestFirst.map((game) => ({
            rBefore: game.weekRBefore as number,
            rAfter: game.weekRAfter as number,
          })),
        )
      : null,
    recent,
  };
}

/** 05-design 11.8's result post: the week's last game. */
export function kitResultInput(): Omit<ResultEmbedInput, 'identity'> {
  const last = STATE.folded[STATE.folded.length - 1] as Folded;
  const seats = (names: readonly string[]) =>
    names.map((name, seat) => {
      const row = last.allTime.get(name) as KustomRow;
      return {
        puuid: kitPuuid(name),
        name,
        role: ROLES[seat] ?? null,
        rating: displayKustom(row.rAfter),
        delta: displayDelta(row.rBefore, row.rAfter),
      };
    });
  return {
    winningSide: last.game.winner,
    durationS: last.game.durationS,
    blue: seats(last.game.blue),
    red: seats(last.game.red),
    award: { mvp: 'Syndrome Axes', ace: 'Ramzyinhović' },
    blueWinProb: last.blueWinProb,
    topDamage: { name: 'Syndrome Axes', damage: 31_400 },
    gameNumber: GAMES.length,
  };
}
