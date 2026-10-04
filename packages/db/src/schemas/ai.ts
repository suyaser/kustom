import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * Kustom Premium's AI plumbing (M16.3, `0033_ai_lines.sql`): the shapes of the stored lines, the
 * fact lists they were written from, and the meter's answers. Every row is read and written by the
 * web server with the service role (`apps/web/lib/ai/*`); no client role can see these tables.
 * The bot and any later reader import the same schemas from here.
 */

/** What a line is about: one game, one closed week, or one player's week. */
export const AI_LINE_KINDS = ['game', 'week', 'player'] as const;
export const aiLineKindSchema = z.enum(AI_LINE_KINDS);
export type AiLineKind = z.infer<typeof aiLineKindSchema>;

/**
 * A line's life. `pending` while a generation holds it; `published` once the checker passed it
 * (the only status ever rendered); `rejected` after two checker failures (final, never shown);
 * `failed` when the model could not be reached or the budget said no (a transient failure may be
 * retried inside its window); `hidden` after an admin's `Hide` (final).
 */
export const AI_LINE_STATUSES = ['pending', 'published', 'rejected', 'failed', 'hidden'] as const;
export const aiLineStatusSchema = z.enum(AI_LINE_STATUSES);
export type AiLineStatus = z.infer<typeof aiLineStatusSchema>;

/** `P1` .. `P99`: how a player is named to the model. */
export const playerTokenSchema = z.string().regex(/^P[1-9]\d?$/);
export type PlayerToken = z.infer<typeof playerTokenSchema>;

/** `{"P1": "<players.id>"}`: resolved to a display name only after the checker passed. */
export const aiTokenMapSchema = z.record(playerTokenSchema, z.uuid());
export type AiTokenMap = z.infer<typeof aiTokenMapSchema>;

/**
 * The unit a fact's number is in. The checker binds every number in a line to a fact with the same
 * value **and** this unit, read off the words next to the number.
 */
export const AI_FACT_UNITS = [
  'kills',
  'deaths',
  'assists',
  'cs',
  'damage',
  'vision',
  'gold',
  'minutes',
  'games',
  'wins',
  'streak',
  'percent',
  'rating',
  'place',
] as const;
export const aiFactUnitSchema = z.enum(AI_FACT_UNITS);
export type AiFactUnit = z.infer<typeof aiFactUnitSchema>;

/**
 * The absolute words a fact may back (brief 4.4 check 4). `max`: most, highest, best, top, record.
 * `min`: fewest, least, lowest. `all`: always, never, every, only, unbeaten, perfect, no deaths.
 * `first`: first. Nothing ever backs `worst`.
 */
export const AI_CLAIMS = ['max', 'min', 'all', 'first'] as const;
export const aiClaimSchema = z.enum(AI_CLAIMS);
export type AiClaim = z.infer<typeof aiClaimSchema>;

export const aiFactValueSchema = z.object({
  /** What the number counts, as the model reads it: `kills`, `damage to champions`. */
  label: z.string().min(1).max(80),
  value: z.number().finite().nonnegative(),
  unit: aiFactUnitSchema,
  /** `14 of 19`: the total this value is a part of, in the same unit. */
  of: z.number().finite().nonnegative().optional(),
});
export type AiFactValue = z.infer<typeof aiFactValueSchema>;

/**
 * One numbered fact: `F3: P4 | Blue, won | jungle | Lee Sin | 9 kills | 5 assists`. Names never
 * appear: a player is a token, a team is a side.
 */
export const aiFactSchema = z.object({
  id: z.string().regex(/^F[1-9]\d{0,2}$/),
  /** The player the fact is about, or null for a team or the game. */
  token: playerTokenSchema.nullable(),
  /** The team the fact is about (or the player's team): 100 blue, 200 red. */
  side: z.union([z.literal(100), z.literal(200)]).nullable(),
  /** Short text the model reads verbatim: `won`, `jungle`, `the underdog won (upset)`. */
  notes: z.array(z.string().min(1).max(120)).max(8),
  /** Champions this fact names, exactly as Data Dragon spells them. */
  champions: z.array(z.string().min(1).max(40)).max(10),
  values: z.array(aiFactValueSchema).max(12),
  /** The absolute words this fact backs for its token (or side). */
  claims: z.array(z.object({ claim: aiClaimSchema, text: z.string().min(1).max(120) })).max(8),
});
export type AiFact = z.infer<typeof aiFactSchema>;

export const aiFactListSchema = z.array(aiFactSchema).max(200);

/** An `ai_lines` row as the server reads it back. */
export const aiLineRowSchema = z.object({
  id: z.uuid(),
  /**
   * `groupIdSchema` (`z.guid()`), never `z.uuid()`: the original group's fixed id
   * `00000000-0000-0000-0000-000000000001` is not an RFC 9562 uuid, and a strict check here made
   * every one of its rows unreadable (2026-10-04: the week storyline never posted, the scouting
   * reports stuck `pending`).
   */
  group_id: groupIdSchema,
  kind: aiLineKindSchema,
  subject: z.string().min(1),
  status: aiLineStatusSchema,
  text: z.string().nullable(),
  token_map: aiTokenMapSchema,
  fact_hash: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  attempts: z.number().int().min(0).max(2),
  reject_reason: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().finite().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  published_at: z.string().nullable(),
});
export type AiLineRow = z.infer<typeof aiLineRowSchema>;

/** `ai_month_spend()`'s one row. PostgREST sends `numeric` as a JSON number. */
export const aiMonthSpendRowSchema = z.object({
  group_spent_usd: z.number().finite().nonnegative(),
  global_spent_usd: z.number().finite().nonnegative(),
  group_cap_usd: z.number().finite().nonnegative(),
  global_cap_usd: z.number().finite().nonnegative(),
  calls_enabled: z.boolean(),
  premium: z.boolean(),
  lines_enabled: z.boolean(),
});
export type AiMonthSpendRow = z.infer<typeof aiMonthSpendRowSchema>;

/** Why `ai_reserve_call()` said no. */
export const AI_RESERVE_REFUSALS = [
  'kill_switch',
  'not_premium',
  'lines_off',
  'group_cap',
  'global_cap',
  'no_group',
] as const;
export const aiReserveRefusalSchema = z.enum(AI_RESERVE_REFUSALS);
export type AiReserveRefusal = z.infer<typeof aiReserveRefusalSchema>;

/** `ai_reserve_call()`'s answer. */
export const aiReserveResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), call_id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: aiReserveRefusalSchema }),
]);
export type AiReserveResult = z.infer<typeof aiReserveResultSchema>;

/** The group's AI gate columns (`groups.premium`, `premium_changed_at`, `ai_lines_enabled`). */
export const aiGateRowSchema = z.object({
  premium: z.boolean(),
  premium_changed_at: z.string().nullable(),
  ai_lines_enabled: z.boolean(),
});
export type AiGateRow = z.infer<typeof aiGateRowSchema>;
