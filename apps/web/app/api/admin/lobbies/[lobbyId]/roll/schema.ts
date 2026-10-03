import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { internalPathSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/lobbies/[lobbyId]/roll`: an admin balances an `open` lobby (2026-10-03).
 *
 * The only way a lobby goes from `open` to `balanced`; ingest no longer does it by itself.
 * The rules are `lib/admin/roll.ts`.
 */
export const rollRequestSchema = z.object({
  /**
   * The group the lobby belongs to (M13.4). The caller must be an admin of it, and a lobby of any
   * other group is the same 404 as a lobby that does not exist.
   */
  groupId: groupIdSchema,
  /**
   * The roster the presser saw: `rosterKey()` from `@customs/db` over the puuid of every member
   * the page was showing, spectators included, sorted and comma-joined (`lobbyRosterKey` in
   * `lib/ingest/lobby.ts`). A key that is not the stored roster is a 409 and nothing is rolled,
   * so a press made a moment before somebody left never balances the people who are left.
   */
  rosterKey: z.string().min(1),
  /**
   * Where an HTML form post is sent back to, when it is not `/admin` — the same field, and the
   * same `safeNextPath` check, as the reroll's (M3.4). A JSON caller may send it and it changes
   * nothing.
   */
  redirectTo: internalPathSchema.optional(),
});

export type RollRequest = z.infer<typeof rollRequestSchema>;

export const rollResponseSchema = z.object({
  ok: z.literal(true),
  lobbyId: z.uuid(),
  status: z.literal('balanced'),
  /** `splits.id` of the chosen split. */
  splitId: z.uuid(),
  /**
   * `rolled`: this press made the teams and they were posted. `already_rolled`: a repeat press
   * against the same roster — the split already up is answered, nothing moved, nothing posted.
   */
  outcome: z.enum(['rolled', 'already_rolled']),
});

export type RollResponse = z.infer<typeof rollResponseSchema>;
