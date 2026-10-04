/**
 * The mode model (M15.2; brief `redesign/briefs/m15.1-mode-of-the-night.md`, D1 to D7).
 *
 * Two layers. The **standing mode** (`normal` or `fearless`) stays until an admin changes it.
 * A **rule** (class wars, region wars, mirror match) is layered on top for the next game only.
 * A `RuleOption` is what an admin picks or Spin lands on; a `Mode` is what a lobby locks at Roll
 * teams and a game is stamped with (region wars carries its two drawn regions there).
 *
 * Champion facts (Data Dragon tags, region) are input: core never imports a fixture.
 */

import { config } from '../config';

/** Every mode id, standing first. */
export const MODE_IDS = ['normal', 'fearless', 'class', 'region', 'mirror'] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** The two standing modes (`group_modes`, M14.29). */
export const STANDING_MODES = ['normal', 'fearless'] as const satisfies readonly ModeId[];
export type StandingModeId = (typeof STANDING_MODES)[number];

/** The rule families, in Spin's draw order. */
export const RULE_FAMILIES = ['class', 'region', 'mirror'] as const satisfies readonly ModeId[];
export type RuleFamily = (typeof RULE_FAMILIES)[number];

export type ModeFamily = 'standing' | RuleFamily;

/** The five class wars options, as Data Dragon spells the tag. No `Fighter` (R8). */
export const CLASS_TAGS = ['Tank', 'Marksman', 'Mage', 'Assassin', 'Support'] as const;
export type ClassTag = (typeof CLASS_TAGS)[number];

/** A region slug from the region table (M15.9), e.g. `ionia`, `shadow-isles`. */
export type RegionId = string;

/**
 * The region table's slug for a champion with no region: a known fact, never drawn, in no pool.
 * In `ChampionFacts` it is the empty set; `regionOpenCounts` tallies empty sets under this key.
 */
export const UNAFFILIATED: RegionId = 'unaffiliated';

/** Blue's and red's region for one region wars game, drawn at Roll. */
export interface RegionPair {
  blue: RegionId;
  red: RegionId;
}

/** A game's mode: what the lobby locks at Roll and the game is stamped with. */
export type Mode =
  | { id: 'normal' }
  | { id: 'fearless' }
  | { id: 'class'; tag: ClassTag }
  | ({ id: 'region' } & RegionPair)
  | { id: 'mirror' };

/** A rule an admin can pick or Spin can land on. Region wars has no sides until Roll. */
export type RuleOption = { id: 'class'; tag: ClassTag } | { id: 'region' } | { id: 'mirror' };

/** Every rule option, in select order: five classes, region wars, mirror match. */
export const RULE_OPTIONS: readonly RuleOption[] = [
  ...CLASS_TAGS.map((tag): RuleOption => ({ id: 'class', tag })),
  { id: 'region' },
  { id: 'mirror' },
];

/**
 * What core needs to know about one champion. `null` means "not in that table" (a champion newer
 * than the pin, a missing region row), which the check reports as `couldn't check`, never `broke`.
 *
 * `region` is a set (M20 D1): Riot Universe's region plus at most one Kustom home region, as a
 * readonly array. Membership is the only region fact: a champion is in every region it lists, in
 * both pools when both are drawn, and `kept` for either side. The empty set is `unaffiliated`
 * (known: in no region, in no pool, `broke` on any side). `UNAFFILIATED` inside a set is ignored.
 */
export interface ChampionFacts {
  tags: readonly string[] | null;
  region: readonly RegionId[] | null;
}

/** True when the champion's set names `region`. `unaffiliated` is never a member of anything. */
export function inRegion(facts: ChampionFacts | undefined, region: RegionId): boolean {
  return region !== UNAFFILIATED && (facts?.region?.includes(region) ?? false);
}

/** The roster: Data Dragon champion key (`game_players.champion_id`) to its facts. */
export type ChampionTable = ReadonlyMap<number, ChampionFacts>;

export function modeFamily(id: ModeId): ModeFamily {
  return id === 'normal' || id === 'fearless' ? 'standing' : id;
}

export function isStandingMode(id: string): id is StandingModeId {
  return id === 'normal' || id === 'fearless';
}

/** D5's table, from `config.modes.ratedDefault`. */
export function modeRatedDefault(id: ModeId): boolean {
  return config.modes.ratedDefault[id];
}

/** The rule a mode plays, or `null` for a standing mode. A locked region mode is region wars. */
export function ruleOf(mode: Mode | RuleOption): RuleOption | null {
  switch (mode.id) {
    case 'class':
      return { id: 'class', tag: mode.tag };
    case 'region':
      return { id: 'region' };
    case 'mirror':
      return { id: 'mirror' };
    default:
      return null;
  }
}

/** A stable key per rule (`class:Tank`, `region`, `mirror`), for sorting, sets and comparing. */
export function ruleKey(rule: RuleOption): string {
  return rule.id === 'class' ? `class:${rule.tag}` : rule.id;
}

/** True when both are the same rule. `null` (no rule) is never the same as anything. */
export function sameRule(a: RuleOption | null, b: RuleOption | null): boolean {
  return a !== null && b !== null && ruleKey(a) === ruleKey(b);
}
