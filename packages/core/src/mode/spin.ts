/**
 * Spin and the region draw (M15.2, brief D3 and D4). Both take an injected RNG so the server
 * owns the randomness and a test can pin every outcome.
 *
 * Determinism: candidates are sorted by a stable key before the RNG reads them, so the order a
 * caller passes never changes the answer.
 */

import {
  type Mode,
  type RegionId,
  type RegionPair,
  RULE_OPTIONS,
  type RuleFamily,
  type RuleOption,
  ruleKey,
  ruleOf,
} from './model';
import { drawableRegions } from './pool';

/**
 * The families Spin draws from, in draw order. Mirror joined at M17.17: Start a lobby asks the
 * companion for a Blind Pick custom when the next game's rule is mirror, so a surprise mirror no
 * longer lands on a host who has to build that lobby by hand. Still a subset of `RULE_FAMILIES`,
 * so a standing mode is never a Spin result.
 */
export const SPIN_FAMILIES = ['class', 'region', 'mirror'] as const satisfies readonly RuleFamily[];

/** Every rule option's key in the select's order: the stable key Spin sorts by. */
const ORDER = RULE_OPTIONS.map(ruleKey);

/** Returns a number in `[0, 1)`, like `Math.random`. Anything else is a `RangeError`. */
export type Rng = () => number;

function pick<T>(items: readonly T[], rng: Rng): T {
  const r = rng();
  if (!(Number.isFinite(r) && r >= 0 && r < 1)) throw new RangeError(`rng returned ${r}, expected [0, 1)`);
  return items[Math.floor(r * items.length)] as T;
}

/**
 * The server's Spin. A family uniformly from the families with an eligible option, then an
 * option uniformly inside it (so five classes do not drown region wars). Excluded: the previous
 * rule of tonight (`previousRule`, an option or the previous game's locked mode), anything
 * `playable` rejects, anything that is not a rule (a standing mode is never a result), and any
 * family outside `SPIN_FAMILIES` (today that is none: mirror joined at M17.17).
 * `null` when nothing is left.
 */
export function drawSpin(
  options: readonly RuleOption[],
  previousRule: RuleOption | Mode | null,
  playable: (rule: RuleOption) => boolean,
  rng: Rng,
): RuleOption | null {
  const previous = previousRule === null ? null : ruleOf(previousRule);
  const previousKey = previous === null ? null : ruleKey(previous);

  const byFamily = new Map<string, Map<string, RuleOption>>();
  for (const option of options) {
    const rule = ruleOf(option as Mode | RuleOption);
    if (rule === null) continue;
    const key = ruleKey(rule);
    // Only a known rule option: never a standing mode, never a class outside CLASS_TAGS.
    if (!ORDER.includes(key) || key === previousKey || !playable(rule)) continue;
    const family = byFamily.get(rule.id) ?? new Map<string, RuleOption>();
    family.set(key, rule);
    byFamily.set(rule.id, family);
  }

  // Only SPIN_FAMILIES, whatever the caller passed.
  const families = SPIN_FAMILIES.filter((family) => byFamily.has(family));
  if (families.length === 0) return null;
  const family = byFamily.get(pick(families, rng)) as Map<string, RuleOption>;
  // Stable key: the select's order (RULE_OPTIONS), never the caller's order.
  const choices = [...family.entries()]
    .sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .map(([, r]) => r);
  return pick(choices, rng);
}

/**
 * Region wars' draw at Roll: blue uniformly from the drawable regions (at least
 * `config.modes.regionMinOpen` open, never `unaffiliated`), then red uniformly from the rest, so
 * which side gets which is part of the draw. `null` when fewer than two regions qualify.
 */
export function drawRegions(
  regions: Iterable<RegionId>,
  openCounts: ReadonlyMap<RegionId, number>,
  rng: Rng,
): RegionPair | null {
  const eligible = drawableRegions(openCounts, regions);
  if (eligible.length < 2) return null;
  const blue = pick(eligible, rng);
  const red = pick(
    eligible.filter((region) => region !== blue),
    rng,
  );
  return { blue, red };
}
