import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SessionUserLike } from '../adminAuth';
import type { ServiceClient } from '../supabase';
import { NOT_IN_THIS_GROUP } from './copy';
import {
  type MemberOfGroup,
  READ_BAD_QUERY,
  READ_NO_DISCORD,
  READ_NOT_LINKED,
  READ_SIGN_IN_REQUIRED,
  withMemberRead,
} from './readRoute';

/**
 * `withMemberRead` (M19.16) with every I/O step injected: the refusals in their order, and the
 * one-wave rule -- the route's read starts before the membership lookup answers, and its answer
 * is dropped for anyone the lookup refuses.
 */

const GROUP = '11111111-1111-4111-8111-111111111111';
const fakeClient = {} as ServiceClient;

const querySchema = z.object({ groupId: z.guid() });
const responseSchema = z.object({ value: z.number() });

const discordUser: SessionUserLike = {
  id: 'u1',
  identities: [{ id: '12345', provider: 'discord', identity_data: {} }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function route(options: {
  user?: SessionUserLike | null;
  member?: MemberOfGroup | null;
  read?: () => Promise<{ value: number }>;
}) {
  const read = vi.fn(options.read ?? (async () => ({ value: 7 })));
  const lookup = vi.fn(async () => (options.member === undefined ? memberRow('member') : options.member));
  const handler = withMemberRead(querySchema, responseSchema, read, {
    getClient: () => fakeClient,
    resolveSessionUser: async () => (options.user === undefined ? discordUser : options.user),
    lookupMember: () => lookup,
  });
  return { handler, read, lookup };
}

function memberRow(role: MemberOfGroup['role']): MemberOfGroup {
  return { player: { playerId: 'p1', puuid: 'puuid-1' }, role };
}

const get = (query: string) => new Request(`http://localhost/api/me/x/status${query}`);

describe('withMemberRead', () => {
  it('answers a member with the read, uncached', async () => {
    const { handler, lookup } = route({});
    const response = await handler(get(`?groupId=${GROUP}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ value: 7 });
    expect(lookup).toHaveBeenCalledWith('12345', GROUP);
  });

  it('answers an admin like any member', async () => {
    const { handler } = route({ member: memberRow('admin') });
    expect((await handler(get(`?groupId=${GROUP}`))).status).toBe(200);
  });

  it('401 signed out, before the query is parsed or anything is read', async () => {
    const { handler, read, lookup } = route({ user: null });
    const response = await handler(get('?groupId=not-a-uuid'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: READ_SIGN_IN_REQUIRED });
    expect(read).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('403 for a session with no Discord identity', async () => {
    const { handler, read } = route({ user: { id: 'u2', identities: [] } });
    const response = await handler(get(`?groupId=${GROUP}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: READ_NO_DISCORD });
    expect(read).not.toHaveBeenCalled();
  });

  it('403 for an unlinked session and for a non-member, never the read', async () => {
    const unlinked = route({ member: null });
    const a = await unlinked.handler(get(`?groupId=${GROUP}`));
    expect(a.status).toBe(403);
    expect(await a.json()).toEqual({ ok: false, error: READ_NOT_LINKED });

    const outsider = route({ member: memberRow(null) });
    const b = await outsider.handler(get(`?groupId=${GROUP}`));
    expect(b.status).toBe(403);
    expect(await b.json()).toEqual({ ok: false, error: NOT_IN_THIS_GROUP });
  });

  it('a refused read that also failed is still the 403, not a 500 or an unhandled rejection', async () => {
    const { handler } = route({
      member: memberRow(null),
      read: async () => Promise.reject(new Error('boom')),
    });
    expect((await handler(get(`?groupId=${GROUP}`))).status).toBe(403);
  });

  it('400 for a missing or malformed groupId, without reading', async () => {
    const { handler, read } = route({});
    for (const query of ['', '?groupId=nope', '?gid=1']) {
      const response = await handler(get(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: READ_BAD_QUERY });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('one wave: the read starts before the membership lookup answers', async () => {
    const membership = deferred<MemberOfGroup | null>();
    const read = vi.fn(async () => ({ value: 1 }));
    const handler = withMemberRead(querySchema, responseSchema, read, {
      getClient: () => fakeClient,
      resolveSessionUser: async () => discordUser,
      lookupMember: () => () => membership.promise,
    });
    const pending = handler(get(`?groupId=${GROUP}`));
    // Let the session step and the dispatch run; the lookup is still unanswered.
    await new Promise((r) => setTimeout(r, 0));
    expect(read).toHaveBeenCalledTimes(1);
    membership.resolve(memberRow('member'));
    expect((await pending).status).toBe(200);
  });

  it('500 without leaking when the read fails for a member', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler } = route({ read: async () => Promise.reject(new Error('db down: secret')) });
    const response = await handler(get(`?groupId=${GROUP}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'internal error' });
    error.mockRestore();
  });

  it('500 when the read drifts from its response schema', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler } = route({ read: async () => ({ value: 'seven' }) as unknown as { value: number } });
    expect((await handler(get(`?groupId=${GROUP}`))).status).toBe(500);
    error.mockRestore();
  });
});
