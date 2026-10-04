import { z } from 'zod';
import { groupIdSchema } from './groups';

/**
 * Connect Discord in one click (M14.20): OAuth2 `webhook.incoming`, the paste route as the
 * fallback, and the test post. Every boundary of the flow: our two routes' queries, Discord's
 * token response, and the reads and writes the admin Discord page (M14.23) is built against.
 */

/** A Discord snowflake: a 64-bit id, written in decimal. */
export const discordSnowflakeSchema = z.string().regex(/^\d{17,20}$/, 'not a Discord id');

/** `GET /api/admin/discord/connect?groupId=`: the admin's own group. */
export const discordConnectQuerySchema = z.object({ groupId: groupIdSchema });

export type DiscordConnectQuery = z.infer<typeof discordConnectQuerySchema>;

/**
 * `GET /api/admin/discord/callback`: what Discord sends back. `code` on success; `error` (and maybe
 * `error_description`) when the admin cancelled or Discord refused. `state` is always ours.
 * Lengths are capped so a forged query cannot make the server hash megabytes.
 */
export const discordCallbackQuerySchema = z.object({
  state: z.string().min(1).max(256),
  code: z.string().min(1).max(512).optional(),
  error: z.string().min(1).max(200).optional(),
  error_description: z.string().max(1000).optional(),
});

export type DiscordCallbackQuery = z.infer<typeof discordCallbackQuerySchema>;

/**
 * The webhook inside Discord's token response. `token` is the webhook's own secret: it is joined
 * into the URL and stored only as part of `discord_config.webhook_url`.
 */
export const discordIncomingWebhookSchema = z.object({
  id: discordSnowflakeSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, 'not a webhook token'),
  channel_id: discordSnowflakeSchema,
  guild_id: discordSnowflakeSchema,
  name: z.string().nullish(),
});

/**
 * `GET https://discord.com/api/webhooks/<id>/<token>` (no auth; the token in the path is the
 * credential): what the paste route reads to learn which server and channel a pasted webhook link
 * posts into. Discord also sends `name`, `avatar`, `application_id` and the token back; they are
 * stripped, and the token is never read from here -- the URL is rebuilt from the pasted parts.
 */
export const discordWebhookInfoSchema = z.object({
  id: discordSnowflakeSchema,
  channel_id: discordSnowflakeSchema,
  guild_id: discordSnowflakeSchema,
});

export type DiscordWebhookInfo = z.infer<typeof discordWebhookInfoSchema>;

/**
 * `POST https://discord.com/api/oauth2/token` for a `webhook.incoming` code. The access and
 * refresh tokens are parsed only to check the shape and then dropped: no Discord user token is
 * stored anywhere (M14.20 acceptance 3). Unknown keys are stripped.
 */
export const discordTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  scope: z.string(),
  webhook: discordIncomingWebhookSchema,
});

export type DiscordTokenResponse = z.infer<typeof discordTokenResponseSchema>;

/**
 * Where the callback sends the admin: `/g/<slug>/admin/discord?discord=<result>`.
 *
 * - `connected`: the webhook is stored and the test post landed.
 * - `test_failed`: the webhook is stored but the test post did not land; Discord's reason is in
 *   `GET /api/admin/discord`'s `testPostError` (and in the redirect's `error`).
 * - `failed`: cancelled, denied, expired or the exchange failed; nothing was stored. The redirect's
 *   `error` carries the sentence.
 */
export const DISCORD_CONNECT_RESULTS = ['connected', 'test_failed', 'failed'] as const;
export const discordConnectResultSchema = z.enum(DISCORD_CONNECT_RESULTS);
export type DiscordConnectResult = z.infer<typeof discordConnectResultSchema>;

/** `GET /api/admin/discord?groupId=`: the page's state. Never the webhook URL, not even masked. */
export const adminDiscordQuerySchema = z.object({ groupId: groupIdSchema });

export const adminDiscordResponseSchema = z.object({
  ok: z.literal(true),
  /** A webhook is stored. */
  connected: z.boolean(),
  guildId: z.string().nullable(),
  /** The results channel the webhook posts into, when known (a webhook carries an id only). */
  channelId: z.string().nullable(),
  /** When the last test post to the stored webhook landed. */
  testPostAt: z.string().nullable(),
  /** Discord's reason when the last test post did not land. */
  testPostError: z.string().nullable(),
});

export type AdminDiscordResponse = z.infer<typeof adminDiscordResponseSchema>;

/**
 * `POST /api/admin/discord/test { groupId }`: send the test post to the stored webhook now -- the
 * paste path's `Save and send a test post` calls this after the paste route saved the link.
 */
export const discordTestRequestSchema = z.object({
  groupId: groupIdSchema,
  redirectTo: z.string().optional(),
});

export type DiscordTestRequest = z.infer<typeof discordTestRequestSchema>;

export const discordTestResponseSchema = z.object({
  ok: z.literal(true),
  posted: z.boolean(),
  testPostAt: z.string().nullable(),
  testPostError: z.string().nullable(),
});

export type DiscordTestResponse = z.infer<typeof discordTestResponseSchema>;
