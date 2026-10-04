import {
  type BalancePlayer,
  balance,
  config,
  type Duo,
  KUSTOM_START,
  ROLES,
  rateGameKustom,
  winProbability,
} from '@customs/core';

/**
 * M18.13's evenness check: `redesign/research/team-formation.md` §3's two simulations (the paired
 * evenness experiment and "who gets filled"), rerun on the Kustom scale.
 *
 * **The world is the report's, unchanged, only rescaled.** Twenty players, true skill
 * `25 + 3·N(0,1)` in OpenSkill mu with true role multipliers, attendance 35-95 %, 4 to 6 games a
 * night with seats rotating to whoever played least, optional planted synergy, and the outcome
 * `P(blue) = logistic(Δstrength / S)`, `S = 2√2·β`. Every mu is mapped onto the Kustom scale by
 * `1200 + (mu − 25) · 400 / S`, so the outcome is exactly `logistic(Δ / 400)`, the Kustom odds
 * function. Same random streams as the report's `sim.mjs`, draw for draw.
 *
 * **What changed is the system under test.** Ratings are folded by core's `rateGameKustom`
 * (start 1200, K 32 to 16, shares all 1.0 because the report left the MVP nudge out), not
 * OpenSkill, and the balancer reads the all-time Rating `r`:
 *
 * - `before`: the M18.2 balancer, `r × {1, 0.93, 0.85}`, no variety. A port (core no longer has it).
 * - `after`: core's own `balance()`, as shipped (flat `roleDrop`, capped teammate variety from the
 *   night's previous game), called exactly as `apps/web/lib/ingest/balance.ts` calls it.
 * - `flatOnly`, `varietyOnly`: the port with one of the two terms, to say which term moved what.
 * - `random`: a random split with best lanes, the floor.
 *
 * The port is checked against core's `balance()` in `sim.test.ts` (same chosen split on every
 * lobby), so `before` differs from `after` only in the terms it is meant to.
 *
 * Pure: no clock, no I/O, deterministic per seed.
 */

// ---------------------------------------------------------------------------------------------
// The report's constants (sim.mjs), and the one rescale.
// ---------------------------------------------------------------------------------------------

const N = 20;
const TEN = 10;
const R = 5;
const BETA = 25 / 6;
/** The report's outcome noise, in mu. */
const S_MU = 2 * Math.SQRT2 * BETA;
/** One mu on the Kustom scale: `logistic(Δmu / S_MU) = logistic(Δkustom / 400)`. */
const K_PER_MU = config.kustom.oddsScale / S_MU;
/** The latent margin, Kustom points, past which a game is a stomp (17 % of truly even games). */
export const STOMP = 2.376 * config.kustom.oddsScale;
/** One point of win chance at 50 %, in mu (the report's `PT_TO_MU`). */
const PT_TO_MU = 0.04 * S_MU;

/** The pre-M18.13 multipliers (`config.balance.roleMultipliers` until 8a708b46). */
const MULT = { main: 1, secondary: 0.93, fill: 0.85 } as const;
const B = config.balance;

type Tier = 'main' | 'secondary' | 'fill';

// ---------------------------------------------------------------------------------------------
// Random numbers, as sim.mjs draws them.
// ---------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

// ---------------------------------------------------------------------------------------------
// The world.
// ---------------------------------------------------------------------------------------------

export interface WorldPlayer {
  /** True skill, mu (the report's `t`). */
  t: number;
  main: number;
  sec: number;
  trueMult: number[];
  attend: number;
}

export interface World {
  seed: number;
  players: WorldPlayer[];
  /** Planted synergy, Kustom points added to a team's true strength when both are on it. */
  syn: Float64Array[];
}

/** `sim.mjs`'s `makeWorld(seed, synPts)`, draw for draw; synergy rescaled to Kustom points. */
export function makeWorld(seed: number, synPts: number): World {
  const synMu = synPts * PT_TO_MU;
  const rng = mulberry32(seed * 7919 + 13);
  const bag = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j] as number, bag[i] as number];
  }
  const players: WorldPlayer[] = [];
  for (let i = 0; i < N; i += 1) {
    const t = Math.min(35, Math.max(17, 25 + 3 * normal(rng)));
    const main = bag[i] as number;
    let sec: number;
    do {
      sec = Math.floor(rng() * R);
    } while (sec === main);
    const flex = rng() < 0.1;
    const trueMult: number[] = [];
    for (let r = 0; r < R; r += 1) {
      if (r === main) trueMult.push(1);
      else if (r === sec) trueMult.push(flex ? 0.97 : 0.88 + 0.1 * rng());
      else trueMult.push(flex ? 0.92 + 0.05 * rng() : 0.74 + 0.18 * rng());
    }
    players.push({ t, main, sec, trueMult, attend: 0.35 + 0.6 * rng() });
  }
  const syn = Array.from({ length: N }, () => new Float64Array(N));
  if (synMu > 0) {
    const used = new Set<string>();
    const pick = (sign: number): void => {
      for (;;) {
        const a = Math.floor(rng() * N);
        const b = Math.floor(rng() * N);
        if (a === b) continue;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (used.has(key)) continue;
        used.add(key);
        const v = sign * synMu * (0.75 + 0.5 * rng()) * K_PER_MU;
        (syn[a] as Float64Array)[b] = v;
        (syn[b] as Float64Array)[a] = v;
        return;
      }
    };
    for (let k = 0; k < 5; k += 1) pick(1);
    for (let k = 0; k < 3; k += 1) pick(-1);
  }
  return { seed, players, syn };
}

/** A player's true strength on a role, Kustom points. */
function trueStrength(p: WorldPlayer, role: number): number {
  return KUSTOM_START + (p.t * (p.trueMult[role] as number) - 25) * K_PER_MU;
}

// ---------------------------------------------------------------------------------------------
// The balancers.
// ---------------------------------------------------------------------------------------------

export type VariantName = 'before' | 'after' | 'flatOnly' | 'varietyOnly' | 'random';
export const VARIANTS: readonly VariantName[] = ['before', 'after', 'flatOnly', 'varietyOnly', 'random'];

/** One of the ten as both balancers read it. `id` is the world index; puuids sort like ids. */
export interface SimSeat {
  id: number;
  r: number;
  n: number;
  main: number;
  sec: number;
  sinceFill: number | null;
}

export interface PortOptions {
  strength: 'multiplier' | 'flat';
  variety: boolean;
}

export interface Chosen {
  /** World ids, lane order. */
  blue: { id: number; role: number }[];
  red: { id: number; role: number }[];
  gap: number;
  score: number;
  offRoleCount: number;
}

export const puuidOf = (id: number): string => `p${String(id).padStart(2, '0')}`;

function tierOf(seat: SimSeat, role: number): Tier {
  return role === seat.main ? 'main' : role === seat.sec ? 'secondary' : 'fill';
}

const PERMS: number[][] = (() => {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (const [i, r] of rest.entries()) walk([...prefix, r], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  walk([], [0, 1, 2, 3, 4]);
  return out;
})();

/** The 126 blue sides with index 0 on blue, in core's `BLUE_COMPANIONS` order, as bitmasks. */
const BLUE_MASKS: number[] = (() => {
  const out: number[] = [];
  for (let a = 1; a < TEN; a += 1)
    for (let b = a + 1; b < TEN; b += 1)
      for (let c = b + 1; c < TEN; c += 1)
        for (let d = c + 1; d < TEN; d += 1) out.push(1 | (1 << a) | (1 << b) | (1 << c) | (1 << d));
  return out;
})();
const FULL = (1 << TEN) - 1;

interface TeamPick {
  idx: number[];
  sum: number;
  off: number;
  cost: number;
  roles: number[];
}

/**
 * A port of core's `balance()` scoring (`packages/core/src/balance/index.ts`), split 1 only, with
 * the strength rule and the variety term switchable. `ten` sorted by id. No duo locks (none in
 * production either). Same permutation order, the same `> best + 1e-9` lane pick, the same
 * comparator (score, then off-role count, then the sorted blue puuids).
 */
export function portBalance(
  ten: readonly SimSeat[],
  lastBlue: ReadonlySet<number> | null,
  recentPairs: ReadonlySet<string> | null,
  options: PortOptions,
): Chosen {
  const eff: number[][] = [];
  const offRole: boolean[][] = [];
  const offCost: number[] = [];
  for (const seat of ten) {
    const e: number[] = [];
    const o: boolean[] = [];
    for (let r = 0; r < R; r += 1) {
      const tier = tierOf(seat, r);
      e.push(options.strength === 'flat' ? seat.r - B.roleDrop[tier] : seat.r * MULT[tier]);
      o.push(tier !== 'main');
    }
    eff.push(e);
    offRole.push(o);
    const since = seat.sinceFill;
    offCost.push(
      since === null ? B.offRolePenalty : B.offRolePenalty * (1 + B.fillProtectionFactor / (Math.max(0, since) + 1)),
    );
  }

  const cache = new Map<number, TeamPick>();
  const team = (mask: number): TeamPick => {
    const hit = cache.get(mask);
    if (hit !== undefined) return hit;
    const idx: number[] = [];
    for (let b = 0; b < TEN; b += 1) if ((mask >> b) & 1) idx.push(b);
    let best: TeamPick | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const perm of PERMS) {
      let sum = 0;
      let off = 0;
      let cost = 0;
      for (let k = 0; k < 5; k += 1) {
        const i = idx[k] as number;
        const r = perm[k] as number;
        sum += (eff[i] as number[])[r] as number;
        if ((offRole[i] as boolean[])[r]) {
          off += 1;
          cost += offCost[i] as number;
        }
      }
      if (sum - cost > bestValue + 1e-9) {
        bestValue = sum - cost;
        best = { idx, sum, off, cost, roles: perm };
      }
    }
    const pick = best as TeamPick;
    cache.set(mask, pick);
    return pick;
  };

  const pairsIn = (pick: TeamPick): number => {
    if (recentPairs === null) return 0;
    let n = 0;
    for (let x = 0; x < 5; x += 1)
      for (let y = x + 1; y < 5; y += 1) {
        const a = (ten[pick.idx[x] as number] as SimSeat).id;
        const b = (ten[pick.idx[y] as number] as SimSeat).id;
        if (recentPairs.has(a < b ? `${a}-${b}` : `${b}-${a}`)) n += 1;
      }
    return n;
  };

  let best: { score: number; off: number; blueIds: number[]; blue: TeamPick; red: TeamPick; gap: number } | null =
    null;
  for (const mask of BLUE_MASKS) {
    const blue = team(mask);
    const red = team(FULL ^ mask);
    const gap = Math.abs(blue.sum - red.sum);
    const blueIds = blue.idx.map((i) => (ten[i] as SimSeat).id);
    const redIds = red.idx.map((i) => (ten[i] as SimSeat).id);
    const isRepeat =
      lastBlue !== null && (blueIds.every((x) => lastBlue.has(x)) || redIds.every((x) => lastBlue.has(x)));
    const variety = options.variety ? Math.min(B.varietyCap, B.varietyPerPair * (pairsIn(blue) + pairsIn(red))) : 0;
    const score = gap + (blue.cost + red.cost) + (isRepeat ? B.repeatSplitPenalty : 0) + variety;
    const off = blue.off + red.off;
    const better =
      best === null ||
      (Math.abs(score - best.score) > 1e-9
        ? score < best.score
        : off !== best.off
          ? off < best.off
          : blueIds.map(puuidOf).join(',') < best.blueIds.map(puuidOf).join(','));
    if (better) best = { score, off, blueIds, blue, red, gap };
  }
  const chosen = best as NonNullable<typeof best>;
  const lanes = (pick: TeamPick) =>
    pick.idx
      .map((i, k) => ({ id: (ten[i] as SimSeat).id, role: pick.roles[k] as number }))
      .sort((x, y) => x.role - y.role);
  return {
    blue: lanes(chosen.blue),
    red: lanes(chosen.red),
    gap: Math.round(chosen.gap),
    score: chosen.score,
    offRoleCount: chosen.off,
  };
}

/** Core's `balance()`, exactly as the roll path calls it (`apps/web/lib/ingest/balance.ts`). */
export function coreBalance(
  ten: readonly SimSeat[],
  lastBlue: ReadonlySet<number> | null,
  recentPairs: ReadonlySet<string> | null,
): Chosen {
  const players: BalancePlayer[] = ten.map((seat) => ({
    puuid: puuidOf(seat.id),
    name: puuidOf(seat.id),
    r: seat.r,
    n: seat.n,
    mainRole: ROLES[seat.main] ?? null,
    secondaryRole: ROLES[seat.sec] ?? null,
    gamesSinceLastFill: seat.sinceFill,
  }));
  const recentTeammates: Duo[] = [];
  for (const key of recentPairs ?? []) {
    const [a, b] = key.split('-').map(Number) as [number, number];
    recentTeammates.push([puuidOf(a), puuidOf(b)]);
  }
  const result = balance({
    players,
    duos: [],
    lastSplit: lastBlue === null ? null : [...lastBlue].map(puuidOf),
    recentTeammates,
  });
  const split = result.splits[0];
  if (split === undefined) throw new Error('coreBalance: no split');
  const back = (side: typeof split.blue) =>
    side.map((a) => ({ id: Number(a.puuid.slice(1)), role: ROLES.indexOf(a.role) }));
  return {
    blue: back(split.blue),
    red: back(split.red),
    gap: split.gap,
    score: split.score,
    offRoleCount: split.offRoleCount,
  };
}

// ---------------------------------------------------------------------------------------------
// One run: the report's night loop, Kustom ratings.
// ---------------------------------------------------------------------------------------------

export interface GameRecord {
  /** True blue win chance. */
  pTrue: number;
  /** The latent margin (true difference plus noise), Kustom points. */
  D: number;
  /** The shown win chance (`winProbability` on the plain Ratings). */
  pPred: number;
  /** Seats not on the player's main. */
  off: number;
  /** Same-side pairs who were also teammates in the night's previous game. */
  repeats: number;
  /** Whether this game's ten are exactly the previous game's ten (variety cannot tell splits apart). */
  sameTen: boolean;
  seats: { id: number; role: number }[];
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function run(world: World, variant: VariantName, games: number): GameRecord[] {
  const rng = mulberry32(world.seed * 104729 + 7);
  const rngSplit = mulberry32(world.seed * 31 + 3);
  const P = world.players;
  const r = new Float64Array(N).fill(KUSTOM_START);
  const n = new Int32Array(N);
  const sinceFill: (number | null)[] = new Array(N).fill(null);
  const lastByRoster = new Map<string, Set<number>>();
  const recs: GameRecord[] = [];
  let g = 0;
  while (g < games) {
    const present: number[] = [];
    for (let i = 0; i < N; i += 1) if (rng() < (P[i] as WorldPlayer).attend) present.push(i);
    if (present.length < 10) {
      rng();
      continue;
    }
    const tonight = new Map(present.map((i) => [i, 0]));
    const nGames = 4 + Math.floor(rng() * 3);
    let prevPairs: Set<string> | null = null;
    let prevTen: string | null = null;
    for (let gi = 0; gi < nGames && g < games; gi += 1) {
      const order = present
        .map((i) => [i, tonight.get(i) as number, rng()] as const)
        .sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      const tenIds = order
        .slice(0, 10)
        .map((x) => x[0])
        .sort((a, b) => a - b);
      const ten: SimSeat[] = tenIds.map((id) => ({
        id,
        r: r[id] as number,
        n: n[id] as number,
        main: (P[id] as WorldPlayer).main,
        sec: (P[id] as WorldPlayer).sec,
        sinceFill: sinceFill[id] ?? null,
      }));
      const rk = tenIds.join(',');
      const lastBlue = lastByRoster.get(rk) ?? null;

      let split: Pick<Chosen, 'blue' | 'red'>;
      if (variant === 'random') {
        split = randomSplit(ten, rngSplit);
      } else if (variant === 'after') {
        split = coreBalance(ten, lastBlue, prevPairs);
      } else {
        split = portBalance(ten, lastBlue, prevPairs, {
          strength: variant === 'before' || variant === 'varietyOnly' ? 'multiplier' : 'flat',
          variety: variant === 'varietyOnly',
        });
      }

      const strength = (side: readonly { id: number; role: number }[]): number => {
        let s = 0;
        for (const { id, role } of side) s += trueStrength(P[id] as WorldPlayer, role);
        for (let x = 0; x < 5; x += 1)
          for (let y = x + 1; y < 5; y += 1)
            s += (world.syn[(side[x] as { id: number }).id] as Float64Array)[(side[y] as { id: number }).id] as number;
        return s;
      };
      const diff = strength(split.blue) - strength(split.red);
      const u = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
      const scale = config.kustom.oddsScale;
      const D = diff + scale * Math.log(u / (1 - u));
      const blueWon = D > 0;
      const sumR = (side: readonly { id: number }[]) => side.reduce((s, a) => s + (r[a.id] as number), 0);
      const pPred = winProbability(sumR(split.blue), sumR(split.red));
      const seats = [...split.blue, ...split.red];
      const off = seats.filter(({ id, role }) => role !== (P[id] as WorldPlayer).main).length;
      const pairs = new Set<string>();
      let repeats = 0;
      for (const side of [split.blue, split.red])
        for (let x = 0; x < 5; x += 1)
          for (let y = x + 1; y < 5; y += 1) {
            const key = pairKey((side[x] as { id: number }).id, (side[y] as { id: number }).id);
            pairs.add(key);
            if (prevPairs?.has(key)) repeats += 1;
          }
      recs.push({ pTrue: logistic(diff / scale), D, pPred, off, repeats, sameTen: prevTen === rk, seats });

      const rows = rateGameKustom({
        players: seats.map(({ id }, k) => ({
          puuid: puuidOf(id),
          side: k < 5 ? 100 : 200,
          r: r[id] as number,
          n: n[id] as number,
          score: null,
        })),
        winningSide: blueWon ? 100 : 200,
      });
      for (const row of rows) {
        const id = Number(row.puuid.slice(1));
        r[id] = row.rAfter;
        n[id] = (n[id] as number) + 1;
      }
      for (const { id, role } of seats) {
        const prev = sinceFill[id] ?? null;
        sinceFill[id] = role !== (P[id] as WorldPlayer).main ? 0 : prev === null ? null : prev + 1;
      }
      lastByRoster.set(rk, new Set(split.blue.map((x) => x.id)));
      for (const id of tenIds) tonight.set(id, (tonight.get(id) as number) + 1);
      prevPairs = pairs;
      prevTen = rk;
      g += 1;
    }
  }
  return recs;
}

/** The report's `random` variant: a random five, best lanes per side by the M18.2 rule. */
function randomSplit(ten: readonly SimSeat[], rng: () => number): Pick<Chosen, 'blue' | 'red'> {
  const mask = (BLUE_MASKS[Math.floor(rng() * BLUE_MASKS.length)] as number) ^ (rng() < 0.5 ? 0 : FULL);
  const best = (idx: number[]) => {
    let bestValue = Number.NEGATIVE_INFINITY;
    let bestPerm = PERMS[0] as number[];
    for (const perm of PERMS) {
      let s = 0;
      for (let k = 0; k < 5; k += 1) {
        const seat = ten[idx[k] as number] as SimSeat;
        const tier = tierOf(seat, perm[k] as number);
        s += seat.r * MULT[tier];
        if (tier !== 'main') {
          const since = seat.sinceFill;
          s -= since === null ? B.offRolePenalty : B.offRolePenalty * (1 + B.fillProtectionFactor / (since + 1));
        }
      }
      if (s > bestValue) {
        bestValue = s;
        bestPerm = perm;
      }
    }
    return idx.map((i, k) => ({ id: (ten[i] as SimSeat).id, role: bestPerm[k] as number }));
  };
  const blueIdx: number[] = [];
  const redIdx: number[] = [];
  for (let b = 0; b < TEN; b += 1) ((mask >> b) & 1 ? blueIdx : redIdx).push(b);
  return { blue: best(blueIdx), red: best(redIdx) };
}

// ---------------------------------------------------------------------------------------------
// Metrics, as experiment.mjs and fills.mjs compute them.
// ---------------------------------------------------------------------------------------------

export interface Metrics {
  /** Mean |true P − 50|, points of win chance. */
  trueEdge: number;
  /** % of games with |latent margin| past `STOMP`. */
  stomp: number;
  /** Mean |shown P − 50|. */
  shownEdge: number;
  off: number;
  repeats: number;
  /** % of games whose ten were exactly the previous game's ten. */
  sameTen: number;
}

export function metrics(recs: readonly GameRecord[]): Metrics {
  const mean = (f: (x: GameRecord) => number) => recs.reduce((s, x) => s + f(x), 0) / recs.length;
  return {
    trueEdge: mean((x) => Math.abs(x.pTrue - 0.5) * 100),
    stomp: mean((x) => (Math.abs(x.D) > STOMP ? 100 : 0)),
    shownEdge: mean((x) => Math.abs(x.pPred - 0.5) * 100),
    off: mean((x) => x.off),
    repeats: mean((x) => x.repeats),
    sameTen: mean((x) => (x.sameTen ? 100 : 0)),
  };
}

/** Off-main seats and all seats by true-skill third of the world (7 / 6 / 7, fills.mjs). */
export function fillsByThird(world: World, recs: readonly GameRecord[]): { off: number; seats: number }[] {
  const order = world.players
    .map((p, i) => [p.t, i] as const)
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);
  const third = new Array<number>(N);
  order.forEach((id, k) => {
    third[id] = k < 7 ? 0 : k < 13 ? 1 : 2;
  });
  const out = [0, 1, 2].map(() => ({ off: 0, seats: 0 }));
  for (const rec of recs)
    for (const { id, role } of rec.seats) {
      const cell = out[third[id] as number] as { off: number; seats: number };
      cell.seats += 1;
      if (role !== (world.players[id] as WorldPlayer).main) cell.off += 1;
    }
  return out;
}
