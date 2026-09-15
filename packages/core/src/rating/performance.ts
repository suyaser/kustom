/**
 * The performance score and the MVP / ACE bonus (M7.8, revised in place by M7.13).
 * Spec: docs/01-architecture.md "The performance score and the MVP / ACE bonus" and the M7.8
 * and M7.13 briefs in docs/02-milestones.md.
 *
 * Three functions and nothing else:
 *
 * - `performanceScores` — six weighted components, each normalised inside the game, one score
 *   in `[0, 1]` per player. Comparable only inside its own game, which is all this needs.
 *   **Which of three weight vectors multiplies those six is picked by the player's own role**
 *   (M7.13): `carry` for top/mid/adc, `jungle`, `support`.
 * - `mvpAce` — the MVP is the best score on the winning side, the ACE the best on the losing
 *   side. Both are op.gg's words for op.gg's idea; the formula here is ours.
 * - `applyMvpAceBonus` — a bounded, post-hoc adjustment to the `mu` deltas a fold already
 *   produced. **Applied after `rateGame`, never inside it**, so the base rating maths stays
 *   untouched and independently testable.
 *
 * There is exactly one scorer in this project and it is this one. M7.13 revised M7.8's weights
 * in place rather than layering a second formula beside them, because nothing M7.8 produced
 * had ever reached a player.
 *
 * Pure: no clock, no I/O, no network, and specifically no call to op.gg or any other service.
 * Arithmetic over numbers the League client already gave us.
 */

import { config, type PerformanceBucket } from '../config';
import type { Rating, Role, Side } from '../types';

const { performance: WEIGHTS, performanceBucket: BUCKET_OF_ROLE, mvp: MVP } = config.rating;

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

/**
 * A player in one game: their key, their side, the role they played, their stat line.
 *
 * `role` is as optional as the stats are, and for the same reason: every backfilled game
 * carries `role = null` for all ten, and a game where any of the ten has no role has no MVP.
 * A value outside the five roles — one that got past the type, out of a database column — is
 * treated as no role too. It never falls back to `carry`: a silent default is a guess printed
 * as a fact.
 */
export interface PerformancePlayer extends PerformanceStats {
  puuid: string;
  side: Side;
  role: Role | null | undefined;
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
 * The weight vector this role is scored on, or `null` for no role and for anything that is
 * not one of the five. The map itself lives in `config.rating.performanceBucket` and only
 * there; this reads it defensively because the value arrives from a nullable text column.
 */
function bucketOf(role: Role | null | undefined): PerformanceBucket | null {
  if (typeof role !== 'string') return null;
  if (!Object.hasOwn(BUCKET_OF_ROLE, role)) return null;
  return BUCKET_OF_ROLE[role];
}

/**
 * Score one game's players against each other. Returns one score per player, in input order,
 * or `null` when any of the six components — or the role that picks the weights — is missing
 * for any of them, in which case the game has no MVP and no ACE and is rated exactly as it
 * was before M7.8.
 *
 * Role is an input like the other eight numbers, so it declines the same way: per game, never
 * per player. Scoring the role-less player on somebody else's vector would be exactly the
 * partial answer that rule exists to refuse.
 *
 * Normalisation is over the players passed in, which is the game's ten, so a score means
 * nothing outside its own game. It does not depend on the buckets: every player's components
 * are still divided by the best of the ten, whatever role held it.
 */
export function performanceScores(players: readonly PerformancePlayer[]): PerformanceScore[] | null {
  if (players.length === 0) {
    throw new Error('performanceScores: needs at least one player to normalise against');
  }
  const values: Record<Component, number>[] = [];
  const buckets: PerformanceBucket[] = [];
  for (const p of players) {
    const bucket = bucketOf(p.role);
    if (bucket === null) return null;
    const v = componentsOf(p);
    if (v === null) return null;
    values.push(v);
    buckets.push(bucket);
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
    const weights = WEIGHTS[buckets[i] as PerformanceBucket];
    let score = 0;
    for (const c of COMPONENTS) {
      const best = max[c];
      // A component nobody scored on contributes zero to everybody, rather than 0 / 0,
      // whatever this player's bucket weights say about it.
      if (best <= 0) continue;
      const share = v[c] / best;
      score += weights[c] * (share < 0 ? 0 : share > 1 ? 1 : share);
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
 * vision, a backfilled game that knows nobody's role. There is no partial answer and no MVP
 * without an ACE.
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
