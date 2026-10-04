import { groupModeRowSchema } from '@customs/db/schemas';
import { z } from 'zod';
import type { ModeRowSlice } from './clientStore';
import { pendingOfRow } from './clientStore';

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
  return {
    groupId: data.group_id,
    slice: {
      state: {
        standing: data.mode,
        pending: pendingOfRow(data.pending_rule, data.pending_class_tag),
        ratedOverride: data.rated_override,
        version: data.version,
      },
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
