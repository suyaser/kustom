/** biome-ignore-all lint/style/noNonNullAssertion: the M16.7 reviewer's fixture, kept verbatim so its numbers match the M16.7 report */
/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: as above */
// M16.7 reviewer: a deterministic month: 150 games, 4 weeks, 20 players. Pure; no I/O. Dev-only
// (M16.13): `ai-eval-month.ts` runs it through the generators; nothing in the app imports it.
import type { RoleValue } from '@customs/db';
import {
  type GameFactsInput,
  type GameSeatInput,
  gameHistoryOf,
  type HistoryRow,
  type PlayerFactsInput,
  type WeekFactsInput,
} from '../lib/ai/facts.ts';
import { listChampions } from '../lib/champs/names.ts';

export const NAMES = [
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
  'Sami',
  'Dodo',
  'Kareem',
  'Nour',
  'Tito',
  'Layla',
  'Bashar',
  'Mo',
  'Zizo',
  'Hana',
];
export const id = (i: number) => `m-player-${i}`;
export const nameOf = (pid: string): string | null => NAMES[Number(pid.replace('m-player-', ''))] ?? null;
export const OPTED_OUT = [13, 19];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(1607);
const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)] as T;

const ROLES: RoleValue[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const POOL: Record<RoleValue, string[]> = {
  top: ['Darius', 'Garen', 'Malphite', 'Ornn', 'Jax', 'Sett', 'Illaoi', 'Fiora'],
  jungle: ['Lee Sin', 'Vi', 'Jarvan IV', 'Kindred', 'Elise', 'Hecarim', "Kha'Zix", 'Amumu'],
  mid: ['Ahri', 'Zed', 'Yasuo', 'Orianna', 'Veigar', 'Lux', 'Syndra', 'Kassadin'],
  adc: ['Jinx', 'Ezreal', 'Caitlyn', "Kai'Sa", 'Draven', 'Ashe', 'Vayne', 'Miss Fortune'],
  support: ['Thresh', 'Nami', 'Leona', 'Lulu', 'Soraka', 'Blitzcrank', 'Morgana', 'Braum'],
};
const known = new Set(listChampions().map((c) => c.name));
for (const r of ROLES) for (const c of POOL[r]) if (!known.has(c)) throw new Error(`unknown champion ${c}`);
const champId = (name: string) => 1000 + [...known].indexOf(name);

// 20 players: main role, a skill, an activity weight, a champion pool of 3 per role they play.
const players = Array.from({ length: 20 }, (_, i) => ({
  i,
  main: ROLES[i % 5] as RoleValue,
  skill: 0.4 + R() * 0.3,
  weight: 0.5 + R() * 1.5,
  champs: Object.fromEntries(ROLES.map((r) => [r, [0, 1, 2].map(() => pick(POOL[r]))])) as Record<
    RoleValue,
    string[]
  >,
}));

export interface MonthGame {
  index: number;
  week: number;
  startedAt: string;
  input: GameFactsInput;
  seatsMeta: { pid: string; won: boolean; role: RoleValue | null; champion: string; side: 100 | 200 }[];
}

const split = (total: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - out.reduce((a, b) => a + b, 0);
  while (left > 0) {
    out[ri(0, out.length - 1)]! += 1;
    left -= 1;
  }
  return out;
};

const WEEK_STARTS = ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04'];
const PER_WEEK = [38, 37, 38, 37];

export function buildMonth(): MonthGame[] {
  const games: MonthGame[] = [];
  const history = new Map<string, HistoryRow[]>();
  let n = 0;
  for (let w = 0; w < 4; w += 1) {
    for (let g = 0; g < PER_WEEK[w]!; g += 1) {
      n += 1;
      const aram = R() < 0.1;
      // ten distinct players by weight
      const pool = [...players];
      const chosen: typeof players = [];
      while (chosen.length < 10) {
        const total = pool.reduce((s, p) => s + p.weight, 0);
        let x = R() * total;
        let k = 0;
        for (; k < pool.length - 1; k += 1) {
          x -= pool[k]!.weight;
          if (x <= 0) break;
        }
        chosen.push(pool.splice(k, 1)[0]!);
      }
      // assign roles: prefer mains, else shuffle
      const bySeat: (typeof players)[number][] = [];
      const left = [...chosen];
      const seats: (typeof players)[number][][] = [[], []];
      const shuffled = left.sort(() => R() - 0.5);
      shuffled.forEach((p, k) => seats[k < 5 ? 0 : 1]!.push(p));
      const blue = seats[0]!;
      const red = seats[1]!;
      // role order by main role when unique else arbitrary
      const order = (team: typeof players) => {
        const out: ((typeof players)[number] | null)[] = [null, null, null, null, null];
        const rest: typeof players = [];
        for (const p of team) {
          const idx = ROLES.indexOf(p.main);
          if (out[idx] === null) out[idx] = p;
          else rest.push(p);
        }
        return out.map((p) => p ?? rest.pop()!);
      };
      const B = order(blue);
      const Rd = order(red);
      void bySeat;
      const sk = (t: typeof players) => t.reduce((s, p) => s + p.skill, 0);
      const pBlue = 1 / (1 + Math.exp(-(sk(B) - sk(Rd)) * 3));
      const blueWins = R() < pBlue * 0.8 + 0.1;
      const winner: 100 | 200 = blueWins ? 100 : 200;
      const upset = (blueWins && sk(B) < sk(Rd) - 0.15) || (!blueWins && sk(Rd) < sk(B) - 0.15);
      const style = R();
      const minutes = aram ? ri(12, 24) : style < 0.08 ? ri(15, 19) : style < 0.18 ? ri(46, 58) : ri(21, 44);
      const base = Math.round(minutes * (aram ? 2.4 : 0.85));
      let wKills = Math.max(5, Math.round(base * (0.9 + R() * 0.7)));
      let lKills = Math.max(1, Math.round(base * (0.35 + R() * 0.7)));
      const fewer = R() < 0.06;
      if (fewer) {
        const t = wKills;
        wKills = Math.max(1, lKills - ri(1, 5));
        lKills = t;
      }
      const close = R() < 0.15;
      if (close) lKills = Math.max(1, wKills - ri(0, 3));
      const mk = (team: (typeof players)[number][], side: 100 | 200): GameSeatInput[] => {
        const won = side === winner;
        const kills = split(
          won ? wKills : lKills,
          [2.2, 1.4, 2.4, 2.8, 0.7].map((x) => x * (0.6 + R())),
        );
        const deaths = split(
          won ? lKills : wKills,
          [1.3, 1.1, 1.0, 1.0, 1.4].map((x) => x * (0.4 + R() * 1.2)),
        );
        const teamK = won ? wKills : lKills;
        const assists = split(
          Math.round(teamK * (1.4 + R() * 0.6)),
          [1.6, 2.2, 1.6, 1.0, 3.2].map((x) => x * (0.5 + R())),
        );
        return team.map((p, k) => {
          const role = ROLES[k] as RoleValue;
          const champ = pick(p.champs[role]);
          const csRate = [7, 5.5, 7.5, 8, 1.2][k]!;
          return {
            playerId: id(p.i),
            side,
            role: aram ? null : role,
            champion: champ,
            kills: kills[k]!,
            deaths: deaths[k]!,
            assists: assists[k]!,
            cs: Math.round(minutes * csRate * (0.7 + R() * 0.5)),
            damageToChamps: Math.round(minutes * [650, 520, 800, 850, 280][k]! * (0.6 + R() * 0.7)),
            visionScore:
              R() < 0.04 ? null : Math.round(minutes * [0.8, 1.3, 0.8, 0.7, 2.4][k]! * (0.6 + R() * 0.8)),
          };
        });
      };
      const seatsAll = [...mk(B, 100), ...mk(Rd, 200)];
      const day = 13 + w * 7 + ri(0, 6);
      const startedAt = new Date(Date.UTC(2026, 8, day, 18 + (g % 6), (g * 7) % 60)).toISOString();
      // history
      const withHistory = seatsAll.map((seat) => {
        const hist = gameHistoryOf(
          { ...seat, championId: champId(seat.champion!), won: seat.side === winner, aram },
          history.get(seat.playerId) ?? [],
        );
        return hist === null ? seat : { ...seat, history: hist };
      });
      for (const seat of seatsAll) {
        const rows = history.get(seat.playerId) ?? [];
        rows.push({
          startedAt,
          won: seat.side === winner,
          aram,
          championId: champId(seat.champion!),
          kills: seat.kills,
          assists: seat.assists,
          cs: seat.cs,
          damageToChamps: seat.damageToChamps,
          visionScore: seat.visionScore,
        });
        history.set(seat.playerId, rows);
      }
      games.push({
        index: n,
        week: w,
        startedAt,
        input: {
          gameId: `m-game-${n}`,
          aram,
          durationS: minutes * 60 + ri(0, 59),
          winningSide: winner,
          upset,
          seats: withHistory,
        },
        seatsMeta: seatsAll.map((s) => ({
          pid: s.playerId,
          won: s.side === winner,
          role: s.role,
          champion: s.champion!,
          side: s.side,
        })),
      });
    }
  }
  return games;
}

export function weekInput(games: MonthGame[], w: number): WeekFactsInput {
  const ws = games.filter((g) => g.week === w && !g.input.aram);
  const stat = new Map<string, { games: number; wins: number; points: number; run: number; best: number }>();
  for (const g of ws) {
    for (const s of g.seatsMeta) {
      const e = stat.get(s.pid) ?? { games: 0, wins: 0, points: 0, run: 0, best: 0 };
      e.games += 1;
      const delta = 8 + Math.round((g.index * 7 + Number(s.pid.slice(9))) % 15);
      if (s.won) {
        e.wins += 1;
        e.points += delta;
        e.run += 1;
        e.best = Math.max(e.best, e.run);
      } else {
        e.points -= delta;
        e.run = 0;
      }
      stat.set(s.pid, e);
    }
  }
  const rows = [...stat.entries()].sort((a, b) => b[1].points - a[1].points);
  const bestRun = Math.max(...rows.map(([, e]) => e.best));
  return {
    weekStart: WEEK_STARTS[w]!,
    ratedGames: ws.length,
    board: rows.map(([playerId, e]) => ({ playerId, games: e.games, wins: e.wins })),
    climbs: rows.filter(([, e]) => e.points > 0).map(([playerId, e]) => ({ playerId, climb: e.points })),
    streaks: rows
      .filter(([, e]) => e.best === bestRun && bestRun >= 3)
      .map(([playerId]) => ({ playerId, wins: bestRun })),
    awards:
      w % 2 === 0
        ? [{ label: 'Best off-role', playerId: rows[3 % rows.length]![0], value: null, unit: null }]
        : [],
  };
}

export function playerInputs(games: MonthGame[]): PlayerFactsInput[] {
  const rated = games.filter((g) => !g.input.aram);
  return players.map((p) => {
    const mine = rated.flatMap((g) => g.seatsMeta.filter((s) => s.pid === id(p.i)));
    const wk = rated.filter((g) => g.week === 3).flatMap((g) => g.seatsMeta.filter((s) => s.pid === id(p.i)));
    const champions = new Map<string, { games: number; wins: number }>();
    const roles = new Map<RoleValue, { games: number; wins: number }>();
    for (const s of mine) {
      const c = champions.get(s.champion) ?? { games: 0, wins: 0 };
      c.games += 1;
      if (s.won) c.wins += 1;
      champions.set(s.champion, c);
      if (s.role) {
        const r = roles.get(s.role) ?? { games: 0, wins: 0 };
        r.games += 1;
        if (s.won) r.wins += 1;
        roles.set(s.role, r);
      }
    }
    return {
      playerId: id(p.i),
      weekStart: WEEK_STARTS[3]!,
      ratedGames: mine.length,
      wins: mine.filter((s) => s.won).length,
      weekGames: wk.length,
      weekWins: wk.filter((s) => s.won).length,
      champions: [...champions].map(([name, e]) => ({ name, ...e })),
      roles: [...roles].map(([role, e]) => ({ role, ...e })),
    };
  });
}
