import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AdminAuthResult } from './adminAuth';
import { withAdminAuth } from './adminRoute';
import type { ServiceClient } from './supabase';

/**
 * The wrapper, with both the client and the session step injected. What matters here is the
 * order: auth first, body second, so an anonymous caller never learns the payload shape.
 */

const schema = z.object({ name: z.string().min(1) });

// Never used: every test here stops before the handler touches it.
const client = {} as unknown as ServiceClient;

const GROUP = '00000000-0000-4000-8000-00000000000a';

/** The `groupId` each call's session step was handed, so a test can see what the gate checked. */
let seenGroupIds: (string | null)[] = [];

function route(auth: AdminAuthResult, redirectTo = '/admin/players') {
  return withAdminAuth(
    schema,
    async (input, context) =>
      context.respond(
        z.object({ ok: z.literal(true), name: z.string(), groupId: z.string() }),
        {
          ok: true,
          name: input.name,
          groupId: context.groupId,
        },
        'saved',
      ),
    {
      getClient: () => client,
      authorize: async (_request, _client, groupId) => {
        seenGroupIds.push(groupId);
        return auth;
      },
      redirectTo,
    },
  );
}

const admin = {
  ok: true as const,
  admin: {
    userId: 'user-1',
    discordId: '1',
    playerId: '11111111-1111-4111-8111-111111111111',
    groupId: GROUP,
    puuid: 'puuid-1',
    displayName: 'Hana',
    email: null,
    discordName: null,
  },
};

function jsonPost(body: unknown): Request {
  return new Request('http://localhost/api/admin/players', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formPost(fields: Record<string, string>): Request {
  return new Request('http://localhost/api/admin/players', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('withAdminAuth', () => {
  it('answers 401 with the envelope when there is no session', async () => {
    const response = await route({ ok: false, status: 401, error: 'sign in required' })(
      jsonPost({ name: 'ok' }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'sign in required' });
  });

  it('answers 403 for a session that is not an admin', async () => {
    const response = await route({ ok: false, status: 403, error: 'not an admin of this group' })(
      jsonPost({ groupId: GROUP, name: 'ok' }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'not an admin of this group' });
  });

  it('rejects a form post from an anonymous caller with 401, not a redirect', async () => {
    // A redirect would make "is this route protected?" depend on the content type.
    const response = await route({ ok: false, status: 401, error: 'sign in required' })(
      formPost({ name: 'ok' }),
    );

    expect(response.status).toBe(401);
  });

  it('does not parse the body before it has authenticated', async () => {
    const response = await route({ ok: false, status: 401, error: 'sign in required' })(
      jsonPost({ nothing: 'like the schema' }),
    );

    expect(response.status).toBe(401);
  });

  it('returns the envelope for a valid JSON post', async () => {
    const response = await route(admin)(jsonPost({ groupId: GROUP, name: 'ok' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, name: 'ok', groupId: GROUP });
  });

  it("hands the session step the body's groupId, from JSON and from a form alike (M13.4)", async () => {
    seenGroupIds = [];
    await route(admin)(jsonPost({ groupId: GROUP, name: 'ok' }));
    await route(admin)(formPost({ groupId: GROUP, name: 'ok' }));
    await route(admin)(jsonPost({ name: 'ok' }));
    expect(seenGroupIds).toEqual([GROUP, GROUP, null]);
  });

  it('answers 400 with the envelope when a signed-in caller names no group', async () => {
    const response = await route({ ok: false, status: 400, error: 'groupId is required' })(
      jsonPost({ name: 'ok' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'groupId is required' });
  });

  it('says the body is unreadable, not that the group is missing, for broken JSON', async () => {
    const response = await route({ ok: false, status: 400, error: 'groupId is required' })(
      new Request('http://localhost/api/admin/players', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'request body is not valid JSON' });
  });

  it('303s a form post back to its page with the notice', async () => {
    const response = await route(admin)(formPost({ groupId: GROUP, name: 'ok' }));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/admin/players');
    expect(location.searchParams.get('notice')).toBe('saved');
  });

  it('400s an invalid JSON body with the zod issues', async () => {
    const response = await route(admin)(jsonPost({ groupId: GROUP, name: '' }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: false; issues?: { path: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues?.[0]?.path).toBe('name');
  });

  it('303s an invalid form body back to the page with an error', async () => {
    const response = await route(admin)(formPost({ groupId: GROUP, name: '' }));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('that form was not valid');
  });
});
