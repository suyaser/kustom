import { describe, expect, it } from 'vitest';
import type { SessionUserLike } from '../adminAuth';
import { authorizeMe, type MePlayer } from './identity';

/**
 * The third route class's gate (M3.6): a Supabase session, its Discord identity, and the
 * player row that identity is linked to — **or no player row at all**, which is not a failure
 * here and is the whole reason this is not `authorizeAdmin`.
 */

const PLAYER: MePlayer = { playerId: 'player-1', puuid: 'puuid-1' };

function user(overrides: Partial<SessionUserLike> = {}): SessionUserLike {
  return {
    id: 'user-1',
    identities: [{ id: 'snowflake-1', provider: 'discord' }],
    ...overrides,
  };
}

describe('authorizeMe', () => {
  it('resolves the session to the player linked to its Discord id', async () => {
    const result = await authorizeMe({
      resolveSessionUser: async () => user(),
      lookupPlayerByDiscordId: async (discordId) => (discordId === 'snowflake-1' ? PLAYER : null),
    });

    expect(result).toEqual({
      ok: true,
      me: { userId: 'user-1', discordId: 'snowflake-1', player: PLAYER },
    });
  });

  it('lets a signed-in visitor with no player row through, with player null', async () => {
    // This is the `That's me` case, and it is the ordinary first visit for everybody: the
    // gate must not 403 it the way the admin gate does.
    const result = await authorizeMe({
      resolveSessionUser: async () => user(),
      lookupPlayerByDiscordId: async () => null,
    });

    expect(result).toMatchObject({ ok: true, me: { player: null } });
  });

  it('is 401 with no session', async () => {
    const result = await authorizeMe({
      resolveSessionUser: async () => null,
      lookupPlayerByDiscordId: async () => PLAYER,
    });

    expect(result).toEqual({ ok: false, status: 401, error: 'sign in required' });
  });

  it('is 403 for a session with no Discord identity, and never reads a player', async () => {
    let asked = 0;
    const result = await authorizeMe({
      resolveSessionUser: async () => user({ identities: [] }),
      lookupPlayerByDiscordId: async () => {
        asked += 1;
        return PLAYER;
      },
    });

    expect(result).toEqual({ ok: false, status: 403, error: 'this session has no Discord identity' });
    expect(asked).toBe(0);
  });

  it('reads the snowflake from the identity, never from user_metadata', async () => {
    // `user_metadata` is writable by the signed-in user (`lib/adminAuth.ts`), so a session
    // that claims somebody else's snowflake there must not be linked to their player.
    const result = await authorizeMe({
      resolveSessionUser: async () =>
        user({ identities: [{ id: 'real', provider: 'discord' }], user_metadata: { provider_id: 'faked' } }),
      lookupPlayerByDiscordId: async (discordId) => (discordId === 'real' ? PLAYER : null),
    });

    expect(result).toMatchObject({ ok: true, me: { discordId: 'real', player: PLAYER } });
  });
});
