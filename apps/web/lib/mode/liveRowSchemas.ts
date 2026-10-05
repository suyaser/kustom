import type { PendingRule } from '@customs/core';
import { groupModeRowSchema, ruleModeOf } from '@customs/db/schemas';
import { z } from 'zod';
import type { ModeRowSlice } from './clientStore';

/**
 * The Mode card's two Realtime rows, parsed (M19.13). **Loaded only by a dynamic import**
 * (`liveRows.ts`): it carries zod, which Tonight's first load must not (`lib/clientGraph.test.ts`).
 *
 * Both parsers keep only the columns the client mode store holds. `group_modes` goes through
 * `@customs/db`'s `groupModeRowSchema` (non-strict, so `set_by` / `pending_set_by`, if a payload
 * carries them, are dropped by the parse and never read); `fearless_state` keeps `group_id` and
 * `reset_at` only (`reset_by` is never read). Whether M19.11 publishes those tables with a column
 * list or not, nothing here depends on the id columns.
 */

export function parseModeRow(row: unknown): { groupId: string; slice: ModeRowSlice } | null {
  const parsed = groupModeRowSchema.safeParse(row);
  if (!parsed.success) return null;
  const data = parsed.data;
  // A rule this build cannot read (or, before 0048, a region wars with no pair) is no rule.
  const rule = ruleModeOf({
    rule: data.pending_rule,
    classTag: data.pending_class_tag,
    regionBlue: data.pending_region_blue,
    regionRed: data.pending_region_red,
  });
  const pending =
    rule === null || rule.id === 'normal' || rule.id === 'fearless' ? null : (rule as PendingRule);
  return {
    groupId: data.group_id,
    slice: {
      row: { standing: data.mode, pending, rated: data.rated_override },
      updatedAt: data.updated_at,
    },
  };
}

const fearlessStateRowSchema = z.object({
  group_id: z.string().min(1),
  reset_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

export function parseFearlessRow(row: unknown): { groupId: string; resetAt: string } | null {
  const parsed = fearlessStateRowSchema.safeParse(row);
  return parsed.success ? { groupId: parsed.data.group_id, resetAt: parsed.data.reset_at } : null;
}
