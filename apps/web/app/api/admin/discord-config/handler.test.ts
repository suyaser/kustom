import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import type { AdminContext } from '@/lib/adminRoute';
import { WEBHOOK_NOT_RECOGNISED } from '@/lib/discord/webhookInfo';
import type { ServiceClient } from '@/lib/supabase';
import { discordConfigHandler } from './handler';
import { discordConfigRequestSchema } from './schema';

/**
 * M14.26: the webhook link is parsed and rebuilt from its id and token on every path, including an
 * explicit `guildId`, which makes no Discord lookup. No stack needed: a refusal returns before the
 * database, and the save goes to a one-table fake that records what would be stored.
 */

const ID = '523456789012345678';
const TOKEN = 'PastedToken_abcdefghijklmnopqrstuvwxyz-0123';
const CANONICAL = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;
const GROUP = '00000000-0000-4000-8000-000000000001';

function fakeClient() {
  const upserts: Record<string, unknown>[] = [];
  let stored: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row);
        stored = { webhook_url: null, updated_at: '2026-10-03T00:00:00.000Z', ...stored, ...row };
        return { error: null };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }),
      }),
    }),
  };
  return { client: client as unknown as ServiceClient, upserts };
}

function context(client: ServiceClient): AdminContext {
  return {
    client,
    admin: {} as AdminContext['admin'],
    groupId: GROUP,
    request: new Request('http://localhost/api/admin/discord-config', { method: 'POST' }),
    form: false,
    redirectTo: '/admin/discord',
    respond: (schema, value) => NextResponse.json(schema.parse(value)),
    fail: (status, error) => NextResponse.json({ ok: false, error }, { status }),
  };
}

async function save(webhookUrl: string) {
  const { client, upserts } = fakeClient();
  const fetched: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response(null, { status: 500 });
  }) as typeof fetch;
  const input = discordConfigRequestSchema.parse({
    groupId: GROUP,
    guildId: '623456789012345678',
    webhookUrl,
    resultsChannelId: '',
    lobbyVoiceChannelId: '',
    blueVoiceChannelId: '',
    redVoiceChannelId: '',
  });
  const response = await discordConfigHandler({ fetchImpl })(input, context(client));
  return { response, upserts, fetched };
}

describe('POST /api/admin/discord-config with an explicit guildId (M14.26)', () => {
  it.each([
    ['path traversal', `https://discord.com/api/webhooks/${ID}/${TOKEN}/../../../users/@me`],
    ['trailing junk', `https://discord.com/api/webhooks/${ID}/${TOKEN}/extra`],
    ['an id that is not a snowflake', `https://discord.com/api/webhooks/../${TOKEN}`],
    ['a fragment', `https://discord.com/api/webhooks/${ID}/${TOKEN}#x`],
  ])('refuses %s with the 400 and stores nothing', async (_label, link) => {
    const { response, upserts, fetched } = await save(link);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: false, error: WEBHOOK_NOT_RECOGNISED });
    // The token never comes back in a refusal.
    expect(body).not.toContain(TOKEN);
    expect(upserts).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it.each([
    ['a query string', `${CANONICAL}?wait=true&thread_id=1`],
    ['the discordapp.com host', `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`],
    ['a trailing slash and whitespace', `  ${CANONICAL}/  `],
    ['the canonical link itself', CANONICAL],
  ])('stores %s rebuilt from its id and token, with no Discord call', async (_label, link) => {
    const { response, upserts, fetched } = await save(link);

    expect(response.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.webhook_url).toBe(CANONICAL);
    expect(fetched).toEqual([]);
    const body = await response.text();
    expect(body).not.toContain(TOKEN);
  });
});
