import { discordTestRequestSchema, discordTestResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { redirectBack, type SetupRouteOptions, withSetupWriteAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
import { type DiscordConnectStore, supabaseDiscordConnectStore } from '@/lib/discord/connect';
import { sendTestPost } from '@/lib/discord/testPost';
import { kustomAvatarUrl, siteOrigin } from '@/lib/siteUrl';
import type { ServiceClient } from '@/lib/supabase';

/**
 * `POST /api/admin/discord/test { groupId }` (M14.20): send the test post to the group's stored
 * webhook now and record the outcome. The paste fallback's `Save and send a test post` calls this
 * right after `POST /api/admin/discord-config` saved the link (that route stays exactly as it was).
 * The setup gate (M14.40): a group admin, or the group's creator before they link a player. No
 * webhook stored: 409.
 */

export const NO_WEBHOOK = 'No webhook is saved for this group yet.';

export interface DiscordTestRouteOptions extends SetupRouteOptions {
  store?: (client: ServiceClient) => DiscordConnectStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function discordTestRoute(
  options: DiscordTestRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withSetupWriteAuth(
    discordTestRequestSchema,
    async (input, context) => {
      const store = (options.store ?? supabaseDiscordConnectStore)(context.client);
      const url = await store.readWebhookUrl(context.groupId);
      if (url === null) return context.fail(409, NO_WEBHOOK);

      const outcome = await sendTestPost(url, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        avatarUrl: kustomAvatarUrl(siteOrigin(context.request)),
      });
      const at = outcome.ok ? (options.now?.() ?? new Date()).toISOString() : null;
      const error = outcome.ok ? null : outcome.reason;
      await store.recordTestPost(context.groupId, { at, error });

      if (context.form) {
        const back = safeNextPath(input.redirectTo) ?? context.redirectTo;
        return redirectBack(
          context.request,
          back,
          outcome.ok ? { notice: 'Test post sent' } : { error: error ?? '' },
        );
      }
      return context.respond(
        discordTestResponseSchema,
        { ok: true, posted: outcome.ok, testPostAt: at, testPostError: error },
        'Test post sent',
      );
    },
    { section: 'discord', ...options },
  );
}
