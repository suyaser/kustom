import { describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { ServiceClient } from '@/lib/supabase';
import { discordConfigRoute } from './discord-config/handler';
import { inviteRotateRoute } from './invite/rotate/handler';
import { memberRoleRoute } from './members/role/handler';
import { ratingsResetRoute } from './ratings/reset/handler';
import { adminTokensRoute, MINT_GONE } from './tokens/handler';

/**
 * M14.40: a browser form post to an admin route goes back to **the checked group's** admin page,
 * `/g/<slug>/admin[/<section>]`, never a 1.0 `/admin/*` path (which 308s to the original group's).
 * One route of each kind: the admin home, Members, Discord, Hosts. The redirect is computed before
 * the body is validated, so an invalid form shows where each route sends people without a database.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const admin: AdminAuthResult = {
  ok: true,
  admin: {
    userId: 'e3b0c442-0000-4000-8000-000000000001',
    discordId: '1',
    playerId: '11111111-1111-4111-8111-111111111111',
    groupId: GROUP,
    puuid: 'p',
    displayName: 'Hana',
    email: null,
    discordName: null,
  },
};

/** A client that answers only the slug lookup, and records every table and function touched. */
function fakeClient(): { client: ServiceClient; seen: string[] } {
  const seen: string[] = [];
  const fake = {
    from(table: string) {
      seen.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === 'groups'
                ? { data: { id: GROUP, slug: 'tuesday-crew', name: 'Tuesday' }, error: null }
                : { data: null, error: { message: `unexpected read of ${table}` } },
          }),
        }),
      };
    },
    rpc(name: string) {
      seen.push(`rpc:${name}`);
      return Promise.resolve(
        name === 'rotate_group_invite'
          ? { data: 'AbCdEfGhIjKlMnOpQrStUv', error: null }
          : { data: null, error: { message: `unexpected rpc ${name}` } },
      );
    },
  };
  return { client: fake as unknown as ServiceClient, seen };
}

function form(fields: Record<string, string>): Request {
  return new Request('http://localhost/api/admin/x', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function where(response: Response): URL {
  expect(response.status).toBe(303);
  return new URL(response.headers.get('location') ?? '');
}

describe('admin form posts go back to the checked group (M14.40)', () => {
  const opts = (client: ServiceClient) => ({ getClient: () => client, authorize: async () => admin });

  it('the admin home: ratings reset', async () => {
    const { client } = fakeClient();
    const location = where(await ratingsResetRoute(opts(client))(form({ groupId: GROUP })));
    expect(location.pathname).toBe('/g/tuesday-crew/admin');
    expect(location.searchParams.get('error')).toBe('that form was not valid');
  });

  it('the admin home: the invite rotate (setup gate)', async () => {
    const { client } = fakeClient();
    const location = where(await inviteRotateRoute(opts(client))(form({ groupId: GROUP })));
    expect(location.pathname).toBe('/g/tuesday-crew/admin');
    expect(location.searchParams.get('notice')).toBeTruthy();
  });

  it('Members: a member role change', async () => {
    const { client } = fakeClient();
    const location = where(await memberRoleRoute(opts(client))(form({ groupId: GROUP })));
    expect(location.pathname).toBe('/g/tuesday-crew/admin/members');
  });

  it('Discord: discord-config', async () => {
    const { client } = fakeClient();
    const location = where(
      await discordConfigRoute(opts(client))(form({ groupId: GROUP, resultsChannelId: 'not a snowflake' })),
    );
    expect(location.pathname).toBe('/g/tuesday-crew/admin/discord');
  });

  it('Hosts: tokens', async () => {
    const { client } = fakeClient();
    const location = where(await adminTokensRoute(opts(client))(form({ groupId: GROUP })));
    expect(location.pathname).toBe('/g/tuesday-crew/admin/hosts');
  });

  it('a form post asking to mint gets the code sentence and nothing is minted (M17.12)', async () => {
    const { client, seen } = fakeClient();
    const location = where(
      await adminTokensRoute(opts(client))(
        form({ action: 'mint', groupId: GROUP, playerId: '22222222-2222-4222-8222-222222222222', label: '' }),
      ),
    );
    expect(location.pathname).toBe('/g/tuesday-crew/admin/hosts');
    expect(location.searchParams.get('error')).toBe(MINT_GONE);
    // Only the slug lookup: no membership read, no token insert.
    expect(seen).toEqual(['groups']);
  });
});
