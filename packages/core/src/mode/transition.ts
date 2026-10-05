/**
 * The Mode card's state as one pure transition (M20.6; decision rows M20 D6, D7, D9 to D11).
 * It replaced M15.2's version-token lifecycle (deleted in M20.8): there is no version and no
 * compare-and-set.
 *
 *   row (next game) ──take (Roll)──> lock (this game) ──recordGame (Rift)──> stamp; row untouched
 *        ^                               │
 *        └──── handBack (teams down, remake, ARAM): only into empty fields ┘
 *
 * - **The row** (`group_modes`) is `{ standing, pending, rated }`. A region rule always carries its
 *   pair (`PendingRule` has required `blue` and `red`): region wars is drawn when it is chosen.
 * - **Every action returns a patch** of only the fields it sets, so the server writes one update of
 *   exactly those fields and two admins can only overwrite what they both touched (D7).
 * - **Roll is a suggestion; the rule and Rated belong to the next game actually played** (the owner,
 *   2026-10-05). `take` moves them onto the lobby's lock; teams coming down hand them back
 *   (`handBack`); players moving sides by hand change nothing. `recordGame` stamps the lock if there
 *   is one, otherwise the pending state, which that game then uses up.
 *
 * Randomness is injected (`TransitionContext.rng`); nothing here reads a clock.
 */

import {
  type ChampionTable,
  type Mode,
  modeRatedDefault,
  type RegionId,
  type RegionPair,
  RULE_OPTIONS,
  type RuleOption,
  ruleOf,
  type StandingModeId,
  sameRule,
  UNAFFILIATED,
} from './model';
import { type Bans, drawableRegions, pairDrawable, pairTester, regionOpenCounts, rulePlayable } from './pool';
import { drawRegions, drawSpin, type Rng } from './spin';

/** A rule on the row or a lock. Region wars always has both regions; there is no region rule without them. */
export type PendingRule = Exclude<Mode, { id: StandingModeId }>;

/** The group's one mode row: the next game. */
export interface ModeRow {
  standing: StandingModeId;
  pending: PendingRule | null;
  /** The Rated switch; `null` is the next game's mode default. */
  rated: boolean | null;
}

/** The fields an action writes. Absent means "not touched", never "set to null". */
export type RowPatch = Partial<ModeRow>;

/**
 * This game: what Roll moved onto the lobby. `mode` is the rule, or the standing mode with no rule
 * (or on the no-draw path). `rated` is the switch as it was moved, `null` = the locked mode's
 * default (read it with {@link lockRated}); keeping it raw is what lets a hand-back restore the row
 * exactly.
 */
export interface ModeLock {
  /** The standing mode at Roll (what `games.mode` is stamped with). */
  standing: StandingModeId;
  mode: Mode;
  rated: boolean | null;
}

/** What the server reads for a draw: the champion facts, the region list, the bans and the RNG. */
export interface TransitionContext {
  roster: ChampionTable;
  /** The regions that may be drawn (the region table's ids). */
  regions: readonly RegionId[];
  /** The group's Fearless pool. Counted only when the standing mode of the target is Fearless. */
  fearlessPool: Bans;
  rng: Rng;
}

export type RegionAction =
  /** A new random pair passing the draw rule, never the same unordered pair. */
  | { type: 'redraw' }
  /** One side to a named region; the other side keeps its region. */
  | { type: 'set-side'; side: 'blue' | 'red'; region: RegionId };

export type ModeAction =
  /** Normal or Fearless: empties the rule and Rated. */
  | { type: 'standing'; standing: StandingModeId }
  /** A rule (region wars is drawn here, or keeps its pair when already pending). Resets Rated. */
  | { type: 'pick'; rule: RuleOption }
  | { type: 'rated'; rated: boolean }
  /**
   * The server's pick: never `previous` (tonight's previous rule), never a rule in `blocked` (e.g.
   * mirror while a lobby is already open), never an unplayable rule. Region wars draws a fresh pair.
   */
  | { type: 'spin'; previous: RuleOption | Mode | null; blocked?: readonly RuleOption[] }
  | RegionAction;

/** Why an action was refused. Nothing is written. The server maps each to M20.1's words. */
export type Refusal =
  /** The rule has too few champions open (region wars: no pair passes). */
  | 'too-few-open'
  /** Spin found no eligible rule. */
  | 'nothing-to-spin'
  /** Redraw or set-side without region wars on the target. */
  | 'no-region-rule'
  /** Redraw found no pair other than the current one. */
  | 'no-other-pair'
  /** Set-side to the region the other side already has. */
  | 'same-region'
  /** Set-side to a region under the minimum open (or unknown, or `unaffiliated`). */
  | 'region-short'
  /** Set-side to a pair failing the union rule (M20 D2). */
  | 'pair-short';

export type TransitionResult = { ok: true; patch: RowPatch } | { ok: false; refusal: Refusal };
export type LockResult = { ok: true; lock: ModeLock } | { ok: false; refusal: Refusal };

/** What Roll did with a region pair: kept, redrawn because bans made it short, or no pair at all. */
export type TakeRegions =
  | { outcome: 'kept' }
  | { outcome: 'redrawn'; from: RegionPair }
  | { outcome: 'no-draw' };

export interface TakeResult {
  lock: ModeLock;
  patch: RowPatch;
  /** `null` when region wars was not pending. */
  regions: TakeRegions | null;
}

/** A recorded game. A `dropped` lobby is not a record. */
export interface RecordInput {
  kind: 'rift' | 'remake' | 'aram';
  /** The lobby's lock, or `null` (never rolled, or rolled and the teams came down). */
  lock: ModeLock | null;
  /** `false` for a backfilled game: it takes the standing mode at its default and never touches the row. */
  live: boolean;
  /**
   * An admin wrote the row after the lock was taken (the server compares `group_modes.updated_at`
   * with `lobbies.locked_at`). A remake or an ARAM then hands nothing back: see {@link handBack}.
   * Absent reads as false.
   */
  rowTouchedAfterLock?: boolean;
}

export interface RecordStamp {
  standing: StandingModeId;
  mode: Mode;
  rated: boolean;
  /** Whether the game gets a rule check line. */
  checked: boolean;
}

export interface RecordResult {
  stamp: RecordStamp;
  patch: RowPatch;
}

const refuse = (refusal: Refusal) => ({ ok: false, refusal }) as const;

function bansFor(standing: StandingModeId, context: TransitionContext): Bans {
  return standing === 'fearless' ? context.fearlessPool : [];
}

function drawPair(context: TransitionContext, bans: Bans, exclude?: RegionPair): RegionPair | null {
  return drawRegions(context.regions, { roster: context.roster, bans }, context.rng, exclude);
}

function regionRule(pair: RegionPair): PendingRule {
  return { id: 'region', blue: pair.blue, red: pair.red };
}

/**
 * `rulePlayable`, with region wars read over the context's region list (the list the draw reads), so
 * a playable region wars always draws.
 */
function playable(rule: RuleOption, context: TransitionContext, bans: Bans): boolean {
  if (rule.id !== 'region') return rulePlayable(rule, context.roster, bans);
  const passes = pairTester(context.roster, bans);
  const regions = drawableRegions(regionOpenCounts(context.roster, bans), context.regions);
  return regions.some((blue) => regions.some((red) => passes(blue, red)));
}

/** A playable rule as a pending rule; region wars draws its pair (it passes `playable`, so one exists). */
function pendingOf(rule: RuleOption, context: TransitionContext, bans: Bans): PendingRule {
  return rule.id === 'region' ? regionRule(drawPair(context, bans) as RegionPair) : rule;
}

/** Redraw and set-side on a pair: the one rule for the row and the lock. */
function regionChange(
  pair: RegionPair,
  action: RegionAction,
  context: TransitionContext,
  bans: Bans,
): { ok: true; pair: RegionPair } | { ok: false; refusal: Refusal } {
  if (action.type === 'redraw') {
    const next = drawPair(context, bans, pair);
    return next === null ? refuse('no-other-pair') : { ok: true, pair: next };
  }
  const next =
    action.side === 'blue' ? { blue: action.region, red: pair.red } : { blue: pair.blue, red: action.region };
  if (next.blue === next.red) return refuse('same-region');
  const known = action.region !== UNAFFILIATED && context.regions.includes(action.region);
  if (!known || drawableRegions(regionOpenCounts(context.roster, bans), [action.region]).length === 0) {
    return refuse('region-short');
  }
  return pairDrawable(next.blue, next.red, context.roster, bans)
    ? { ok: true, pair: next }
    : refuse('pair-short');
}

/** One admin action on the row (the next game). */
export function transition(row: ModeRow, action: ModeAction, context: TransitionContext): TransitionResult {
  const bans = bansFor(row.standing, context);
  switch (action.type) {
    case 'standing':
      return { ok: true, patch: { standing: action.standing, pending: null, rated: null } };
    case 'rated':
      return { ok: true, patch: { rated: action.rated } };
    case 'pick': {
      // The rule already pending stays pickable (and keeps its pair) even if its pool shrank.
      if (row.pending !== null && sameRule(action.rule, row.pending)) {
        return { ok: true, patch: { pending: row.pending, rated: null } };
      }
      if (!playable(action.rule, context, bans)) return refuse('too-few-open');
      return { ok: true, patch: { pending: pendingOf(action.rule, context, bans), rated: null } };
    }
    case 'spin': {
      const blocked = action.blocked ?? [];
      const spun = drawSpin(
        RULE_OPTIONS,
        action.previous,
        (rule) => !blocked.some((b) => sameRule(b, rule)) && playable(rule, context, bans),
        context.rng,
      );
      if (spun === null) return refuse('nothing-to-spin');
      // Spin's reroll is tapping Spin again, so region wars always gets a fresh pair.
      return { ok: true, patch: { pending: pendingOf(spun, context, bans), rated: null } };
    }
    default: {
      if (row.pending?.id !== 'region') return refuse('no-region-rule');
      const changed = regionChange(row.pending, action, context, bans);
      return changed.ok ? { ok: true, patch: { pending: regionRule(changed.pair) } } : changed;
    }
  }
}

/** Redraw or set-side on this game's lock (only the pair changes). The server gates on `balanced`. */
export function lockTransition(lock: ModeLock, action: RegionAction, context: TransitionContext): LockResult {
  if (lock.mode.id !== 'region') return refuse('no-region-rule');
  const changed = regionChange(lock.mode, action, context, bansFor(lock.standing, context));
  return changed.ok ? { ok: true, lock: { ...lock, mode: regionRule(changed.pair) } } : changed;
}

/**
 * Roll: the pending rule (with its pair) and Rated move onto the lock and are emptied on the row.
 * A region pair still passing under the bans is locked as it is; a short one is replaced by a fresh
 * draw (`redrawn`, for the card's notice); with no pair passing (`no-draw`) the game is the standing
 * mode, Rated is copied into the lock, and the row is left as it was: the rule stays pending with its
 * stale pair and keeps its Rated, which belongs with that rule (M20 D6 (d) as amended 2026-10-05).
 * A Reroll keeps the lock and never calls this.
 */
export function take(row: ModeRow, context: TransitionContext): TakeResult {
  const standingLock = (): ModeLock => ({
    standing: row.standing,
    mode: { id: row.standing },
    rated: row.rated,
  });
  const moved: RowPatch = { pending: null, rated: null };
  const rule = row.pending;
  if (rule === null) return { lock: standingLock(), patch: moved, regions: null };
  if (rule.id !== 'region') {
    return { lock: { standing: row.standing, mode: rule, rated: row.rated }, patch: moved, regions: null };
  }
  const bans = bansFor(row.standing, context);
  if (pairDrawable(rule.blue, rule.red, context.roster, bans)) {
    return {
      lock: { standing: row.standing, mode: rule, rated: row.rated },
      patch: moved,
      regions: { outcome: 'kept' },
    };
  }
  const fresh = drawPair(context, bans);
  if (fresh === null) return { lock: standingLock(), patch: {}, regions: { outcome: 'no-draw' } };
  return {
    lock: { standing: row.standing, mode: regionRule(fresh), rated: row.rated },
    patch: moved,
    regions: { outcome: 'redrawn', from: { blue: rule.blue, red: rule.red } },
  };
}

/**
 * Teams coming down, a remake or an ARAM record: the lock's rule (its pair as last locked) goes back
 * only if the row has no rule; its Rated only if the row's Rated is empty **and** the row's rule is
 * still the lock's (or none, the lock's going back with it). A newer admin choice always wins, and a
 * newer pick reset Rated to its own default. Twice is the same as once. (On the no-draw path the
 * row kept its rule and Rated, so there is nothing to hand back.)
 *
 * **An admin write after the lock wins outright** (M20.7 review, the lead's decision): with
 * `rowTouchedAfterLock` nothing is handed back, so picking Normal after Roll on Tanks keeps Normal
 * when the teams come down. Any admin write after Roll counts (a Rated flip too): the admin touched
 * the next game, and their row stands. Roll's own empty-out is not an admin write.
 */
export function handBack(row: ModeRow, lock: ModeLock, rowTouchedAfterLock: boolean): RowPatch {
  if (rowTouchedAfterLock) return {};
  const patch: RowPatch = {};
  const rule = ruleOf(lock.mode);
  if (row.pending === null && rule !== null) patch.pending = lock.mode as PendingRule;
  // Rated belongs to the rule it was moved with: a newer pick (which resets Rated) keeps its own default.
  const sameGame = row.pending === null || sameRule(ruleOf(row.pending), rule);
  if (row.rated === null && lock.rated !== null && sameGame) patch.rated = lock.rated;
  return patch;
}

/** Whether this game is rated: the moved switch, else the locked mode's default. */
export function lockRated(lock: ModeLock): boolean {
  return lock.rated ?? modeRatedDefault(lock.mode.id);
}

/** Whether the next game is rated: the switch, else the next game's mode default. */
export function nextRated(row: ModeRow): boolean {
  return row.rated ?? modeRatedDefault(row.pending?.id ?? row.standing);
}

/**
 * A recorded game's stamp and what it writes to the row. With a lock: a Rift game stamps the lock
 * and writes nothing (anything chosen since Roll is the next game's); a remake or ARAM hands back.
 * Without a lock (hand-made teams, or the teams came down): a Rift game plays the pending state and
 * uses it up; a remake or ARAM uses nothing. Remakes and ARAMs are never rated or checked.
 */
export function recordGame(row: ModeRow, game: RecordInput): RecordResult {
  if (!game.live) {
    const mode: Mode = { id: row.standing };
    return {
      stamp: { standing: row.standing, mode, rated: modeRatedDefault(row.standing), checked: false },
      patch: {},
    };
  }
  const rift = game.kind === 'rift';
  if (game.lock !== null) {
    const lock = game.lock;
    const isRule = lock.mode.id !== 'normal' && lock.mode.id !== 'fearless';
    return {
      stamp: {
        standing: lock.standing,
        mode: lock.mode,
        rated: rift && lockRated(lock),
        checked: rift && isRule,
      },
      patch: rift ? {} : handBack(row, lock, game.rowTouchedAfterLock === true),
    };
  }
  if (!rift) {
    // A remake or ARAM never played the rule: it stays pending, and the game reads the standing mode.
    return {
      stamp: { standing: row.standing, mode: { id: row.standing }, rated: false, checked: false },
      patch: {},
    };
  }
  const mode: Mode = row.pending ?? { id: row.standing };
  return {
    stamp: {
      standing: row.standing,
      mode,
      rated: nextRated(row),
      checked: row.pending !== null,
    },
    patch: { pending: null, rated: null },
  };
}
