import { discordConnectQuerySchema } from '@customs/db/schemas';
import { NextResponse } from 'next/server';
import { queryObject } from '@/lib/adminRoute';
import {
  CONNECT_FAILED,
  CONNECT_STATE_TTL_MS,
  connectResultPath,
  mintConnectState,
} from '@/lib/discord/connect';
import {
  DISCORD_AUTHORIZE_URL,
  type DiscordConnectRouteOptions,
  discordRouteDeps,
  redirectUri,
  seeOther,
} from '@/lib/discord/connectRoute';
import { jsonError } from '@/lib/http';

/**
 * `GET /api/admin/discord/connect?groupId=` (M14.20): the `Connect Discord` button. A group admin,
 * or the group's creator before they link a player (the setup gate, M14.40; the operator gets 403
 * like every write). Stores a fresh single-use state
 * bound to the session's auth user and the group, then 303s to Discord's consent screen with
 * `scope=webhook.incoming`, where the admin picks the channel.
 *
 * With the Discord app not configured on this server, the admin is sent straight back to the page
 * with the failure sentence, which offers the paste fallback.
 */
export function discordConnectRoute(
  options: DiscordConnectRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    const prepared = discordRouteDeps(request, options);
    if (!prepared.ok) return prepared.response;
    const { deps } = prepared;

    try {
      const raw = queryObject(request);
      const auth = await deps.authorize(typeof raw.groupId === 'string' ? raw.groupId : null);
      if (!auth.ok) return jsonError(auth.status, auth.error);

      const query = discordConnectQuerySchema.safeParse(raw);
      if (!query.success) return jsonError(400, 'query failed validation');
      const groupId = auth.writer.groupId;

      const slug = await deps.store.groupSlug(groupId);
      if (slug === null) return jsonError(404, 'no such group');

      if (deps.env === null) {
        console.error(
          'discord connect: DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not set; only paste works',
        );
        return seeOther(request, connectResultPath(slug, 'failed', CONNECT_FAILED));
      }

      const { state, stateHash } = mintConnectState(
        deps.env.DISCORD_CLIENT_SECRET,
        groupId,
        auth.writer.userId,
      );
      await deps.store.createState({
        stateHash,
        groupId,
        authUserId: auth.writer.userId,
        expiresAt: new Date(deps.now().getTime() + CONNECT_STATE_TTL_MS).toISOString(),
      });

      const authorize = new URL(DISCORD_AUTHORIZE_URL);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', deps.env.DISCORD_CLIENT_ID);
      authorize.searchParams.set('scope', 'webhook.incoming');
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('redirect_uri', redirectUri(request, deps.env));
      return NextResponse.redirect(authorize, 303);
    } catch (error) {
      console.error('discord connect failed', error);
      return jsonError(500, 'internal error');
    }
  };
}
