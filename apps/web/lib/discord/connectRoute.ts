import { NextResponse } from 'next/server';
import { type AdminAuthResult, resolveSetupWrite, type SetupWriteResult, toSetupWrite } from '../adminAuth';
import { type DiscordOAuthEnv, readDiscordOAuthEnv, ServerEnvError } from '../env';
import { jsonError } from '../http';
import { siteOrigin } from '../siteUrl';
import { getServiceClient, type ServiceClient } from '../supabase';
import { requestCookieJar } from '../supabaseAuth';
import { type DiscordConnectStore, supabaseDiscordConnectStore } from './connect';

/**
 * What the M14.20 routes share: injection points, the write gate (the operator never connects
 * anything), and the redirect URI. The gate is the **setup gate** (M14.40, `resolveSetupWrite`): a
 * group admin, or the group's creator before they link a player. Each route stays a factory so the tests hand it a fake Discord,
 * a fake session and an in-memory store.
 */

export const CALLBACK_PATH = '/api/admin/discord/callback';
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export interface DiscordConnectRouteOptions {
  getClient?: () => ServiceClient;
  store?: (client: ServiceClient) => DiscordConnectStore;
  /** The write gate, session injected in tests. An admin-gate answer is read as a `group_admin`. */
  authorize?: (
    request: Request,
    client: ServiceClient,
    groupId: string | null,
  ) => Promise<AdminAuthResult | SetupWriteResult>;
  env?: () => DiscordOAuthEnv | null;
  /** Both Discord calls (the token exchange and the test post) go through this. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface DiscordRouteDeps {
  client: ServiceClient;
  store: DiscordConnectStore;
  authorize: (groupId: string | null) => Promise<SetupWriteResult>;
  env: DiscordOAuthEnv | null;
  fetchImpl: typeof fetch;
  now: () => Date;
}

/** The deps, or the 500 a misconfigured server answers with. */
export function discordRouteDeps(
  request: Request,
  options: DiscordConnectRouteOptions,
): { ok: true; deps: DiscordRouteDeps } | { ok: false; response: NextResponse } {
  let client: ServiceClient;
  try {
    client = options.getClient ? options.getClient() : getServiceClient();
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`discord connect: ${error.message}`);
      return { ok: false, response: jsonError(500, 'server is not configured') };
    }
    throw error;
  }
  return {
    ok: true,
    deps: {
      client,
      store: (options.store ?? supabaseDiscordConnectStore)(client),
      authorize: async (groupId) =>
        options.authorize
          ? toSetupWrite(await options.authorize(request, client, groupId))
          : resolveSetupWrite(requestCookieJar(request), client, groupId),
      env: (options.env ?? readDiscordOAuthEnv)(),
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      now: options.now ?? (() => new Date()),
    },
  };
}

/** The exact redirect URI: pinned by `DISCORD_REDIRECT_URI`, else this origin's callback. */
export function redirectUri(request: Request, env: DiscordOAuthEnv): string {
  return env.DISCORD_REDIRECT_URI ?? new URL(CALLBACK_PATH, siteOrigin(request)).toString();
}

/** 303 to a path on this site. */
export function seeOther(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, siteOrigin(request)), 303);
}
