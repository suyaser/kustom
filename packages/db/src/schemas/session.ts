import { z } from 'zod';

/**
 * The verified session lookup (`0038_session_player.sql`): the two boundaries the web app's
 * session gate crosses after `auth.getClaims()` has checked the access token's signature.
 *
 * `z.guid()` rather than `z.uuid()` for the same reason as `groupIdSchema`: the shape Postgres's
 * `uuid` accepts, without zod's RFC version-nibble check.
 */

/**
 * The claims the gate reads out of a **signature-verified** access token. Only `sub` and
 * `session_id` decide anything; both are required, so a token without a `session_id` (an anon or
 * service-role key, a hand-minted JWT) fails closed. `email` and `user_metadata` are display only
 * (`user_metadata` is user-writable through `auth.updateUser`), and anything else in the token is
 * ignored.
 */
export const sessionClaimsSchema = z.object({
  sub: z.guid(),
  session_id: z.guid(),
  email: z.string().nullish(),
  user_metadata: z.record(z.string(), z.unknown()).nullish(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

/**
 * One row of `public.session_player(sub, session_id, group_id)`. No row means the session is not
 * live. Every column is nullable: `discord_id` null is a session with no Discord identity,
 * `player_id` null a Discord account linked to no player, `role` null not a member of the group
 * asked about (or none asked). `role` stays a string here; the gate reads it through
 * `groupRoleSchema`, so a role it does not know grants nothing.
 */
export const sessionPlayerRowSchema = z.object({
  discord_id: z.string().min(1).nullable(),
  player_id: z.guid().nullable(),
  puuid: z.string().min(1).nullable(),
  display_name: z.string().nullable(),
  role: z.string().nullable(),
});

export type SessionPlayerRow = z.infer<typeof sessionPlayerRowSchema>;
