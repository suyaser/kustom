import {
  CLASS_TAGS,
  type ClassTag,
  type Mode,
  type ModeCheck,
  type RegionPair,
  type RuleOption,
  ruleKey,
} from '@customs/core';
import { z } from 'zod';
import { sideSchema } from './common';
import { groupIdSchema } from './groups';

/**
 * The group's mode (M14.29, migration `0024_group_mode.sql`). Each group has one standing mode
 * (`group_modes.mode`) and every game is stamped with the mode in force when the server recorded
 * it (`games.mode`). Fearless "off" is the mode `normal`.
 *
 * **This list is the one list.** M14 has exactly two values; M15 adds its modes (`class`,
 * `region`, `mirror`) here and as rows of `public.modes` in its own migration, so nothing that
 * reads the mode is reshaped. `0024` seeds `public.modes` with exactly these ids, and
 * `modes.test.ts` keeps the two in step.
 *
 * M15.3 (`0032`) adds the rules (`class`, `region`, `mirror`) as further `public.modes` rows, the
 * card's pending rule, Rated switch and version on `group_modes`, the lobby's lock at Roll, and
 * `games.rated` / `games.rule*` (the second half of this file). `GROUP_MODES` stays the two
 * standing modes: a rule is never a group's standing mode.
 */
export const GROUP_MODES = ['normal', 'fearless'] as const;

export const groupModeSchema = z.enum(GROUP_MODES);

export type GroupMode = z.infer<typeof groupModeSchema>;

/**
 * The fallback when the mode cannot be read: a failed read, or a stored value this build does not
 * know (a row written by a newer deployment). Fearless, what `customs` and every group that existed
 * before `0030` were on, so a hiccup never shows an existing group's Tonight a different mode.
 * Not what a new group starts on: that is {@link NEW_GROUP_MODE}.
 */
export const DEFAULT_GROUP_MODE: GroupMode = 'fearless';

/**
 * What a new group starts on (M14.46): `group_modes.mode`'s column default and the row the groups
 * trigger inserts, both `normal` since `0030_new_groups_start_normal.sql`. The app reads a group
 * with **no** `group_modes` row as this, because that group is new (one created between a deploy
 * and its migration); every older group has its row.
 */
export const NEW_GROUP_MODE: GroupMode = 'normal';

/**
 * A stored mode read back from the database, or {@link DEFAULT_GROUP_MODE} when it is one this
 * build does not know (a row written by a newer deployment) or missing. Never throws: a page never
 * 500s over the mode. A caller that can tell "no row" apart answers {@link NEW_GROUP_MODE} for it.
 */
export function parseGroupMode(value: unknown): GroupMode {
  const parsed = groupModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_GROUP_MODE;
}

/** Whether the fearless pool is in force: games recorded now join it, and bans are shown. */
export function isFearlessMode(mode: GroupMode): boolean {
  return mode === 'fearless';
}

// ---------------------------------------------------------------------------
// M15.3: the rules, the card state, the lobby's lock, the game's stamp
// ---------------------------------------------------------------------------

/**
 * Every value `public.modes` holds since `0032`: the two standing modes and the three rule
 * families (M15.3). {@link GROUP_MODES} stays the standing list: a group's standing mode is never
 * a rule (`group_modes_standing`). `modes.test.ts` keeps this, core's `MODE_IDS` and `0032`'s seed
 * in step.
 */
export const MODE_IDS = ['normal', 'fearless', 'class', 'region', 'mirror'] as const;

/** The three rule families (`0032`'s `class`, `region`, `mirror` rows). */
export const RULE_IDS = ['class', 'region', 'mirror'] as const;
export const ruleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof ruleIdSchema>;

export const classTagSchema = z.enum(CLASS_TAGS);

/** A region slug from the region table (M15.9, Meraki's spelling: `shadow-isles`). */
export const regionIdSchema = z.string().regex(/^[a-z][a-z-]{1,40}$/);

/**
 * What the Mode card's one select can hold, as one string (M15.3): a standing mode, or a rule
 * option keyed like core's `ruleKey` (`class:Tank`, `region`, `mirror`). One string so a no-JS
 * form with optgroups posts the same body as the page's script.
 */
export const MODE_CHOICES = [
  'normal',
  'fearless',
  'class:Tank',
  'class:Marksman',
  'class:Mage',
  'class:Assassin',
  'class:Support',
  'region',
  'mirror',
] as const;

export const modeChoiceSchema = z.enum(MODE_CHOICES);
export type ModeChoice = z.infer<typeof modeChoiceSchema>;

/** The rule half of {@link MODE_CHOICES}, in the select's order. */
export const RULE_CHOICES = [
  'class:Tank',
  'class:Marksman',
  'class:Mage',
  'class:Assassin',
  'class:Support',
  'region',
  'mirror',
] as const satisfies readonly ModeChoice[];
export const ruleChoiceSchema = z.enum(RULE_CHOICES);
export type RuleChoice = z.infer<typeof ruleChoiceSchema>;

/** A choice as core's `RuleOption`; `null` for a standing mode. */
export function ruleOptionOf(choice: ModeChoice): RuleOption | null {
  if (choice === 'normal' || choice === 'fearless') return null;
  if (choice === 'region') return { id: 'region' };
  if (choice === 'mirror') return { id: 'mirror' };
  return { id: 'class', tag: choice.slice('class:'.length) as ClassTag };
}

/** Core's `RuleOption` as the select's string. */
export function ruleChoiceOf(rule: RuleOption): RuleChoice {
  return ruleKey(rule) as RuleChoice;
}

/** `"true"` / `"false"` / `"on"` from a form, or a JSON boolean. */
const formBoolean = z.preprocess((value) => {
  if (value === 'true' || value === 'on' || value === '1') return true;
  if (value === 'false' || value === 'off' || value === '0') return false;
  return value;
}, z.boolean());

// ---------------------------------------------------------------------------
// POST /api/admin/mode (M14.29, M15.3; one route for every action since M20.7)
// ---------------------------------------------------------------------------

/** Which game a region action changes: the row (`next`) or the balanced lobby's lock (`this`). */
export const MODE_GAMES = ['next', 'this'] as const;
export const modeGameSchema = z.enum(MODE_GAMES);
export type ModeGame = z.infer<typeof modeGameSchema>;

const formTrue = z.preprocess(
  (value) => (value === 'true' || value === 'on' || value === '1' ? true : value),
  z.literal(true),
);

/**
 * One card write, the **target state**, never a toggle (M14.29): exactly one of
 *
 * - `mode`: a standing mode (sets it, empties the pending rule and the Rated switch) or a rule
 *   choice (the next game's rule; resets the switch). Region wars draws its pair in the same write
 *   (M20 D9); choosing it while it is pending keeps the pair;
 * - `rated`: the Rated switch for the next game, either way, in any mode (R9);
 * - `spin: true`: the server picks the next game's rule (R3); region wars with its pair;
 * - `redraw: true`: a new random region pair, never the same unordered pair (M20 D9);
 * - `side` + `region`: one side's region; the other side keeps its own.
 *
 * `game` names the target of `redraw` and `side` (default `next`): `next` is the row, `this` the
 * balanced lobby's lock (refused once the game has started). M20.7: each action is one update of
 * only the fields it sets (last write wins, M20 D7); `/api/admin/mode/spin` is gone (its no-JS form
 * posts here with `spin=true`). M14's body `{ groupId, mode }` parses unchanged. `redirectTo` is
 * where an HTML form post goes back to (a path on this site).
 */
export const setGroupModeRequestSchema = z
  .object({
    groupId: groupIdSchema,
    mode: modeChoiceSchema.optional(),
    rated: formBoolean.optional(),
    spin: formTrue.optional(),
    redraw: formTrue.optional(),
    side: z.enum(['blue', 'red']).optional(),
    region: regionIdSchema.optional(),
    game: modeGameSchema.optional(),
    redirectTo: z.string().optional(),
  })
  .refine(
    (body) =>
      [
        body.mode !== undefined,
        body.rated !== undefined,
        body.spin === true,
        body.redraw === true,
        body.side !== undefined,
      ].filter(Boolean).length === 1,
    { message: 'name exactly one of mode, rated, spin, redraw or side' },
  )
  .refine((body) => (body.side !== undefined) === (body.region !== undefined), {
    message: 'side and region go together',
  })
  .refine((body) => body.game === undefined || body.redraw === true || body.side !== undefined, {
    message: 'game names the target of redraw or side only',
  });

export type SetGroupModeRequest = z.infer<typeof setGroupModeRequestSchema>;

/** A pending rule as JSON: region wars always with its pair (core's `PendingRule`). */
export const pendingRuleSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('class'), tag: classTagSchema }),
  z.object({ id: z.literal('region'), blue: regionIdSchema, red: regionIdSchema }),
  z.object({ id: z.literal('mirror') }),
]);

/** A locked mode as JSON: the rule, or the standing mode with none (core's `Mode`). */
export const lockedModeSchema = z.union([z.object({ id: groupModeSchema }), pendingRuleSchema]);

/** The group's mode row after a write (core's `ModeRow`): the next game. */
export const modeRowStateSchema = z.object({
  standing: groupModeSchema,
  pending: pendingRuleSchema.nullable(),
  /** The Rated switch; null = the next game's mode default. */
  rated: z.boolean().nullable(),
  /** Whether the next game is rated (core's `nextRated`). */
  nextRated: z.boolean(),
  /** `group_modes.updated_at` after the write; null for a group with no row. */
  updatedAt: z.string().nullable(),
});

export type ModeRowState = z.infer<typeof modeRowStateSchema>;

/** A lobby's lock (core's `ModeLock`): this game. */
export const modeLockStateSchema = z.object({
  lobbyId: z.guid(),
  standing: groupModeSchema,
  mode: lockedModeSchema,
  /** The switch as Roll moved it; null = the locked mode's default. */
  rated: z.boolean().nullable(),
  /** Whether this game is rated (core's `lockRated`). */
  effectiveRated: z.boolean(),
});

export type ModeLockState = z.infer<typeof modeLockStateSchema>;

/**
 * @deprecated M20.7 keeps it for the M15/M19.13 card client until M20.8 rewrites it on
 * {@link modeRowStateSchema}. `version` is `Date.parse(group_modes.updated_at)`: an ordering for
 * the client store only (no write reads it; the column is gone).
 */
export const nextGameSchema = z.object({
  standing: groupModeSchema,
  rule: ruleChoiceSchema.nullable(),
  rated: z.boolean(),
  ratedOverride: z.boolean().nullable(),
  version: z.number().int().nonnegative(),
});

export type NextGame = z.infer<typeof nextGameSchema>;

/**
 * The answer to every action (M20.7): `{ state, notice }`, the row after the write and the route's
 * one line (the card shows it, never recomputes it), plus `thisGame` when the action changed the
 * lock, and Spin's pick. `mode` and `next` are the pre-M20.8 client's fields, deleted with it.
 */
export const setGroupModeResponseSchema = z.object({
  ok: z.literal(true),
  state: modeRowStateSchema,
  notice: z.string().min(1),
  /** False when nothing was written. */
  changed: z.boolean(),
  thisGame: modeLockStateSchema.optional(),
  /** Spin's pick, on a Spin answer only. */
  spun: ruleChoiceSchema.optional(),
  /** @deprecated M20.8: read `state.standing`. */
  mode: groupModeSchema,
  /** @deprecated M20.8: read `state`. */
  next: nextGameSchema.optional(),
});

export type SetGroupModeResponse = z.infer<typeof setGroupModeResponseSchema>;

/**
 * @deprecated M20.8: the fields of the answer the pre-M20.8 card client reads (M15.3's answer).
 * {@link setGroupModeResponseSchema} is a superset, so this parses every M20.7 answer; M20.8
 * deletes it with the client's `next` reads.
 */
export const legacyModeAnswerSchema = z.object({
  ok: z.literal(true),
  mode: groupModeSchema,
  changed: z.boolean(),
  next: nextGameSchema.optional(),
  spun: ruleChoiceSchema.optional(),
});

// ---------------------------------------------------------------------------
// Rows as anon reads them (Tonight, and its Realtime events)
// ---------------------------------------------------------------------------

/**
 * A `group_modes` row as anon may read it (every column but `set_by` and `pending_set_by`), and as
 * a Realtime event carries it. M20.7 (`0047`): no `version`; the pending pair. A value from a newer
 * deployment fails the parse; the caller falls back (never a 500).
 */
export const groupModeRowSchema = z.object({
  group_id: groupIdSchema,
  mode: groupModeSchema,
  pending_rule: ruleIdSchema.nullable(),
  pending_class_tag: classTagSchema.nullable(),
  pending_region_blue: regionIdSchema.nullable(),
  pending_region_red: regionIdSchema.nullable(),
  rated_override: z.boolean().nullable(),
  updated_at: z.string(),
});

export type GroupModeRow = z.infer<typeof groupModeRowSchema>;

/**
 * The lobby's lock columns (`0032`, `0047`), all null for no lock. A lock exists exactly when
 * `lock_mode` is set; `lock_rated` null is the locked mode's default. Public: Tonight shows it.
 */
export const lobbyLockRowSchema = z.object({
  lock_mode: groupModeSchema.nullable(),
  lock_rule: ruleIdSchema.nullable(),
  lock_class_tag: classTagSchema.nullable(),
  lock_region_blue: regionIdSchema.nullable(),
  lock_region_red: regionIdSchema.nullable(),
  lock_rated: z.boolean().nullable(),
  locked_at: z.string().nullable(),
});

export type LobbyLockRow = z.infer<typeof lobbyLockRowSchema>;

/** The four rule columns a game (`games.rule*`) or a lock (`lobbies.lock_rule*`) carries. */
export interface RuleColumns {
  rule: string | null;
  classTag: string | null;
  regionBlue: string | null;
  regionRed: string | null;
}

/**
 * The rule columns as core's `Mode`, or `null` when they make no rule (a standing-mode game: the
 * caller uses the standing mode; or a half-written row, which `0032`'s checks refuse anyway).
 */
export function ruleModeOf(columns: RuleColumns): Mode | null {
  switch (columns.rule) {
    case 'class': {
      const tag = classTagSchema.safeParse(columns.classTag);
      return tag.success ? { id: 'class', tag: tag.data } : null;
    }
    case 'region': {
      if (columns.regionBlue === null || columns.regionRed === null) return null;
      const pair: RegionPair = { blue: columns.regionBlue, red: columns.regionRed };
      return { id: 'region', ...pair };
    }
    case 'mirror':
      return { id: 'mirror' };
    default:
      return null;
  }
}

/** Core's `Mode` as the rule columns; all null for a standing mode. */
export function ruleColumnsOf(mode: Mode): {
  rule: RuleId | null;
  classTag: ClassTag | null;
  regionBlue: string | null;
  regionRed: string | null;
} {
  switch (mode.id) {
    case 'class':
      return { rule: 'class', classTag: mode.tag, regionBlue: null, regionRed: null };
    case 'region':
      return { rule: 'region', classTag: null, regionBlue: mode.blue, regionRed: mode.red };
    case 'mirror':
      return { rule: 'mirror', classTag: null, regionBlue: null, regionRed: null };
    default:
      return { rule: null, classTag: null, regionBlue: null, regionRed: null };
  }
}

// ---------------------------------------------------------------------------
// games.rule_check: core's ModeCheck as stored JSON
// ---------------------------------------------------------------------------

const verdictSchema = z.enum(['kept', 'broke', 'unknown']);
const championKeySchema = z.number().int();

const sideCheckSchema = z.object({
  side: sideSchema,
  verdict: verdictSchema,
  broke: z.array(championKeySchema),
  unknown: z.array(championKeySchema),
});

const laneCheckSchema = z.object({
  lane: z.enum(['top', 'jungle', 'mid', 'adc', 'support']),
  verdict: verdictSchema,
  blue: championKeySchema.nullable(),
  red: championKeySchema.nullable(),
});

/**
 * `games.rule_check` (`0032`): core's `checkMode` answer, champion keys and sides only, never a
 * player (R7). The poster and the Discord result post (M15.5, M15.6) parse it with this.
 */
export const ruleCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('sides'), blue: sideCheckSchema, red: sideCheckSchema }),
  z.object({
    kind: z.literal('lanes'),
    lanes: z.array(laneCheckSchema),
    kept: z.number().int().min(0).max(5),
  }),
]);

export type RuleCheck = z.infer<typeof ruleCheckSchema>;

/** Compile time only: core's `ModeCheck` is assignable to the stored shape. */
export function storedRuleCheck(check: ModeCheck): RuleCheck {
  return check;
}
