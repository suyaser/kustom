import { discordCallbackQuerySchema, discordTokenResponseSchema } from '@customs/db/schemas';
import type { NextResponse } from 'next/server';
import { queryObject } from '@/lib/adminRoute';
import {
  CONNECT_BAD_STATE,
  CONNECT_FAILED,
  CONNECT_OTHER_SESSION,
  connectResultPath,
  stateHashOf,
  verifyConnectState,
  webhookUrlFrom,
} from '@/lib/discord/connect';
import {
  DISCORD_TOKEN_URL,
  type DiscordConnectRouteOptions,
  type DiscordRouteDeps,
  discordRouteDeps,
  redirectUri,
  seeOther,
} from '@/lib/discord/connectRoute';
import { sendTestPost } from '@/lib/discord/testPost';
import type { DiscordOAuthEnv } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { kustomAvatarUrl, siteOrigin } from '@/lib/siteUrl';

/**
 * `GET /api/admin/discord/callback` (M14.20): where Discord sends the admin back.
 *
 * In this order, and nothing is written before the state has passed every check:
 *
 *   1. The query through zod. Malformed: 400.
 *   2. The state: shaped like ours, a stored row, and its MAC holds for that row's group and user.
 *      Otherwise 400 -- a forged state learns nothing and stores nothing.
 *   3. The session: the write gate for the **stored** group (401 / 403) -- the setup gate, so the
 *      group's unlinked creator passes as at the connect route (M14.40) -- and the same auth user
 *      that pressed `Connect Discord` (403). A state carried to another session or another
 *      group's admin is refused here.
 *   4. Consume it: one atomic update that also checks unused and unexpired. A reused or expired
 *      state goes back to the page with the failure sentence, nothing stored.
 *   5. Cancelled or denied on Discord (`error=`, or no `code`): back with the failure sentence.
 *   6. Exchange the code (client id + secret, the same redirect URI). Discord's answer through zod;
 *      **only the webhook is kept** -- the access and refresh tokens are dropped, never stored.
 *   7. Store the webhook as the group's (replacing any), send the test post, record it, and 303 to
 *      `/g/<slug>/admin/discord?discord=connected` -- or `test_failed` with Discord's reason.
 */
export function discordCallbackRoute(
  options: DiscordConnectRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    const prepared = discordRouteDeps(request, options);
    if (!prepared.ok) return prepared.response;
    const { deps } = prepared;

    try {
      const query = discordCallbackQuerySchema.safeParse(queryObject(request));
      if (!query.success) return jsonError(400, 'query failed validation');
      const { state, code, error: discordError } = query.data;

      // Without the app's secret no state can be verified, and none can have been issued.
      if (deps.env === null) return jsonError(400, CONNECT_BAD_STATE);

      const stateHash = stateHashOf(state);
      const row = stateHash === null ? null : await deps.store.findState(stateHash);
      if (
        stateHash === null ||
        row === null ||
        !verifyConnectState(deps.env.DISCORD_CLIENT_SECRET, state, row.groupId, row.authUserId)
      ) {
        return jsonError(400, CONNECT_BAD_STATE);
      }

      const auth = await deps.authorize(row.groupId);
      if (!auth.ok) return jsonError(auth.status, auth.error);
      if (auth.writer.userId.toLowerCase() !== row.authUserId.toLowerCase()) {
        return jsonError(403, CONNECT_OTHER_SESSION);
      }

      const slug = await deps.store.groupSlug(row.groupId);
      if (slug === null) return jsonError(404, 'no such group');
      const failed = () => seeOther(request, connectResultPath(slug, 'failed', CONNECT_FAILED));

      if (!(await deps.store.consumeState(stateHash, deps.now().toISOString()))) return failed();
      if (discordError !== undefined || code === undefined) return failed();

      const webhook = await exchangeCode(request, deps, deps.env, code);
      if (webhook === null) return failed();

      await deps.store.saveWebhook(row.groupId, webhook);
      return await testAndRedirect(request, deps, row.groupId, slug, webhook.webhookUrl);
    } catch (error) {
      console.error('discord callback failed', error);
      return jsonError(500, 'internal error');
    }
  };
}

/** The webhook from Discord's token response, or null (logged without any secret). */
async function exchangeCode(
  request: Request,
  deps: DiscordRouteDeps,
  env: DiscordOAuthEnv,
  code: string,
): Promise<{ webhookUrl: string; guildId: string; channelId: string } | null> {
  let response: Response;
  try {
    response = await deps.fetchImpl(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(request, env),
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
      // A 3xx must never carry the code and client secret off discord.com; a refused redirect throws.
      redirect: 'error',
    });
  } catch (error) {
    console.error(
      `discord connect: token exchange did not complete (${error instanceof Error ? error.name : 'error'})`,
    );
    return null;
  }

  if (!response.ok) {
    await response.text().catch(() => '');
    console.error(`discord connect: token exchange refused (HTTP ${response.status})`);
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error('discord connect: token response was not JSON');
    return null;
  }
  const parsed = discordTokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    // The paths only: the body holds tokens.
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    console.error(`discord connect: unexpected token response (${paths})`);
    return null;
  }

  const { webhook } = parsed.data;
  return { webhookUrl: webhookUrlFrom(webhook), guildId: webhook.guild_id, channelId: webhook.channel_id };
}

/** Send the test post to the stored webhook, record the outcome, 303 to the page. */
export async function testAndRedirect(
  request: Request,
  deps: DiscordRouteDeps,
  groupId: string,
  slug: string,
  webhookUrl: string,
): Promise<NextResponse> {
  const outcome = await sendTestPost(webhookUrl, {
    fetchImpl: deps.fetchImpl,
    avatarUrl: kustomAvatarUrl(siteOrigin(request)),
  });
  if (outcome.ok) {
    await deps.store.recordTestPost(groupId, { at: deps.now().toISOString(), error: null });
    return seeOther(request, connectResultPath(slug, 'connected'));
  }
  await deps.store.recordTestPost(groupId, { at: null, error: outcome.reason });
  return seeOther(request, connectResultPath(slug, 'test_failed', outcome.reason));
}
