import type { NextResponse } from 'next/server';
import { getDiscordConfig, maskSecret, saveDiscordConfig } from '@/lib/admin/discordConfig';
import {
  redirectBack,
  type SetupRouteOptions,
  type WriteContext,
  withSetupWriteAuth,
} from '@/lib/adminRoute';
import { type DiscordConnectStore, supabaseDiscordConnectStore, webhookUrlFrom } from '@/lib/discord/connect';
import { sendTestPost } from '@/lib/discord/testPost';
import { lookupWebhook, parseWebhookLink, WEBHOOK_NOT_RECOGNISED } from '@/lib/discord/webhookInfo';
import { kustomAvatarUrl, siteOrigin } from '@/lib/siteUrl';
import type { ServiceClient } from '@/lib/supabase';
import { type DiscordConfigRequest, discordConfigRequestSchema, discordConfigResponseSchema } from './schema';

export interface DiscordConfigHandlerOptions {
  store?: (client: ServiceClient) => DiscordConnectStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** The 400 for a save with no server id, no new link and nothing on file to keep. */
export const PASTE_A_LINK_FIRST = "Paste the channel's webhook link first.";

/**
 * The paste route. Unchanged unless the body sets `sendTestPost` (M14.20, the paste fallback's
 * `Save and send a test post`): then, after the save, the test post goes to the stored webhook and
 * its outcome is recorded on `discord_config` (`test_post_at` on success, `test_post_error` with
 * Discord's reason otherwise). A failed test post does not undo the save.
 *
 * `guildId` is optional (paste-a-webhook follow-up): with a new `webhookUrl` and no `guildId`, the
 * server reads the webhook from Discord (`lib/discord/webhookInfo.ts`), stores the URL rebuilt from
 * its id and token, and takes the server and the results channel from Discord's answer. A link
 * Discord does not know is a 400 and nothing is saved. Without a new link, the stored server is kept.
 *
 * M14.26: every new link is parsed and rebuilt from its id and token **on every path**, including
 * an explicit `guildId` (which skips the Discord lookup). The schema's prefix check alone let a
 * pasted `?query`, `../` or trailing junk be stored as-is. A link that does not parse is the
 * lookup's own 400 and sentence; no network call is needed to say so.
 */
export function discordConfigHandler(
  options: DiscordConfigHandlerOptions = {},
): (input: DiscordConfigRequest, context: WriteContext) => Promise<NextResponse> {
  return async (input, context) => {
    // undefined = keep what is stored, null = clear, string = overwrite.
    let webhookUrl = input.clearWebhook === true ? null : (input.webhookUrl ?? undefined);
    let guildId = input.guildId;
    let resultsChannelId = input.resultsChannelId;

    if (typeof webhookUrl === 'string') {
      const parts = parseWebhookLink(webhookUrl);
      if (parts === null) return context.fail(400, WEBHOOK_NOT_RECOGNISED);
      webhookUrl = webhookUrlFrom(parts);
    }

    if (guildId === undefined) {
      if (typeof webhookUrl === 'string') {
        // A pasted link carries no server id: Discord says which server and channel it posts into.
        const info = await lookupWebhook(
          webhookUrl,
          options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
        );
        if (!info.ok) return context.fail(info.status, info.reason);
        webhookUrl = info.webhookUrl;
        guildId = info.guildId;
        resultsChannelId = info.channelId;
      } else {
        // No new link: keep the server already on file, if there is one.
        const stored = await getDiscordConfig(context.client, context.groupId);
        if (stored === null) return context.fail(400, PASTE_A_LINK_FIRST);
        guildId = stored.guildId;
      }
    }

    const result = await saveDiscordConfig(context.client, {
      // The request's group, already checked (M13.4): an admin configures their own group's channel.
      groupId: context.groupId,
      guildId,
      ...(webhookUrl === undefined ? {} : { webhookUrl }),
      resultsChannelId,
      lobbyVoiceChannelId: input.lobbyVoiceChannelId,
      blueVoiceChannelId: input.blueVoiceChannelId,
      redVoiceChannelId: input.redVoiceChannelId,
    });
    if (!result.ok) return context.fail(result.status, result.error);
    const config = result.value;

    let testPost: { posted: boolean; testPostAt: string | null; testPostError: string | null } | undefined;
    if (input.sendTestPost === true && config.webhookUrl !== null) {
      const outcome = await sendTestPost(config.webhookUrl, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        avatarUrl: kustomAvatarUrl(siteOrigin(context.request)),
      });
      testPost = outcome.ok
        ? { posted: true, testPostAt: (options.now?.() ?? new Date()).toISOString(), testPostError: null }
        : { posted: false, testPostAt: null, testPostError: outcome.reason };
      await (options.store ?? supabaseDiscordConnectStore)(context.client).recordTestPost(context.groupId, {
        at: testPost.testPostAt,
        error: testPost.testPostError,
      });
      if (context.form && !testPost.posted) {
        return redirectBack(context.request, context.redirectTo, { error: testPost.testPostError ?? '' });
      }
    }

    return context.respond(
      discordConfigResponseSchema,
      {
        ok: true,
        guildId: config.guildId,
        webhookSet: config.webhookUrl !== null,
        webhookMasked: maskSecret(config.webhookUrl),
        resultsChannelId: config.resultsChannelId,
        lobbyVoiceChannelId: config.lobbyVoiceChannelId,
        blueVoiceChannelId: config.blueVoiceChannelId,
        redVoiceChannelId: config.redVoiceChannelId,
        ...(testPost === undefined ? {} : { testPost }),
      },
      testPost?.posted ? 'Saved. Test post sent' : 'Discord config saved',
    );
  };
}

/** See `app/api/admin/tokens/handler.ts` for why the handler is not inside `route.ts`. */
export const handleDiscordConfig = discordConfigHandler();

/**
 * The route: the setup gate (M14.40), a form post going back to the checked group's Discord page.
 */
export function discordConfigRoute(
  options: SetupRouteOptions & DiscordConfigHandlerOptions = {},
): (request: Request) => Promise<NextResponse> {
  const { store, fetchImpl, now, ...rest } = options;
  const handlerOptions: DiscordConfigHandlerOptions = {
    ...(store ? { store } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(now ? { now } : {}),
  };
  return withSetupWriteAuth(discordConfigRequestSchema, discordConfigHandler(handlerOptions), {
    section: 'discord',
    ...rest,
  });
}
