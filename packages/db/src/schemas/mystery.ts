import { z } from 'zod';

/**
 * The daily game (M5.32, second kind added by M8.4) request and response envelopes.
 *
 * GET /api/daily-mystery never includes the answer, unrevealed clue values, or
 * community guess distribution. Those appear only after a locked guess — on an
 * award day exactly as on a mystery day.
 */

/**
 * Which of the two daily games a challenge is. Daily Mystery and Guess the Award
 * alternate civil days (M8.4); the value is **stored** on the row, never inferred
 * from the date at read time.
 */
export const MYSTERY_KINDS = ['mystery', 'award'] as const;

export const mysteryKindSchema = z.enum(MYSTERY_KINDS);

export const MYSTERY_CATEGORIES = ['disaster', 'monster', 'farming', 'raid_boss', 'ghost'] as const;

export const mysteryCategorySchema = z.enum(MYSTERY_CATEGORIES);

/**
 * Guess the Award's categories: which of `performanceScores`' seven components the
 * standout led their game in (`packages/core/src/rating/performance.ts`). The two
 * category sets are disjoint, and the database check is per kind (migration 0016).
 */
export const AWARD_CATEGORIES = [
  'kda',
  'damage',
  'gold',
  'vision',
  'mitigation',
  'cs',
  'objectives',
] as const;

export const awardCategorySchema = z.enum(AWARD_CATEGORIES);

export const challengeCategorySchema = z.enum([...MYSTERY_CATEGORIES, ...AWARD_CATEGORIES]);

export const MYSTERY_CLUE_TYPES = [
  'champion',
  'role',
  'damage',
  'cs',
  'gold',
  'damage_taken',
  'longest_life',
  'historical',
] as const;

export const mysteryClueTypeSchema = z.enum(MYSTERY_CLUE_TYPES);

export const mysteryVisitorIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'anonymous visitor id');

export const mysterySuspectSchema = z.object({
  playerId: z.string().uuid(),
  name: z.string(),
});

export const mysteryHookLineSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const mysteryPublicHookSchema = z.object({
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  kda: z.string(),
  durationS: z.number().int().nonnegative(),
  durationLabel: z.string(),
  lines: z.array(mysteryHookLineSchema),
});

export const mysteryClueViewSchema = z.object({
  order: z.number().int().positive(),
  type: mysteryClueTypeSchema,
  label: z.string(),
  value: z.string(),
});

export const mysteryPlayViewSchema = z.object({
  challengeId: z.string().uuid(),
  challengeNumber: z.number().int().positive(),
  day: z.string(),
  kind: mysteryKindSchema,
  category: challengeCategorySchema,
  expiresAt: z.string(),
  hook: mysteryPublicHookSchema,
  suspects: z.array(mysterySuspectSchema).min(1),
  cluesRevealed: z.number().int().nonnegative(),
  revealedClues: z.array(mysteryClueViewSchema),
  clueCount: z.number().int().nonnegative(),
  completed: z.boolean(),
});

export const mysteryEmptyViewSchema = z.object({
  empty: z.literal(true),
  expiresAt: z.string(),
});

export const mysteryTodayResponseSchema = z.object({
  ok: z.literal(true),
  empty: z.literal(false).optional(),
  challenge: mysteryPlayViewSchema.optional(),
  emptyView: mysteryEmptyViewSchema.optional(),
});

export const mysteryGuessRequestSchema = z.object({
  playerId: z.string().uuid(),
  anonymousVisitorId: mysteryVisitorIdSchema,
});

export const mysteryClueRequestSchema = z.object({
  anonymousVisitorId: mysteryVisitorIdSchema,
});

export const mysteryResultRequestQuerySchema = z.object({
  anonymousVisitorId: mysteryVisitorIdSchema,
});

export const mysteryPercentileBucketSchema = z.enum(['top-5', 'top-10', 'top-15', 'top-25', 'top-50']);

export const mysteryPerformanceSchema = z.object({
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  kda: z.string(),
  champion: z.string().nullable(),
  role: z.enum(['top', 'jungle', 'mid', 'adc', 'support']).nullable(),
  damage: z.number().int().nonnegative(),
  damageLabel: z.string(),
  cs: z.number().int().nonnegative(),
  gold: z.number().int().nonnegative(),
  goldLabel: z.string(),
  damageTaken: z.number().int().nonnegative().nullable(),
  damageTakenLabel: z.string().nullable(),
  // The three M7.7 / M7.14 columns, so an award reveal can print the stat the award was
  // about. Null for every game stored before those migrations, exactly as the column is.
  visionScore: z.number().int().nonnegative().nullable(),
  damageSelfMitigated: z.number().int().nonnegative().nullable(),
  damageToObjectives: z.number().int().nonnegative().nullable(),
  durationS: z.number().int().nonnegative(),
  durationLabel: z.string(),
  won: z.boolean(),
  startedLabel: z.string(),
});

export const mysteryPersonalSchema = z.object({
  guessedPlayerId: z.string().uuid(),
  guessedName: z.string(),
  actualPlayerId: z.string().uuid(),
  actualName: z.string(),
  correct: z.boolean(),
  cluesUsed: z.number().int().nonnegative(),
  completionTimeMs: z.number().int().nonnegative(),
  firstDetective: z.boolean(),
  percentile: mysteryPercentileBucketSchema.nullable(),
});

export const mysteryGuessShareSchema = z.object({
  playerId: z.string().uuid(),
  name: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().nonnegative(),
});

export const mysteryCommunitySchema = z.object({
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  accuracyPercent: z.number().nonnegative(),
  wrongPercent: z.number().nonnegative(),
  averageCluesUsed: z.number().nullable(),
  zeroClueCorrect: z.number().int().nonnegative(),
  fastestCorrectMs: z.number().int().nonnegative().nullable(),
  mostFalselyAccused: z
    .object({
      playerId: z.string().uuid(),
      name: z.string(),
      count: z.number().int().nonnegative(),
    })
    .nullable(),
  distribution: z.array(mysteryGuessShareSchema),
  firstDetectiveClaimed: z.boolean(),
});

export const mysteryResultViewSchema = z.object({
  challengeId: z.string().uuid(),
  challengeNumber: z.number().int().positive(),
  day: z.string(),
  kind: mysteryKindSchema,
  category: challengeCategorySchema,
  expiresAt: z.string(),
  hook: mysteryPublicHookSchema,
  suspects: z.array(mysterySuspectSchema),
  revealedClues: z.array(mysteryClueViewSchema),
  clueCount: z.number().int().nonnegative(),
  performance: mysteryPerformanceSchema,
  personal: mysteryPersonalSchema,
  community: mysteryCommunitySchema,
});

export const mysteryGuessResponseSchema = z.object({
  ok: z.literal(true),
  result: mysteryResultViewSchema,
});

export const mysteryClueResponseSchema = z.object({
  ok: z.literal(true),
  clue: mysteryClueViewSchema.nullable(),
  cluesRevealed: z.number().int().nonnegative(),
  clueCount: z.number().int().nonnegative(),
});

export const mysteryCronResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['created', 'exists', 'empty']),
  challengeId: z.string().uuid().nullable(),
  // Which game today turned out to be, for the operator reading the cron log. Null when
  // neither game could be built. An award day that fell back reads `mystery`, because that
  // is what was stored (M8.4).
  kind: mysteryKindSchema.nullable(),
  day: z.string(),
});
