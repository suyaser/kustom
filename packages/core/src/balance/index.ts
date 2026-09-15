/**
 * Balancer: ten players in, the best three 5v5 splits out, each with roles and one sentence.
 * Spec: docs/01-architecture.md "Balancer" and the M1.4 brief in docs/02-milestones.md.
 *
 * Pure. No clock, no I/O, no randomness. Same ten players in any order give byte-identical
 * output: players are sorted by puuid, the lowest puuid is always on blue, and every tie is
 * broken by a stable key.
 */

import { config } from '../config';
import { predictWin } from '../rating/index';
import { ROLES } from '../types';
import { explain } from './explain';
import { roleTier } from './roles';
import type { Assignment, BalanceInput, BalancePlayer, BalanceResult, Duo, Split } from './types';

export { explain } from './explain';
/**
 * Re-exported for the display surfaces (M3.1's teams embed marks an off-role line; M3.6's
 * tonight page prints an overridden row as `<override> · <old main>`). One rule for "off-role"
 * and one for "tonight's main and backup" in the product: the scorer, the explanation, every
 * embed and the page ask these, never a re-derived `role !== mainRole`.
 */
export { isOffRole, type ResolvedRoles, type RoleProfile, resolveRoles } from './roles';
export type { Assignment, BalanceInput, BalancePlayer, BalanceResult, Duo, Split } from './types';

/** Thrown for every input the balancer refuses. The message is written for a Discord line. */
export class BalanceError extends Error {
  override readonly name = 'BalanceError';
}

const { balance: cfg } = config;
const DISPLAY = config.rating.displayMultiplier;
const PLAYERS = 10;
const TEAM = 5;

/**
 * Two scores closer than this are a tie and fall through to the next tie-break key. The
 * inputs carry two decimals of `mu`, so real differences are at least 0.6 display points;
 * anything below this is floating-point noise from summing in a different order.
 */
const EPSILON = 1e-9;

/** A player after role rules are applied: what each role is worth and whether it is off-role. */
interface Prepared {
  readonly index: number;
  readonly puuid: string;
  readonly mu: number;
  readonly sigma: number;
  /** Effective skill per role, display units, indexed like `ROLES`. */
  readonly effective: readonly number[];
  /** Whether playing each role counts as off-role, indexed like `ROLES`. */
  readonly offRole: readonly boolean[];
  /**
   * What one off-role seat costs this player, display units: `offRolePenalty` at baseline,
   * scaled up by fill protection for somebody filled recently. Read by `assignRoles` **and**
   * by the split score, which is the point — see `offRoleCostOf`.
   */
  readonly offRoleCost: number;
}

interface TeamAssignment {
  readonly sum: number;
  readonly offRoleCount: number;
  /** Sum of `offRoleCost` over this team's off-role seats, display units. */
  readonly offRoleCost: number;
  /** Role index per team member, in team order. */
  readonly roles: readonly number[];
}

/** All 120 orderings of `[0..4]`, built once, in lexicographic order so ties resolve stably. */
const PERMUTATIONS: readonly (readonly number[])[] = (() => {
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

/** Every way to choose four of nine, in lexicographic order. With index 0 fixed on blue: 126 partitions. */
const BLUE_COMPANIONS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let a = 1; a < PLAYERS; a += 1)
    for (let b = a + 1; b < PLAYERS; b += 1)
      for (let c = b + 1; c < PLAYERS; c += 1)
        for (let d = c + 1; d < PLAYERS; d += 1) out.push([a, b, c, d]);
  return out;
})();

/**
 * What one off-role seat costs this player (M7.5):
 * `offRolePenalty * (1 + fillProtectionFactor / (gamesSinceLastFill + 1))`.
 *
 * 240 for somebody filled in their last game, 180 one game later, 150 after three, 132 after
 * nine, decaying to the flat 120. `null`, absent, or anything that is not a finite number is
 * the flat 120 — no history to read is the baseline, not maximum protection. A negative count
 * reads as 0, so the term is bounded by `1 + fillProtectionFactor` and can never blow up.
 *
 * Returned as one number per player so the two places that charge for a fill — `assignRoles`,
 * which prices a team's 120 role permutations, and the split score — cannot disagree: the
 * permutation search returns the cost it actually charged and the score adds up those.
 */
function offRoleCostOf(player: BalancePlayer): number {
  const since = player.gamesSinceLastFill ?? null;
  if (since === null || !Number.isFinite(since)) return cfg.offRolePenalty;
  return cfg.offRolePenalty * (1 + cfg.fillProtectionFactor / (Math.max(0, since) + 1));
}

/** Price every role for a player, in display units, and mark which roles are off-role. */
function prepare(player: BalancePlayer, index: number): Prepared {
  const base = player.mu * DISPLAY;
  const effective: number[] = [];
  const offRole: boolean[] = [];
  for (const role of ROLES) {
    const tier = roleTier(player, role);
    effective.push(base * cfg.roleMultiplier[tier]);
    offRole.push(tier !== 'main');
  }
  return {
    index,
    puuid: player.puuid,
    mu: player.mu,
    sigma: player.sigma,
    effective,
    offRole,
    offRoleCost: offRoleCostOf(player),
  };
}

/** Best of the 120 role assignments for one team: max `sum(effective) - each fill's cost`. */
function assignRoles(team: readonly Prepared[]): TeamAssignment {
  let best: TeamAssignment | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const perm of PERMUTATIONS) {
    let sum = 0;
    let off = 0;
    let cost = 0;
    for (let i = 0; i < TEAM; i += 1) {
      const p = team[i];
      const r = perm[i];
      if (p === undefined || r === undefined) throw new Error('assignRoles: team must have five players');
      sum += p.effective[r] ?? 0;
      if (p.offRole[r] === true) {
        off += 1;
        cost += p.offRoleCost;
      }
    }
    const value = sum - cost;
    if (value > bestValue + EPSILON) {
      bestValue = value;
      best = { sum, offRoleCount: off, offRoleCost: cost, roles: perm };
    }
  }
  if (best === null) throw new Error('assignRoles: no permutation evaluated');
  return best;
}

/** Union-find over player indices, so `[A,B]` and `[B,C]` become one block. */
function duoBlocks(
  duos: readonly Duo[],
  byPuuid: ReadonlyMap<string, Prepared>,
  names: ReadonlyMap<string, string>,
): number[][] {
  const parent = Array.from({ length: PLAYERS }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    return root;
  };
  for (const [a, b] of duos) {
    if (a === b) throw new BalanceError(`Duo names the same player twice: ${names.get(a) ?? a}.`);
    const pa = byPuuid.get(a);
    const pb = byPuuid.get(b);
    if (pa === undefined) throw new BalanceError(`Duo names someone not in the lobby: ${a}.`);
    if (pb === undefined) throw new BalanceError(`Duo names someone not in the lobby: ${b}.`);
    const ra = find(pa.index);
    const rb = find(pb.index);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < PLAYERS; i += 1) {
    const root = find(i);
    const g = groups.get(root);
    if (g === undefined) groups.set(root, [i]);
    else g.push(i);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function validate(input: BalanceInput): void {
  if (input.players.length !== PLAYERS) {
    throw new BalanceError(`Balancing needs exactly ten players, got ${input.players.length}.`);
  }
  const seen = new Set<string>();
  for (const { puuid } of input.players) {
    if (seen.has(puuid)) throw new BalanceError(`Duplicate player: ${puuid}.`);
    seen.add(puuid);
  }
  const last = input.lastSplit ?? null;
  if (last !== null) {
    const unique = new Set(last);
    if (last.length !== TEAM || unique.size !== TEAM || [...unique].some((p) => !seen.has(p))) {
      throw new BalanceError(
        `lastSplit must be five different players from the lobby, got [${last.join(', ')}].`,
      );
    }
  }
}

function toAssignments(team: readonly Prepared[], roles: readonly number[]): Assignment[] {
  const out: Assignment[] = [];
  for (const [ri, role] of ROLES.entries()) {
    const i = roles.indexOf(ri);
    const p = team[i];
    if (p === undefined) throw new Error('toAssignments: role unassigned');
    out.push({ puuid: p.puuid, role });
  }
  return out;
}

function compareSplits(a: Split, b: Split): number {
  if (Math.abs(a.score - b.score) > EPSILON) return a.score - b.score;
  if (a.offRoleCount !== b.offRoleCount) return a.offRoleCount - b.offRoleCount;
  const ka = a.blue.map((x) => x.puuid).sort();
  const kb = b.blue.map((x) => x.puuid).sort();
  for (let i = 0; i < ka.length; i += 1) {
    const x = ka[i] ?? '';
    const y = kb[i] ?? '';
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Turn ten players into the best three splits, each with roles, a win chance, a gap and an
 * explanation. Throws `BalanceError` for anything other than ten distinct players, a duo naming
 * someone absent, duo locks that cannot fit five and five, or a `lastSplit` that is not five
 * players from the lobby.
 */
export function balance(input: BalanceInput): BalanceResult {
  validate(input);
  const sorted = [...input.players].sort((a, b) => (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0));
  const prepared = sorted.map(prepare);
  const byPuuid = new Map(prepared.map((p) => [p.puuid, p]));
  const names = new Map(sorted.map((p) => [p.puuid, p.name]));
  const blocks = duoBlocks(input.duos ?? [], byPuuid, names);
  const last = input.lastSplit ?? null;
  const lastIndices = last === null ? null : new Set(last.map((p) => byPuuid.get(p)?.index ?? -1));

  const candidates: Split[] = [];
  for (const companions of BLUE_COMPANIONS) {
    const blueIdx = new Set([0, ...companions]);
    if (blocks.some((block) => block.some((i) => blueIdx.has(i)) && block.some((i) => !blueIdx.has(i)))) {
      continue;
    }
    const blue = prepared.filter((p) => blueIdx.has(p.index));
    const red = prepared.filter((p) => !blueIdx.has(p.index));
    const blueRoles = assignRoles(blue);
    const redRoles = assignRoles(red);
    const rawGap = Math.abs(blueRoles.sum - redRoles.sum);
    const offRoleCount = blueRoles.offRoleCount + redRoles.offRoleCount;
    const isRepeat =
      lastIndices !== null &&
      (blue.every((p) => lastIndices.has(p.index)) || red.every((p) => lastIndices.has(p.index)));
    // The same per-player prices `assignRoles` charged, so a seat and the split that contains
    // it are never valued differently (M7.5).
    const score =
      rawGap + blueRoles.offRoleCost + redRoles.offRoleCost + (isRepeat ? cfg.repeatSplitPenalty : 0);
    candidates.push({
      blue: toAssignments(blue, blueRoles.roles),
      red: toAssignments(red, redRoles.roles),
      gap: Math.round(rawGap),
      blueWinProb: predictWin(
        blue.map(({ mu, sigma }) => ({ mu, sigma })),
        red.map(({ mu, sigma }) => ({ mu, sigma })),
      ),
      score,
      offRoleCount,
    });
  }

  if (candidates.length === 0) {
    const described = blocks
      .map((block) => block.map((i) => names.get(prepared[i]?.puuid ?? '') ?? '?').join(', '))
      .join('; ');
    throw new BalanceError(`Duo locks cannot fit five and five: ${described}.`);
  }

  const splits = candidates.sort(compareSplits).slice(0, cfg.splitsReturned);
  const explanations = splits.map((split, i) => explain(split, splits[i + 1] ?? null, sorted));
  return { splits, explanations };
}

/**
 * Reroll: the index of the next stored split, or a `BalanceError` when the list is exhausted.
 * Never reshuffles and never calls `balance` again, so two rerolls always land on the same split.
 */
export function nextSplit(splits: readonly Split[], currentIndex: number): number {
  const next = currentIndex + 1;
  if (next >= splits.length) throw new BalanceError('No more splits. Rebalance or play these.');
  return next;
}
