import { describe, expect, it, vi } from 'vitest';
import {
  authenticateCompanion,
  type CompanionTokenRecord,
  hashCompanionToken,
  isLastSeenStale,
  LAST_SEEN_THROTTLE_MS,
  mintCompanionToken,
  NOT_A_MEMBER_ERROR,
  readBearerToken,
} from './companionAuth';

/**
 * The auth decision, with the database faked out. Everything here is about the rule
 * "the token decides who the caller is", so none of it needs a lobby or a game.
 */

const NOW = new Date('2026-09-08T21:00:00.000Z');

function record(overrides: Partial<CompanionTokenRecord> = {}): CompanionTokenRecord {
  return {
    tokenId: 'token-1',
    playerId: 'player-1',
    puuid: 'puuid-1',
    groupId: 'group-1',
    isMember: true,
    revokedAt: null,
    lastSeenAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('hashCompanionToken', () => {
  it('is SHA-256 hex, so a token dump is not a set of credentials', () => {
    expect(hashCompanionToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('is stable and collision-free for different tokens', () => {
    expect(hashCompanionToken('a')).toBe(hashCompanionToken('a'));
    expect(hashCompanionToken('a')).not.toBe(hashCompanionToken('b'));
  });
});

describe('mintCompanionToken', () => {
  it('returns a fresh token and its hash', () => {
    const first = mintCompanionToken();
    const second = mintCompanionToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashCompanionToken(first.token));
    // 32 bytes, base64url: 43 characters and nothing that needs escaping in a header.
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('readBearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Bearer   abc', 'abc'],
    ['  Bearer abc  ', 'abc'],
  ])('reads %j', (header, expected) => {
    expect(readBearerToken(header)).toBe(expected);
  });

  it.each([null, undefined, '', 'abc', 'Basic abc', 'Bearer', 'Bearer ', 'Bearer a b'])(
    'refuses %j',
    (header) => {
      expect(readBearerToken(header)).toBeNull();
    },
  );
});

describe('authenticateCompanion', () => {
  it('rejects a request with no Authorization header', async () => {
    const lookup = vi.fn();

    const result = await authenticateCompanion({ authorization: null, lookup });

    expect(result).toEqual({ ok: false, status: 401, error: 'missing bearer token' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a token that is not in the table', async () => {
    const result = await authenticateCompanion({
      authorization: 'Bearer nope',
      lookup: async () => null,
    });

    expect(result).toEqual({ ok: false, status: 401, error: 'unknown companion token' });
  });

  it('looks the token up by its hash, never by the raw value', async () => {
    const lookup = vi.fn(async () => record());

    await authenticateCompanion({ authorization: 'Bearer secret', lookup });

    expect(lookup).toHaveBeenCalledWith(hashCompanionToken('secret'));
    expect(lookup).not.toHaveBeenCalledWith('secret');
  });

  it('rejects a revoked token', async () => {
    const result = await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ revokedAt: '2026-09-01T00:00:00.000Z' }),
    });

    expect(result).toEqual({ ok: false, status: 401, error: 'companion token has been revoked' });
  });

  it("resolves the owning player and the token's group from the token", async () => {
    const result = await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ playerId: 'player-9', puuid: 'puuid-9', groupId: 'group-b' }),
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      identity: { tokenId: 'token-1', playerId: 'player-9', puuid: 'puuid-9', groupId: 'group-b' },
    });
  });

  // M13.3: a token is only good while its player is a member of its group.
  it('refuses a token whose player is no longer a member of its group, with 403', async () => {
    const touch = vi.fn(async () => undefined);
    const result = await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ isMember: false, lastSeenAt: null }),
      touch,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, status: 403, error: NOT_A_MEMBER_ERROR });
    // A token that may not post must not look like a live host to start-a-lobby.
    expect(touch).not.toHaveBeenCalled();
  });

  it('still calls a revoked non-member token revoked (401), not 403', async () => {
    const result = await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ isMember: false, revokedAt: '2026-09-01T00:00:00.000Z' }),
    });

    expect(result).toEqual({ ok: false, status: 401, error: 'companion token has been revoked' });
  });

  it('does not write last_seen_at when it is fresh', async () => {
    const touch = vi.fn(async () => undefined);

    await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ lastSeenAt: new Date(NOW.getTime() - 1_000).toISOString() }),
      touch,
      now: NOW,
    });

    expect(touch).not.toHaveBeenCalled();
  });

  it('writes last_seen_at once it is stale', async () => {
    const touch = vi.fn(async () => undefined);

    await authenticateCompanion({
      authorization: 'Bearer secret',
      lookup: async () => record({ lastSeenAt: null }),
      touch,
      now: NOW,
    });

    expect(touch).toHaveBeenCalledWith('token-1');
  });
});

describe('isLastSeenStale', () => {
  it('treats never-seen and unparseable timestamps as stale', () => {
    expect(isLastSeenStale(null, NOW)).toBe(true);
    expect(isLastSeenStale('not a date', NOW)).toBe(true);
  });

  it('is stale exactly at the throttle window', () => {
    const justInside = new Date(NOW.getTime() - LAST_SEEN_THROTTLE_MS + 1).toISOString();
    const atWindow = new Date(NOW.getTime() - LAST_SEEN_THROTTLE_MS).toISOString();

    expect(isLastSeenStale(justInside, NOW)).toBe(false);
    expect(isLastSeenStale(atWindow, NOW)).toBe(true);
  });
});
