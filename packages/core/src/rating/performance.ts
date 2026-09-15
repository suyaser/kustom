/**
 * The performance score and the MVP / ACE bonus (M7.8).
 * Spec: docs/01-architecture.md "The performance score and the MVP / ACE bonus" and the M7.8
 * brief in docs/02-milestones.md.
 *
 * Three functions and nothing else:
 *
 * - `performanceScores` — six weighted components, each normalised inside the game, one score
 *   in `[0, 1]` per player. Comparable only inside its own game, which is all this needs.
 * - `mvpAce` — the MVP is the best score on the winning side, the ACE the best on the losing
 *   side. Both are op.gg's words for op.gg's idea; the formula here is ours.
 * - `applyMvpAceBonus` — a bounded, post-hoc adjustment to the `mu` deltas a fold already
 *   produced. **Applied after `rateGame`, never inside it**, so the base rating maths stays
 *   untouched and independently testable.
 *
 * Pure: no clock, no I/O, no network, and specifically no call to op.gg or any other service.
 * Arithmetic over numbers the League client already gave us.
 */

import { config } from '../config';
import type { Rating, Side } from '../types';

const { performance: WEIGHTS, mvp: MVP } = config.rating;

/** Players per side. Same rule as `rateGame`: a League custom is 5v5 or it is not a game. */
const TEAM_SIZE = 5;

/**
 * The six components, in the order the brief's table lists them and the order they are summed
 * in. The order is part of the pinned arithmetic: changing it changes the last bits of a score.
 */
const COMPONENTS = ['kda', 'damageToChamps', 'gold', 'visionScore', 'damageSelfMitigated', 'cs'] as const;

type Component = (typeof COMPONENTS)[number];

/**
 * One player's raw stat line for one game. Every field is optional-ish on purpose: these come
 * from nullable database columns (`vision_score` and `damage_self_mitigated` only exist from
 * M7.7 on) and a game that is missing any one of them for any player simply has no MVP.
 */
export interface PerformanceStats {
  kills: number | null | undefined;
  deaths: number | null | undefined;
  assists: number | null | undefined;
  damageToChamps: number | null | undefined;
  gold: number | null | undefined;
  visionScore: number | null | undefined;
  damageSelfMitigated: number | null | undefined;
  cs: number | null | undefined;
}

/** A player in one game: their key, their side, their stat line. */
export interface PerformancePlayer extends PerformanceStats {
  puuid: string;
  side: Side;
}

/** One player's score for one game, in `[0, 1]`. */
export interface PerformanceScore {
  puuid: string;
  score: number;
}

/** Who carried each side. Both are puuids of players in the game that produced them. */
export interface MvpAce {
  mvp: string;
  ace: string;
}

/** What one fold did to one player: what `applyMvpAceBonus` takes and gives back. */
export interface RatingChange {
  puuid: string;
  before: Rating;
  after: Rating;
}

/** A real number, or `null` for "this game never stored it". `NaN` and `Infinity` are missing. */
function present(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The six component values for one player, or `null` if any of the eight numbers behind them
 * is missing. Partial scoring would rank a player who has a vision score against one who does
 * not, so there is no partial path.
 */
function componentsOf(p: PerformanceStats): Record<Component, number> | null {
  const kills = present(p.kills);
  const deaths = present(p.deaths);
  const assists = present(p.assists);
  const damageToChamps = present(p.damageToChamps);
  const gold = present(p.gold);
  const visionScore = present(p.visionScore);
  const damageSelfMitigated = present(p.damageSelfMitigated);
  const cs = present(p.cs);
  if (
    kills === null ||
    deaths === null ||
    assists === null ||
    damageToChamps === null ||
    gold === null ||
    visionScore === null ||
    damageSelfMitigated === null ||
    cs === null
  ) {
    return null;
  }
  return {
    kda: (kills + assists) / Math.max(1, deaths),
    damageToChamps,
    gold,
    visionScore,
    damageSelfMitigated,
    cs,
  };
}

/**
 * Score one game's players against each other. Returns one score per player, in input order,
 * or `null` when any of the six components is missing for any of them — in which case the
 * game has no MVP and no ACE and is rated exactly as it was before M7.8.
 *
 * Normalisation is over the players passed in, which is the game's ten, so a score means
 * nothing outside its own game.
 */
export function performanceScores(players: readonly PerformancePlayer[]): PerformanceScore[] | null {
  if (players.length === 0) {
    throw new Error('performanceScores: needs at least one player to normalise against');
  }
  const values: Record<Component, number>[] = [];
  for (const p of players) {
    const v = componentsOf(p);
    if (v === null) return null;
    values.push(v);
  }

  const max = {} as Record<Component, number>;
  for (const c of COMPONENTS) {
    let best = 0;
    for (const v of values) {
      if (v[c] > best) best = v[c];
    }
    max[c] = best;
  }

  return players.map((p, i) => {
    const v = values[i] as Record<Component, number>;
    let score = 0;
    for (const c of COMPONENTS) {
      const best = max[c];
      // A component nobody scored on contributes zero to everybody, rather than 0 / 0.
      if (best <= 0) continue;
      const share = v[c] / best;
      score += WEIGHTS[c] * (share < 0 ? 0 : share > 1 ? 1 : share);
    }
    return { puuid: p.puuid, score };
  });
}

/** Best score wins; a tie goes to the lower puuid, so the answer never depends on the array. */
function best(candidates: readonly PerformanceScore[]): string {
  let winner = candidates[0] as PerformanceScore;
  for (const c of candidates.slice(1)) {
    if (c.score > winner.score || (c.score === winner.score && c.puuid < winner.puuid)) {
      winner = c;
    }
  }
  return winner.puuid;
}

/**
 * The MVP (best score on the winning side) and the ACE (best score on the losing side), or
 * `null` when the game cannot be scored — a game stored before M7.7, a blob that never carried
 * vision. There is no partial answer and no MVP without an ACE.
 *
 * Five and five or it throws, exactly like `rateGame`: a remake or a nine-player game is gated
 * out long before this.
 */
export function mvpAce(players: readonly PerformancePlayer[], winningSide: Side): MvpAce | null {
  const blue = players.filter((p) => p.side === 100);
  const red = players.filter((p) => p.side === 200);
  if (blue.length !== TEAM_SIZE || red.length !== TEAM_SIZE || players.length !== 2 * TEAM_SIZE) {
    throw new Error(
      `mvpAce: needs five players a side, got ${blue.length} blue and ${red.length} red of ${players.length}`,
    );
  }
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.puuid)) throw new Error(`mvpAce: ${p.puuid} appears twice in one game`);
    seen.add(p.puuid);
  }

  const scores = performanceScores(players);
  if (scores === null) return null;

  const sideOf = new Map(players.map((p) => [p.puuid, p.side]));
  const losingSide: Side = winningSide === 100 ? 200 : 100;
  const on = (side: Side): PerformanceScore[] => scores.filter((s) => sideOf.get(s.puuid) === side);

  return { mvp: best(on(winningSide)), ace: best(on(losingSide)) };
}

/**
 * Scale the MVP's and the ACE's `mu` delta and leave the other eight alone. `delta` is
 * `after.mu - before.mu`:
 *
 * - MVP: `mu' = before.mu + delta * (1 + config.rating.mvp.bonusFraction)` — 1.25x.
 * - ACE: `mu' = before.mu + delta * (1 - config.rating.mvp.aceReliefFraction)` — 0.80x. The
 *   ACE's delta is negative, so this shrinks a loss; it never turns one into a gain.
 *
 * The bound is the construction: both factors are positive and fixed, so the sign of a delta
 * never flips and no term is unbounded. **`sigma` is never touched** — Proven has to keep
 * meaning "how sure the model is", and certainty is not something you earn by farming vision.
 *
 * With `award` of `null` (no MVP, no ACE) this is a copy of what the fold already produced.
 */
export function applyMvpAceBonus(changes: readonly RatingChange[], award: MvpAce | null): RatingChange[] {
  const copy = (c: RatingChange): RatingChange => ({
    puuid: c.puuid,
    before: { mu: c.before.mu, sigma: c.before.sigma },
    after: { mu: c.after.mu, sigma: c.after.sigma },
  });
  if (award === null) return changes.map(copy);

  for (const [title, puuid] of [
    ['mvp', award.mvp],
    ['ace', award.ace],
  ] as const) {
    if (changes.filter((c) => c.puuid === puuid).length !== 1) {
      throw new Error(`applyMvpAceBonus: ${title} ${puuid} is not in this game exactly once`);
    }
  }

  const factorFor = (puuid: string): number | null => {
    if (puuid === award.mvp) return 1 + MVP.bonusFraction;
    if (puuid === award.ace) return 1 - MVP.aceReliefFraction;
    return null;
  };

  return changes.map((c) => {
    const factor = factorFor(c.puuid);
    const out = copy(c);
    if (factor !== null) {
      out.after.mu = c.before.mu + (c.after.mu - c.before.mu) * factor;
    }
    return out;
  });
}
