import type { ScoreParts } from '@customs/core';
import { z } from 'zod';

/**
 * `splits.score_parts` (M18.13, `0045_splits_score_parts.sql`): every term of a split's score as
 * core's `balance()` returned it (`ScoreParts`). The roll path writes it; the receipt reads it so
 * `whyLower` can name a repeat, teammate variety or recent fills.
 *
 * The same shape as the column's `check`. Readers go through {@link storedScoreParts}: null, a
 * row stored before 0045, or anything that does not parse reads as `null`, and the receipt then
 * says what it said before the column existed. Unknown keys are dropped, never refused.
 */
export const scorePartsSchema = z.object({
  gap: z.number().finite().min(0),
  offRole: z.number().finite().min(0),
  repeat: z.number().finite().min(0),
  variety: z.number().finite().min(0),
  repeatedPairs: z.number().int().min(0),
});

export type StoredScoreParts = z.infer<typeof scorePartsSchema>;

// Core's `ScoreParts` and this schema, checked both ways: a field added to one without the other
// fails the typecheck.
const _toCore = (parts: StoredScoreParts): ScoreParts => parts;
const _fromCore = (parts: ScoreParts): StoredScoreParts => parts;
void _toCore;
void _fromCore;

/** The stored column (jsonb, any value) as core's `ScoreParts`, or `null`. */
export function storedScoreParts(value: unknown): ScoreParts | null {
  if (value === null || value === undefined) return null;
  const parsed = scorePartsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
