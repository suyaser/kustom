import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_GROUP_REQUIRED,
  type AdminPlayerRecord,
  authorizeAdmin,
  discordIdFromUser,
  discordNameFromUser,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
} from './adminAuth';
import type { GroupRoleLookup } from './groups/membership';

/**
 * The gate, with both lookups injected: no database, no OAuth. These are the four answers
 * `/admin` and `/api/admin/*` can ever give.
 */

const ADMIN_SNOWFLAKE = '204255221925378048';

function user(overrides: Partial<SessionUserLike> = {}): SessionUserLike {
  return {
    id: 'e3b0c442-0000-4000-8000-000000000001',
    email: 'admin@example.com',
    identities: [{ id: ADMIN_SNOWFLAKE, provider: 'discord', identity_data: { full_name: 'hana' } }],
    ...overrides,
  };
}

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';

function player(overrides: Partial<AdminPlayerRecord> = {}): AdminPlayerRecord {
  return {
    playerId: '11111111-1111-4111-8111-111111111111',
    puuid: 'puuid-hana',
    displayName: 'Hana',
    ...overrides,
  };
}

/** Hana is an admin of A and only a member of B; she is in no other group. */
const roles: GroupRoleLookup = async (_playerId, groupId) =>
  groupId === GROUP_A ? 'admin' : groupId === GROUP_B ? 'member' : null;

describe('authorizeAdmin', () => {
  it('is 401 when there is no session', async () => {
    const lookup = vi.fn(async () => player());
    const result = await authorizeAdmin({
      resolveSessionUser: async () => null,
      lookupPlayerByDiscordId: lookup,
      lookupGroupRole: roles,
      groupId: GROUP_A,
    });

    expect(result).toEqual({ ok: false, status: 401, error: 'sign in required' });
    // The player table is never touched for a request that has no session at all.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is 401, not 400, for an anonymous request that names no group', async () => {
    const result = await authorizeAdmin({
      resolveSessionUser: async () => null,
      lookupPlayerByDiscordId: async () => player(),
      lookupGroupRole: roles,
      groupId: null,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('is 403 when the session has no Discord identity', async () => {
    const result = await authorizeAdmin({
      resolveSessionUser: async () => user({ identities: [{ id: 'x', provider: 'email' }] }),
      lookupPlayerByDiscordId: async () => player(),
      lookupGroupRole: roles,
      groupId: GROUP_A,
    });

    expect(result).toEqual({ ok: false, status: 403, error: 'this session has no Discord identity' });
  });

  it('is 403 when no player is linked to that Discord id', async () => {
    const result = await authorizeAdmin({
      resolveSessionUser: async () => user(),
      lookupPlayerByDiscordId: async () => null,
      lookupGroupRole: roles,
      groupId: GROUP_A,
    });

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'no player is linked to this Discord account',
    });
  });

  it('is 400 for a signed-in admin whose request names no group, or not a uuid', async () => {
    for (const groupId of [null, 'customs']) {
      const result = await authorizeAdmin({
        resolveSessionUser: async () => user(),
        lookupPlayerByDiscordId: async () => player(),
        lookupGroupRole: roles,
        groupId,
      });
      expect(result).toEqual({ ok: false, status: 400, error: ADMIN_GROUP_REQUIRED });
    }
  });

  it('is 403 in a group where the player is only a member, and in one they are not in', async () => {
    for (const groupId of [GROUP_B, '00000000-0000-4000-8000-00000000000c']) {
      const result = await authorizeAdmin({
        resolveSessionUser: async () => user(),
        lookupPlayerByDiscordId: async () => player(),
        lookupGroupRole: roles,
        groupId,
      });
      expect(result).toEqual({ ok: false, status: 403, error: NOT_A_GROUP_ADMIN });
    }
  });

  it('looks the player up by the snowflake on the identity, and returns them', async () => {
    const lookup = vi.fn(async () => player());
    const roleLookup = vi.fn(roles);
    const result = await authorizeAdmin({
      resolveSessionUser: async () => user(),
      lookupPlayerByDiscordId: lookup,
      lookupGroupRole: roleLookup,
      groupId: GROUP_A,
    });

    expect(lookup).toHaveBeenCalledWith(ADMIN_SNOWFLAKE);
    // The role is read for the session's player in the request's group, never anything else.
    expect(roleLookup).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', GROUP_A);
    expect(result).toEqual({
      ok: true,
      admin: {
        userId: 'e3b0c442-0000-4000-8000-000000000001',
        discordId: ADMIN_SNOWFLAKE,
        playerId: '11111111-1111-4111-8111-111111111111',
        groupId: GROUP_A,
        puuid: 'puuid-hana',
        displayName: 'Hana',
        email: 'admin@example.com',
        discordName: 'hana',
      },
    });
  });
});

describe('discordIdFromUser', () => {
  it('reads the snowflake off the discord identity', () => {
    expect(discordIdFromUser(user())).toBe(ADMIN_SNOWFLAKE);
  });

  it('ignores identities from other providers', () => {
    const mixed = user({
      identities: [
        { id: 'someone@example.com', provider: 'email' },
        { id: ADMIN_SNOWFLAKE, provider: 'discord' },
      ],
    });
    expect(discordIdFromUser(mixed)).toBe(ADMIN_SNOWFLAKE);
  });

  it('falls back to identity_data when the identity id is empty', () => {
    const legacy = user({
      identities: [{ id: '', provider: 'discord', identity_data: { provider_id: '42', sub: '42' } }],
    });
    expect(discordIdFromUser(legacy)).toBe('42');
  });

  it('never trusts user_metadata, which the user can write themselves', () => {
    // auth.updateUser({ data }) writes user_metadata. If the gate read it, any Discord account
    // could claim an admin's snowflake and take over /admin.
    const impostor: SessionUserLike = {
      id: 'e3b0c442-0000-4000-8000-000000000002',
      identities: [{ id: '999', provider: 'discord' }],
      user_metadata: { provider_id: ADMIN_SNOWFLAKE, sub: ADMIN_SNOWFLAKE },
    };

    expect(discordIdFromUser(impostor)).toBe('999');
  });

  it('is null when there are no identities at all', () => {
    expect(discordIdFromUser({ id: 'u', identities: [] })).toBeNull();
    expect(discordIdFromUser({ id: 'u' })).toBeNull();
  });
});

describe('discordNameFromUser', () => {
  it('is display data only, and may come from metadata', () => {
    expect(discordNameFromUser(user())).toBe('hana');
    expect(discordNameFromUser({ id: 'u', user_metadata: { user_name: 'omar' } })).toBe('omar');
    expect(discordNameFromUser({ id: 'u' })).toBeNull();
  });
});
