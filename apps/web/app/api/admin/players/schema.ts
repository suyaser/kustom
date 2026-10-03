import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { booleanFieldSchema, idSchema, nullableRoleSchema, nullableTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/players`. One route, three live actions and two retired ones, discriminated on
 * `action` — the repo's convention (`CLAUDE.md`) and what lets a plain HTML form say which
 * button was pressed with a hidden field.
 *
 * Every field that can be cleared accepts `""` (what a browser sends for the empty option) as
 * well as `null`.
 *
 * **Every variant names its group** (M13.4): the caller must be an admin of it, and the player
 * must be a member of it — a player outside the group is a 404.
 */

/**
 * **Retired by M5.17.** Roles are inferred from the games people play and recomputed after
 * every rated game and every rebuild, so there is nothing here to set: the handler answers 410
 * with a sentence.
 *
 * The variant is kept, and its two role fields are optional, for exactly one reader — an admin
 * with `/admin/players` open in a tab from before the deploy. A removed variant would give them
 * `that form was not valid`, which says nothing true. `ROLES_ARE_INFERRED` says what happened.
 */
export const setRolesRequestSchema = z.object({
  action: z.literal('set-roles'),
  groupId: groupIdSchema,
  playerId: idSchema,
  mainRole: nullableRoleSchema.optional(),
  secondaryRole: nullableRoleSchema.optional(),
});

/**
 * The name the group uses (M1.7). `displayName: null` — which is what the empty form field
 * posts — clears the override and puts the row back on following the Riot `gameName`, so this
 * field is the only way in *and* the only way out of an admin-set name.
 */
export const setNameRequestSchema = z.object({
  action: z.literal('set-name'),
  groupId: groupIdSchema,
  playerId: idSchema,
  displayName: nullableTextSchema,
});

/** `discordId: null` (or "") unlinks. */
export const setDiscordRequestSchema = z.object({
  action: z.literal('set-discord'),
  groupId: groupIdSchema,
  playerId: idSchema,
  discordId: nullableTextSchema,
});

/**
 * The target state, not a toggle: a form that says "make this false" cannot race another tab
 * into flipping the wrong way. Since M13.4 it is the member's role in `groupId`, the same write
 * as `POST /api/admin/members/role`.
 */
export const setAdminRequestSchema = z.object({
  action: z.literal('set-admin'),
  groupId: groupIdSchema,
  playerId: idSchema,
  isAdmin: booleanFieldSchema,
});

/**
 * **Retired** (`04-decisions.md`, 2026-10-03, reversing M5.1's approval). Backfill is on for
 * every member with no admin step, so there is nothing to allow or revoke: the handler answers
 * 410 with a sentence, before it looks at the player.
 *
 * Kept for the same one reader as `set-roles` — an admin with `/admin/players` open in a tab
 * from before the deploy — and `approved` is optional so whatever that old form posts parses.
 */
export const setBackfillRequestSchema = z.object({
  action: z.literal('set-backfill'),
  groupId: groupIdSchema,
  playerId: idSchema,
  approved: booleanFieldSchema.optional(),
});

export const adminPlayersRequestSchema = z.discriminatedUnion('action', [
  setRolesRequestSchema,
  setNameRequestSchema,
  setDiscordRequestSchema,
  setAdminRequestSchema,
  setBackfillRequestSchema,
]);

export type AdminPlayersRequest = z.infer<typeof adminPlayersRequestSchema>;

/** No `set-roles` or `set-backfill`: those never answer `ok`, they answer 410. */
export const adminPlayersResponseSchema = z.object({
  ok: z.literal(true),
  action: z.enum(['set-name', 'set-discord', 'set-admin']),
  playerId: z.uuid(),
});

export type AdminPlayersResponse = z.infer<typeof adminPlayersResponseSchema>;
