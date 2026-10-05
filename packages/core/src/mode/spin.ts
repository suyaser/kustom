/**
 * Spin and the region draw (M15.2, brief D3 and D4). Both take an injected RNG so the server
 * owns the randomness and a test can pin every outcome.
 *
 * Determinism: candidates are sorted by a stable key before the RNG reads them, so the order a
 * caller passes never changes the answer.
 */

import {
  type ChampionTable,
  type Mode,
  type RegionId,
  type RegionPair,
  RULE_OPTIONS,
  type RuleFamily,
  type RuleOption,
  ruleKey,
  ruleOf,
} from './model';
import { type Bans, drawableRegions, pairTester, regionOpenCounts } from './pool';

/**
 * The families Spin draws from, in draw order. Mirror joined at M17.17; since M22.11 the host
 * opens the Blind Pick custom in League themselves. Still a subset of `RULE_FAMILIES`, so a
 * standing mode is never a Spin result.
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
 * What the region draw reads: the roster and the bans to count (preferred: the draw then applies
 * M20 D2's shared-champion rule), or bare open counts per region (no champion can be seen as
 * shared, so each pair's union is read as the sum: right only for disjoint regions).
 */
export type RegionDrawSource = { roster: ChampionTable; bans: Bans } | ReadonlyMap<RegionId, number>;

/**
 * Region wars' draw at Roll: blue uniformly from the candidate regions that have at least one
 * partner passing `pairDrawable` (so the draw never dead-ends), then red uniformly from blue's
 * passing partners, so which side gets which is part of the draw. Candidates are sorted by id and
 * never `unaffiliated`. `null` when no pair passes.
 *
 * `exclude` (M20.6, Redraw) removes one unordered pair: neither `{ blue, red }` nor its swap can be
 * drawn, so a redraw always changes at least one region.
 */
export function drawRegions(
  regions: Iterable<RegionId>,
  source: RegionDrawSource,
  rng: Rng,
  exclude?: RegionPair,
): RegionPair | null {
  let openCounts: ReadonlyMap<RegionId, number>;
  let passes: (blue: RegionId, red: RegionId) => boolean;
  if ('roster' in source) {
    openCounts = regionOpenCounts(source.roster, source.bans);
    passes = pairTester(source.roster, source.bans);
  } else {
    openCounts = source;
    // Disjoint regions: 8 + 8 is already 16 different, so two drawable regions always pass.
    passes = (blue, red) => blue !== red;
  }
  const eligible = drawableRegions(openCounts, regions);
  const excluded = (blue: RegionId, red: RegionId) =>
    exclude !== undefined &&
    ((blue === exclude.blue && red === exclude.red) || (blue === exclude.red && red === exclude.blue));
  const partners = (blue: RegionId) => eligible.filter((red) => passes(blue, red) && !excluded(blue, red));
  const blues = eligible.filter((blue) => partners(blue).length > 0);
  if (blues.length === 0) return null;
  const blue = pick(blues, rng);
  const red = pick(partners(blue), rng);
  return { blue, red };
}
