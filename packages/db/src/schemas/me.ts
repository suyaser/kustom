import { z } from 'zod';
import { lobbyStatusSchema, puuidSchema, roleSchema } from './common';
import { groupIdSchema } from './groups';

/**
 * `/api/me/*`: the two writes a **friend** can make, as opposed to the companion (a bearer
 * token) or an admin (an admin membership in the request's group, M13.4). This is the third route
 * class M3.6 introduces — a Supabase session with a linked player — and these are its payloads.
 *
 * Both routes identify the caller the one way this project identifies anybody: session →
 * Discord identity → `players.discord_id` → the player row. **No body ever says who the
 * caller is.** `roleTonightRequestSchema.puuid` names a *target*, and naming somebody other
 * than yourself is honoured only for an admin of the body's group (403 otherwise, never a silent write to your own
 * row).
 *
 * **Every body names its group** (M13.4): a session can be in several, so `groupId` says which
 * group's lobby the write is about, and the route checks it against `group_memberships`.
 */

/**
 * A role for tonight, or `null` to clear it back to the profile's main and backup.
 *
 * `''` and `'none'` mean `null` for the same reason the admin forms accept them
 * (`apps/web/lib/admin/formValues.ts`): the no-JavaScript path is a real HTML form, and a form
 * can only send strings. A JSON caller sends a real `null`.
 */
export const roleForTonightSchema = z
  .union([roleSchema, z.null(), z.literal(''), z.literal('none')])
  .transform((value) => (value === '' || value === 'none' || value === null ? null : value));

export const roleTonightRequestSchema = z.object({
  /**
   * The group the page is showing (M13.4). The caller must be a member of it, and the lobby must
   * be one of its lobbies -- a lobby of another group is the same 404 as one that does not exist.
   */
  groupId: groupIdSchema,
  /** `lobbies.id`. The row written is `lobby_members(lobby_id, player_id)`. */
  lobbyId: z.uuid(),
  role: roleForTonightSchema,
  /**
   * Whose row to write. Absent — the ordinary case — means the caller's own. A PUUID that is
   * not the caller's is a **403 for anybody but an admin**: a body that names someone else
   * must never quietly fall back to writing the caller's own row.
   */
  puuid: puuidSchema.optional(),
  /**
   * Where an HTML form post is sent back to (the no-JavaScript path). Validated as a path on
   * this site by the route before it is used; a JSON caller may send it and it changes
   * nothing.
   */
  redirectTo: z.string().optional(),
});

export type RoleTonightRequest = z.infer<typeof roleTonightRequestSchema>;

export const roleTonightResponseSchema = z.object({
  ok: z.literal(true),
  /** The player whose row moved — the caller, unless an admin named somebody else. */
  puuid: z.string(),
  lobbyId: z.uuid(),
  /** What the row says now. `null` is "cleared, back to the profile's roles". */
  role: roleSchema.nullable(),
  /** The lobby's status at the moment of the write, for the sentence the control prints. */
  status: lobbyStatusSchema,
  /**
   * True when the teams were already posted, so this choice counts at the **next** balance and
   * nothing on screen moves now (M3.6: a role tap is never a second reroll).
   */
  savedForNextGame: z.boolean(),
});

export type RoleTonightResponse = z.infer<typeof roleTonightResponseSchema>;

/**
 * `POST /api/me/link`: a signed-in visitor who matches no player row picks themselves out of
 * tonight's lobby, once (M3.6, "Picking yourself, once").
 *
 * The body names a **PUUID**, never a player id: PUUID is the identity in this project, and it
 * is the only id the public page has. Which rows may be named is not the body's business —
 * the route offers only tonight's lobby members and refuses anybody else.
 */
export const selfLinkRequestSchema = z.object({
  /**
   * The group whose tonight lobby the visitor is picking themselves out of (M13.4). No membership
   * is required -- the visitor has no player row yet, so they cannot have one -- and the member
   * they claim already is one, because playing in a group's lobby is joining it (M13.3).
   */
  groupId: groupIdSchema,
  puuid: puuidSchema,
  redirectTo: z.string().optional(),
});

export type SelfLinkRequest = z.infer<typeof selfLinkRequestSchema>;

export const selfLinkResponseSchema = z.object({
  ok: z.literal(true),
  /** The player this Discord account is linked to from now on. */
  puuid: z.string(),
});

export type SelfLinkResponse = z.infer<typeof selfLinkResponseSchema>;
