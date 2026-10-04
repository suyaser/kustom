import { groupIdSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { booleanFieldSchema, nullableTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/discord-config`: the body's group's `discord_config` row (one per group since
 * M13.4's `0020`).
 *
 * `webhookUrl` is three-valued on purpose. The page shows the stored URL masked, and a masked
 * value cannot be posted back, so an empty field must mean "leave it alone" — clearing needs
 * its own checkbox.
 */
export const discordConfigRequestSchema = z
  .object({
    /** The group whose channels these are (M13.4). The caller must be an admin of it. */
    groupId: groupIdSchema,
    /**
     * Optional since the paste-a-webhook follow-up to M14.20: a pasted webhook link carries no
     * server id, so when `webhookUrl` is set and this is absent the server asks Discord for the
     * webhook's server and channel. An explicit id is still accepted (and then no lookup is made).
     * Empty and the old `'unknown'` placeholder both read as absent.
     */
    guildId: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => {
        const trimmed = (value ?? '').trim();
        return trimmed.length === 0 || trimmed.toLowerCase() === 'unknown' ? undefined : trimmed;
      }),
    /** Empty keeps the stored one. */
    webhookUrl: nullableTextSchema,
    /** Explicit "forget the webhook". Wins over `webhookUrl`. */
    clearWebhook: booleanFieldSchema.optional(),
    /**
     * M14.20, the paste fallback's `Save and send a test post`: after saving, send the test post to
     * the stored webhook and record it (`discord_config.test_post_at` / `test_post_error`). Absent or
     * false: the route behaves exactly as before.
     */
    sendTestPost: booleanFieldSchema.optional(),
    resultsChannelId: nullableTextSchema,
    lobbyVoiceChannelId: nullableTextSchema,
    blueVoiceChannelId: nullableTextSchema,
    redVoiceChannelId: nullableTextSchema,
  })
  .refine(
    (value) =>
      value.webhookUrl === null ||
      /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(value.webhookUrl),
    { path: ['webhookUrl'], message: 'must be a https://discord.com/api/webhooks/... URL' },
  );

export type DiscordConfigRequest = z.infer<typeof discordConfigRequestSchema>;

export const discordConfigResponseSchema = z.object({
  ok: z.literal(true),
  guildId: z.string().min(1),
  /** The URL itself is never sent back, only whether one is stored and its masked tail. */
  webhookSet: z.boolean(),
  webhookMasked: z.string().nullable(),
  resultsChannelId: z.string().nullable(),
  lobbyVoiceChannelId: z.string().nullable(),
  blueVoiceChannelId: z.string().nullable(),
  redVoiceChannelId: z.string().nullable(),
  /** Present only when the request asked for `sendTestPost` (M14.20). */
  testPost: z
    .object({
      posted: z.boolean(),
      testPostAt: z.string().nullable(),
      testPostError: z.string().nullable(),
    })
    .optional(),
});

export type DiscordConfigResponse = z.infer<typeof discordConfigResponseSchema>;
