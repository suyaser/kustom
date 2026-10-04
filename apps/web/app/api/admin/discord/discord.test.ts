import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminDiscordResponseSchema } from '@customs/db/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminAuthResult, AdminReadResult } from '@/lib/adminAuth';
import {
  CONNECT_BAD_STATE,
  CONNECT_FAILED,
  CONNECT_OTHER_SESSION,
  type ConnectStateRow,
  type DiscordConnectStore,
  type DiscordStatusRow,
  mintConnectState,
} from '@/lib/discord/connect';
import type { DiscordConnectRouteOptions } from '@/lib/discord/connectRoute';
import { TEST_POST_TEXT } from '@/lib/discord/testPost';
import type { DiscordOAuthEnv } from '@/lib/env';
import type { ServiceClient } from '@/lib/supabase';
import { discordCallbackRoute } from './callback/handler';
import { discordConnectRoute } from './connect/handler';
import { adminDiscordRoute } from './handler';
import { discordTestRoute, NO_WEBHOOK } from './test/handler';

/**
 * Connect Discord (M14.20) with a fake Discord, a fake session and an in-memory store: every
 * acceptance case that does not need Postgres. The Supabase store and `0025` are exercised by
 * `discord-connect.integration.test.ts`.
 */

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';
const HANA = 'aaaaaaaa-0000-4000-8000-000000000001'; // admin of A
const ZOE = 'aaaaaaaa-0000-4000-8000-000000000002'; // admin of B
const BOTH = 'aaaaaaaa-0000-4000-8000-000000000003'; // admin of A and B
const MEMBER = 'aaaaaaaa-0000-4000-8000-000000000004'; // admin of nothing

const ADMIN_OF: Record<string, string[]> = {
  [HANA]: [GROUP_A],
  [ZOE]: [GROUP_B],
  [BOTH]: [GROUP_A, GROUP_B],
  [MEMBER]: [],
};
const SLUGS: Record<string, string> = { [GROUP_A]: 'alpha', [GROUP_B]: 'bravo' };

const ENV: DiscordOAuthEnv = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/api/admin/discord/callback',
};

const ACCESS_TOKEN = 'user-access-token-must-not-be-stored';
const REFRESH_TOKEN = 'user-refresh-token-must-not-be-stored';
const WEBHOOK = {
  id: '223456789012345678',
  token: 'WebhookToken_abcdefghijklmnopqrstuvwxyz-0123',
  guild: '323456789012345678',
  channel: '423456789012345678',
};
const WEBHOOK_URL = `https://discord.com/api/webhooks/${WEBHOOK.id}/${WEBHOOK.token}`;

class MemoryStore implements DiscordConnectStore {
  states = new Map<string, ConnectStateRow>();
  configs = new Map<
    string,
    {
      webhookUrl: string | null;
      guildId: string;
      channelId: string | null;
      testPostAt: string | null;
      testPostError: string | null;
    }
  >();

  async createState(row: { stateHash: string; groupId: string; authUserId: string; expiresAt: string }) {
    this.states.set(row.stateHash, {
      groupId: row.groupId,
      authUserId: row.authUserId,
      expiresAt: row.expiresAt,
      usedAt: null,
    });
  }
  async findState(hash: string) {
    return this.states.get(hash) ?? null;
  }
  async consumeState(hash: string, nowIso: string) {
    const row = this.states.get(hash);
    if (!row || row.usedAt !== null || Date.parse(row.expiresAt) <= Date.parse(nowIso)) return false;
    row.usedAt = nowIso;
    return true;
  }
  async groupSlug(groupId: string) {
    return SLUGS[groupId] ?? null;
  }
  async saveWebhook(groupId: string, w: { webhookUrl: string; guildId: string; channelId: string }) {
    const before = this.configs.get(groupId);
    const changed = before?.webhookUrl !== w.webhookUrl;
    this.configs.set(groupId, {
      webhookUrl: w.webhookUrl,
      guildId: w.guildId,
      channelId: w.channelId,
      // 0025's trigger: a new webhook clears the old test post.
      testPostAt: changed ? null : (before?.testPostAt ?? null),
      testPostError: changed ? null : (before?.testPostError ?? null),
    });
  }
  async readWebhookUrl(groupId: string) {
    return this.configs.get(groupId)?.webhookUrl ?? null;
  }
  async recordTestPost(groupId: string, outcome: { at: string | null; error: string | null }) {
    const row = this.configs.get(groupId);
    if (row) Object.assign(row, { testPostAt: outcome.at, testPostError: outcome.error });
  }
  async readStatus(groupId: string): Promise<DiscordStatusRow | null> {
    const row = this.configs.get(groupId);
    if (!row) return null;
    return {
      webhookSet: row.webhookUrl !== null,
      guildId: row.guildId,
      channelId: row.channelId,
      testPostAt: row.testPostAt,
      testPostError: row.testPostError,
    };
  }
}

interface FakeDiscord {
  fetch: typeof fetch;
  tokenCalls: URLSearchParams[];
  webhookPosts: { url: string; body: unknown }[];
  /** Every request's `redirect` mode, in order. */
  redirects: (RequestRedirect | undefined)[];
}

function fakeDiscord(opts: { token?: () => Response; webhook?: () => Response } = {}): FakeDiscord {
  const tokenCalls: URLSearchParams[] = [];
  const webhookPosts: { url: string; body: unknown }[] = [];
  const redirects: (RequestRedirect | undefined)[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    redirects.push(init?.redirect);
    if (url === 'https://discord.com/api/oauth2/token') {
      tokenCalls.push(new URLSearchParams(String(init?.body)));
      return opts.token
        ? opts.token()
        : Response.json({
            access_token: ACCESS_TOKEN,
            refresh_token: REFRESH_TOKEN,
            token_type: 'Bearer',
            expires_in: 604800,
            scope: 'webhook.incoming',
            webhook: {
              id: WEBHOOK.id,
              token: WEBHOOK.token,
              url: WEBHOOK_URL,
              channel_id: WEBHOOK.channel,
              guild_id: WEBHOOK.guild,
              name: 'Kustom',
              type: 1,
              application_id: ENV.DISCORD_CLIENT_ID,
            },
          });
    }
    if (url.startsWith('https://discord.com/api/webhooks/')) {
      webhookPosts.push({ url, body: JSON.parse(String(init?.body)) });
      return opts.webhook ? opts.webhook() : new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch: impl as typeof fetch, tokenCalls, webhookPosts, redirects };
}

function authorizeAs(userId: string | null) {
  return async (
    _request: Request,
    _client: ServiceClient,
    groupId: string | null,
  ): Promise<AdminAuthResult> => {
    if (userId === null) return { ok: false, status: 401, error: 'sign in required' };
    if (groupId === null) return { ok: false, status: 400, error: 'groupId is required' };
    if (!(ADMIN_OF[userId] ?? []).includes(groupId))
      return { ok: false, status: 403, error: 'not an admin of this group' };
    return {
      ok: true,
      admin: {
        userId,
        discordId: '1',
        playerId: 'p',
        groupId,
        puuid: 'x',
        displayName: null,
        email: null,
        discordName: null,
      },
    };
  };
}

let store: MemoryStore;
let clock: Date;

beforeEach(() => {
  store = new MemoryStore();
  clock = new Date('2026-10-03T20:00:00.000Z');
});

function options(
  userId: string | null,
  discord: FakeDiscord,
  env: DiscordOAuthEnv | null = ENV,
): DiscordConnectRouteOptions {
  return {
    getClient: () => ({}) as ServiceClient,
    store: () => store,
    authorize: authorizeAs(userId),
    env: () => env,
    fetchImpl: discord.fetch,
    now: () => clock,
  };
}

async function connect(
  userId: string | null,
  groupId: string,
  discord = fakeDiscord(),
  env: DiscordOAuthEnv | null = ENV,
) {
  return discordConnectRoute(options(userId, discord, env))(
    new Request(`http://localhost:3000/api/admin/discord/connect?groupId=${groupId}`),
  );
}

async function callback(userId: string | null, query: Record<string, string>, discord: FakeDiscord) {
  const url = new URL('http://localhost:3000/api/admin/discord/callback');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return discordCallbackRoute(options(userId, discord))(new Request(url));
}

/** Press Connect as `userId` for `groupId` and return the state Discord would hand back. */
async function stateFor(userId: string, groupId: string): Promise<string> {
  const response = await connect(userId, groupId);
  expect(response.status).toBe(303);
  return new URL(response.headers.get('location') ?? '').searchParams.get('state') ?? '';
}

function landing(response: Response): { path: string; params: URLSearchParams } {
  const url = new URL(response.headers.get('location') ?? 'http://x/');
  return { path: url.pathname, params: url.searchParams };
}

describe('GET /api/admin/discord/connect', () => {
  it("redirects an admin to Discord's consent screen with webhook.incoming and a stored, bound state", async () => {
    const response = await connect(HANA, GROUP_A);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(location.searchParams.get('scope')).toBe('webhook.incoming');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe(ENV.DISCORD_CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(ENV.DISCORD_REDIRECT_URI);
    const state = location.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);

    expect([...store.states.values()]).toEqual([
      { groupId: GROUP_A, authUserId: HANA, expiresAt: '2026-10-03T20:10:00.000Z', usedAt: null },
    ]);
    // Only the hash is stored, never the nonce.
    expect(JSON.stringify([...store.states.entries()])).not.toContain(state.split('.')[0]);
  });

  it('is 403 for a non-admin and 401 without a session, storing no state', async () => {
    expect((await connect(MEMBER, GROUP_A)).status).toBe(403);
    expect((await connect(ZOE, GROUP_A)).status).toBe(403);
    expect((await connect(null, GROUP_A)).status).toBe(401);
    expect(store.states.size).toBe(0);
  });

  it('sends the admin back to the page with the paste fallback when the app is not configured', async () => {
    const response = await connect(HANA, GROUP_A, fakeDiscord(), null);
    expect(response.status).toBe(303);
    const { path, params } = landing(response);
    expect(path).toBe('/g/alpha/admin/discord');
    expect(params.get('discord')).toBe('failed');
    expect(params.get('error')).toBe(CONNECT_FAILED);
    expect(store.states.size).toBe(0);
  });
});

describe('GET /api/admin/discord/callback', () => {
  it('stores the webhook, posts once, records the test post and lands on the page as connected', async () => {
    const state = await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord();
    const response = await callback(HANA, { state, code: 'the-code' }, discord);

    expect(response.status).toBe(303);
    const { path, params } = landing(response);
    expect(path).toBe('/g/alpha/admin/discord');
    expect(params.get('discord')).toBe('connected');

    expect(discord.tokenCalls).toHaveLength(1);
    const exchange = discord.tokenCalls[0] as URLSearchParams;
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code')).toBe('the-code');
    expect(exchange.get('redirect_uri')).toBe(ENV.DISCORD_REDIRECT_URI);
    expect(exchange.get('client_id')).toBe(ENV.DISCORD_CLIENT_ID);
    expect(exchange.get('client_secret')).toBe(ENV.DISCORD_CLIENT_SECRET);

    expect(discord.webhookPosts).toEqual([
      // M14.61: as Kustom; a localhost origin sends no avatar (05-design 10.10).
      {
        url: WEBHOOK_URL,
        body: { username: 'Kustom', content: TEST_POST_TEXT, allowed_mentions: { parse: [] } },
      },
    ]);
    expect(store.configs.get(GROUP_A)).toEqual({
      webhookUrl: WEBHOOK_URL,
      guildId: WEBHOOK.guild,
      channelId: WEBHOOK.channel,
      testPostAt: clock.toISOString(),
      testPostError: null,
    });
    expect(store.configs.has(GROUP_B)).toBe(false);
    // Neither the exchange (code + client secret) nor the test post (webhook token) follows a 3xx.
    expect(discord.redirects).toEqual(['error', 'error']);
  });

  it('a redirected exchange or test post (fetch throws on redirect: error) is a failure, never followed', async () => {
    // What undici does with `redirect: 'error'` and a 3xx.
    const redirected = (): Response => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    };
    const exchangeState = await stateFor(HANA, GROUP_A);
    const viaExchange = fakeDiscord({ token: redirected });
    const failed = await callback(HANA, { state: exchangeState, code: 'c' }, viaExchange);
    expect(landing(failed).params.get('discord')).toBe('failed');
    expect(store.configs.size).toBe(0);

    const postState = await stateFor(HANA, GROUP_A);
    const viaPost = fakeDiscord({ webhook: redirected });
    const testFailed = await callback(HANA, { state: postState, code: 'c' }, viaPost);
    expect(landing(testFailed).params.get('discord')).toBe('test_failed');
    expect(store.configs.get(GROUP_A)?.testPostError).toBe("Couldn't reach Discord.");
  });

  it('stores no Discord user token anywhere (acceptance 3)', async () => {
    const state = await stateFor(HANA, GROUP_A);
    await callback(HANA, { state, code: 'c' }, fakeDiscord());
    const everything = JSON.stringify([[...store.states.entries()], [...store.configs.entries()]]);
    expect(everything).not.toContain(ACCESS_TOKEN);
    expect(everything).not.toContain(REFRESH_TOKEN);
  });

  it('refuses a forged state with 400 and touches nothing', async () => {
    await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord();
    for (const state of ['nope', `${'a'.repeat(43)}.${'b'.repeat(43)}`]) {
      const response = await callback(HANA, { state, code: 'c' }, discord);
      expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([
        400,
        CONNECT_BAD_STATE,
      ]);
    }
    expect(discord.tokenCalls).toHaveLength(0);
    expect(store.configs.size).toBe(0);
  });

  it('refuses a real nonce with a tampered or foreign signature', async () => {
    const state = await stateFor(HANA, GROUP_A);
    const [nonce] = state.split('.');
    // Signed with another secret, and signed for another group: both fail the MAC.
    const otherSecret = mintConnectState('another-secret', GROUP_A, HANA).state.split('.')[1];
    const discord = fakeDiscord();
    for (const forged of [`${nonce}.${otherSecret}`, `${nonce}.${'x'.repeat(43)}`]) {
      expect((await callback(HANA, { state: forged, code: 'c' }, discord)).status).toBe(400);
    }
    expect(discord.tokenCalls).toHaveLength(0);
    expect(store.configs.size).toBe(0);
  });

  it('refuses an expired state: back to the page, nothing stored, Discord never asked', async () => {
    const state = await stateFor(HANA, GROUP_A);
    clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1);
    const discord = fakeDiscord();
    const response = await callback(HANA, { state, code: 'c' }, discord);
    expect(landing(response).params.get('discord')).toBe('failed');
    expect(landing(response).params.get('error')).toBe(CONNECT_FAILED);
    expect(discord.tokenCalls).toHaveLength(0);
    expect(store.configs.size).toBe(0);
  });

  it('refuses a reused state, even two callbacks racing: one webhook, one post', async () => {
    const state = await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord();
    const [first, second] = await Promise.all([
      callback(HANA, { state, code: 'c' }, discord),
      callback(HANA, { state, code: 'c' }, discord),
    ]);
    const results = [first, second].map((response) => landing(response).params.get('discord')).sort();
    expect(results).toEqual(['connected', 'failed']);
    const third = await callback(HANA, { state, code: 'c' }, discord);
    expect(landing(third).params.get('discord')).toBe('failed');
    expect(discord.tokenCalls).toHaveLength(1);
    expect(discord.webhookPosts).toHaveLength(1);
  });

  it("refuses another group's state: another group's admin is 403, and so is a different admin of the same group", async () => {
    const stateB = await stateFor(ZOE, GROUP_B);
    const discord = fakeDiscord();
    // Hana is not an admin of B: the gate for the stored group refuses her.
    expect((await callback(HANA, { state: stateB, code: 'c' }, discord)).status).toBe(403);
    // BOTH is an admin of B, but not the person who pressed Connect.
    const other = await callback(BOTH, { state: stateB, code: 'c' }, discord);
    expect([other.status, ((await other.json()) as { error: string }).error]).toEqual([
      403,
      CONNECT_OTHER_SESSION,
    ]);
    expect(discord.tokenCalls).toHaveLength(0);
    expect(store.configs.size).toBe(0);
    // And the state is still Zoe's to use.
    expect(landing(await callback(ZOE, { state: stateB, code: 'c' }, discord)).params.get('discord')).toBe(
      'connected',
    );
    expect([...store.configs.keys()]).toEqual([GROUP_B]);
  });

  it('is 403 for a non-admin and 401 without a session', async () => {
    const state = await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord();
    expect((await callback(MEMBER, { state, code: 'c' }, discord)).status).toBe(403);
    expect((await callback(null, { state, code: 'c' }, discord)).status).toBe(401);
    expect(store.configs.size).toBe(0);
  });

  it('cancelled or denied on Discord: back with the sentence, nothing stored, the state spent', async () => {
    const state = await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord();
    const response = await callback(
      HANA,
      { state, error: 'access_denied', error_description: 'The resource owner denied' },
      discord,
    );
    expect(landing(response).params.get('discord')).toBe('failed');
    expect(landing(response).params.get('error')).toBe(CONNECT_FAILED);
    expect(discord.tokenCalls).toHaveLength(0);
    expect(store.configs.size).toBe(0);
    expect([...store.states.values()][0]?.usedAt).not.toBeNull();
  });

  it('a refused exchange or a token response without a webhook: back with the sentence, nothing stored', async () => {
    const refusals = [
      () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      () => Response.json({ access_token: ACCESS_TOKEN, token_type: 'Bearer', scope: 'webhook.incoming' }),
      () => new Response('not json', { status: 200 }),
    ];
    for (const token of refusals) {
      const state = await stateFor(HANA, GROUP_A);
      const discord = fakeDiscord({ token });
      const response = await callback(HANA, { state, code: 'c' }, discord);
      expect(landing(response).params.get('discord')).toBe('failed');
      expect(discord.webhookPosts).toHaveLength(0);
    }
    expect(store.configs.size).toBe(0);
  });

  it("a failed test post keeps the webhook and Discord's reason for the page", async () => {
    const state = await stateFor(HANA, GROUP_A);
    const discord = fakeDiscord({
      webhook: () => Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }),
    });
    const response = await callback(HANA, { state, code: 'c' }, discord);
    const { params } = landing(response);
    expect(params.get('discord')).toBe('test_failed');
    expect(params.get('error')).toBe('Discord said: Missing Access');
    expect(store.configs.get(GROUP_A)).toMatchObject({
      webhookUrl: WEBHOOK_URL,
      testPostAt: null,
      testPostError: 'Discord said: Missing Access',
    });
  });

  it('connecting again replaces the webhook', async () => {
    store.configs.set(GROUP_A, {
      webhookUrl: 'https://discord.com/api/webhooks/1/old',
      guildId: 'g',
      channelId: null,
      testPostAt: '2026-01-01T00:00:00.000Z',
      testPostError: null,
    });
    const state = await stateFor(HANA, GROUP_A);
    await callback(HANA, { state, code: 'c' }, fakeDiscord());
    expect(store.configs.get(GROUP_A)?.webhookUrl).toBe(WEBHOOK_URL);
    expect(store.configs.get(GROUP_A)?.testPostAt).toBe(clock.toISOString());
  });

  it('is 400 for a query without a state', async () => {
    expect((await callback(HANA, { code: 'c' }, fakeDiscord())).status).toBe(400);
  });
});

describe('POST /api/admin/discord/test and GET /api/admin/discord', () => {
  function post(userId: string | null, discord: FakeDiscord, groupId = GROUP_A) {
    return discordTestRoute({
      getClient: () => ({}) as ServiceClient,
      store: () => store,
      authorize: authorizeAs(userId),
      fetchImpl: discord.fetch,
      now: () => clock,
    })(
      new Request('http://localhost/api/admin/discord/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
    );
  }

  it('is 409 without a webhook, posts and records with one, 403 for anyone else', async () => {
    const discord = fakeDiscord();
    const none = await post(HANA, discord);
    expect([none.status, ((await none.json()) as { error: string }).error]).toEqual([409, NO_WEBHOOK]);

    store.configs.set(GROUP_A, {
      webhookUrl: WEBHOOK_URL,
      guildId: 'g',
      channelId: null,
      testPostAt: null,
      testPostError: null,
    });
    const sent = await post(HANA, discord);
    expect(await sent.json()).toEqual({
      ok: true,
      posted: true,
      testPostAt: clock.toISOString(),
      testPostError: null,
    });
    expect(discord.webhookPosts).toHaveLength(1);

    expect((await post(MEMBER, discord)).status).toBe(403);
    expect(discord.webhookPosts).toHaveLength(1);
  });

  it('reads the status without the webhook, for the operator too', async () => {
    store.configs.set(GROUP_A, {
      webhookUrl: WEBHOOK_URL,
      guildId: WEBHOOK.guild,
      channelId: WEBHOOK.channel,
      testPostAt: '2026-10-03T19:00:00.000Z',
      testPostError: null,
    });
    const route = adminDiscordRoute({
      getClient: () => ({}) as ServiceClient,
      store: () => store,
      authorize: async (_r, _c, groupId): Promise<AdminReadResult> => ({
        ok: true,
        reader: {
          kind: 'operator',
          groupId: groupId ?? '',
          userId: 'op',
          readOnly: true,
          admin: null,
          email: null,
        },
      }),
    });
    const response = await route(new Request(`http://localhost/api/admin/discord?groupId=${GROUP_A}`));
    const body = await response.json();
    expect(adminDiscordResponseSchema.parse(body)).toEqual({
      ok: true,
      connected: true,
      guildId: WEBHOOK.guild,
      channelId: WEBHOOK.channel,
      testPostAt: '2026-10-03T19:00:00.000Z',
      testPostError: null,
    });
    expect(JSON.stringify(body)).not.toContain(WEBHOOK.token);
  });
});

describe('nothing in the code stores a Discord user token (acceptance 3, grep)', () => {
  it('no migration has a column for one, and the store and callback never name one', () => {
    const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
    const migrations = join(root, 'packages/db/supabase/migrations');
    for (const name of readdirSync(migrations)) {
      const sql = readFileSync(join(migrations, name), 'utf8');
      expect([name, /\b(access|refresh)_token\b/i.test(sql)]).toEqual([name, false]);
    }
    // The only place the token fields are named is the zod schema that parses and drops them.
    for (const file of [
      'apps/web/lib/discord/connect.ts',
      'apps/web/app/api/admin/discord/callback/handler.ts',
    ]) {
      expect([file, /(access|refresh)_token/.test(readFileSync(join(root, file), 'utf8'))]).toEqual([
        file,
        false,
      ]);
    }
  });
});
