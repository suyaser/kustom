import { z } from 'zod';

/**
 * Kustom Premium's entitlement (M16.2, `0031_premium_flag.sql`): one flag per group that gates
 * every AI feature, and the group's monthly AI budget. The server reads it with the service role
 * (`apps/web/lib/premium.ts`); no client role can read or write `groups`, and no HTTP route writes
 * these columns -- only the operator's `set-premium` script does.
 */

/** `groups.ai_monthly_cap_usd`'s default (the user, 2026-10-04: $2 per group per month). */
export const DEFAULT_GROUP_AI_MONTHLY_CAP_USD = 2;

/** The column's check constraint: 0 to 100 dollars. */
export const MAX_GROUP_AI_MONTHLY_CAP_USD = 100;

/** A per-group monthly cap in USD: 0 to 100, whole cents at most. */
export const groupAiMonthlyCapUsdSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_GROUP_AI_MONTHLY_CAP_USD)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'whole cents at most');

/** The three columns as PostgREST returns them (`numeric` arrives as a JSON number). */
export const groupPremiumRowSchema = z.object({
  premium: z.boolean(),
  premium_changed_at: z.string().nullable(),
  ai_monthly_cap_usd: groupAiMonthlyCapUsdSchema,
});

export type GroupPremiumRow = z.infer<typeof groupPremiumRowSchema>;

/** A group's entitlement, camel-cased for the app. */
export const groupPremiumSchema = z.object({
  premium: z.boolean(),
  /** When `premium` last flipped, or null if it never has. */
  premiumChangedAt: z.string().nullable(),
  monthlyCapUsd: groupAiMonthlyCapUsdSchema,
});

export type GroupPremium = z.infer<typeof groupPremiumSchema>;
