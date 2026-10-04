import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import type { MeAuthResult } from '@/lib/me/identity';
import { eogBody, lobbyBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { expectBumpedLast, installWriteRecorder, type RecordedWrite } from '@/lib/testing/writeRecorder';

/**
 * M19.9 review: a route whose write has landed must bump even when a later step throws (the
 * Discord post, the balance after Roll's claim, the membership insert after the member rows, the
 * fan-out after an ack). The retry is a no-op (`already_rolled`, `promoted: false`, a frozen or
 * unchanged roster) and would never bump, so a missed bump here is a page that never updates.
 *
 * Each case flips one switch that makes the step after the write throw, through the real handler
 * on the local stack, and asserts the request answered 500 and still made exactly its one bump,
 * last. The fake-only shapes (role tap, self link, mode card, idle sweep, rebuild cron) are in
 * `errorPaths.test.ts`. Skipped without the stack.
 *
 * fix-start-pending adds the other half: a write that landed and whose answer was then lost (no
 * mock, the request really reaches the stack). The `in_progress` move and the lobby rename used to
 * miss their bump there, and the companion's retry is a no-op that never bumps either.
 */

const fail = vi.hoisted(() => ({
  post: false,
  balance: false,
  memberships: false,
  enqueue: false,
  ack: false,
}));

vi.mock('@/lib/discord/post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/discord/post')>();
  return {
    ...actual,
    postTeamsForSplit: async (...args: Parameters<typeof actual.postTeamsForSplit>) => {
      if (fail.post) throw new Error('discord is down');
      return actual.postTeamsForSplit(...args);
    },
    postFearlessReset: async (...args: Parameters<typeof actual.postFearlessReset>) => {
      if (fail.post) throw new Error('discord is down');
      return actual.postFearlessReset(...args);
    },
  };
});

vi.mock('@/lib/ingest/balance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/balance')>();
  return {
    ...actual,
    balanceLobby: async (...args: Parameters<typeof actual.balanceLobby>) => {
      if (fail.balance) throw new Error('the balance crashed after the claim');
      return actual.balanceLobby(...args);
    },
  };
});

vi.mock('@/lib/ingest/memberships', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ingest/memberships')>();
  return {
    ...actual,
    ensureMemberships: async (...args: Parameters<typeof actual.ensureMemberships>) => {
      if (fail.memberships) throw new Error('membership insert failed');
      return actual.ensureMemberships(...args);
    },
  };
});

vi.mock('@/lib/commands/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commands/queue')>();
  return {
    ...actual,
    enqueueCommands: async (...args: Parameters<typeof actual.enqueueCommands>) => {
      const queued = await actual.enqueueCommands(...args);
      if (fail.enqueue) throw new Error('the answer was lost after the insert');
      return queued;
    },
    ackCommand: async (...args: Parameters<typeof actual.ackCommand>) => {
      const settled = await actual.ackCommand(...args);
      if (fail.ack) throw new Error('the fan-out crashed after the ack');
      return settled;
    },
  };
});

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the live signal on error paths (M19.9)', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  /**
   * fix-start-pending: a write whose **answer** is lost after the database applied it (a dropped
   * connection, a 5xx on the way back). Armed with a predicate, the next matching request goes
   * through to the stack for real and then fails as `fetch failed`, once.
   */
  const realFetch = globalThis.fetch;
  const lose: { match: ((method: string, url: string, body: string) => boolean) | null } = { match: null };
  const lossyFetch: typeof fetch = async (input, init) => {
    const response = await realFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : '';
    if (lose.match?.(method, url, body)) {
      lose.match = null;
      throw new TypeError('fetch failed');
    }
    return response;
  };

  // Before any client exists: supabase-js takes `fetch` when a client is built.
  const recorder = installWriteRecorder(stack.url, lossyFetch);

  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { ackRoute } = await import('@/app/api/companion/commands/[id]/settle');
  const { rollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/roll/handler');
  const { rerollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/reroll/handler');
  const { fearlessResetRoute } = await import('@/app/api/admin/fearless/reset/handler');
  const { startLobbyRoute } = await import('@/app/api/me/lobbies/start/handler');
  const { lobbyRosterKey } = await import('@/lib/ingest/lobby');
  const { ensurePlayers } = await import('@/lib/ingest/players');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `le-${runId}-p${index}`);
  const ids = new Map<string, string>();
  const id = (puuid: string): string => {
    const value = ids.get(puuid);
    if (value === undefined) throw new Error(`no player for ${puuid}`);
    return value;
  };
  const p = (index: number): string => ten[index] as string;

  let A = '';
  let B = '';
  let token = '';
  let lobbyId = '';
  const partyId = `le-${runId}-party`;
  const gameId = testGameId();

  async function recorded(
    run: () => Promise<Response>,
  ): Promise<{ status: number; writes: RecordedWrite[] }> {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const mark = recorder.mark();
      const response = await run();
      return { status: response.status, writes: recorder.since(mark) };
    } finally {
      errors.mockRestore();
    }
  }

  const companion = (path: string, body: unknown) =>
    new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const json = (path: string, body: unknown) =>
    new Request(`http://localhost/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const asAdmin = (puuid: string) => ({
    authorize: async (_r: Request, _c: unknown, groupId: string | null): Promise<AdminAuthResult> => ({
      ok: true,
      admin: {
        userId: randomUUID(),
        discordId: `9${runId}`,
        playerId: id(puuid),
        groupId: groupId ?? A,
        puuid,
        displayName: null,
        email: null,
        discordName: null,
      },
    }),
  });
  const asMe = (puuid: string) => ({
    authorize: async (): Promise<MeAuthResult> => ({
      ok: true,
      me: { userId: randomUUID(), discordId: `8${runId}`, player: { playerId: id(puuid), puuid } },
    }),
  });

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['a', 'b']);
    A = groups.a;
    B = groups.b;
    const players = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, playerId] of players) ids.set(puuid, playerId);
    for (const puuid of ten) await setTestMembership(db, A, id(puuid), 'member');
    await setTestMembership(db, A, id(p(0)), 'owner');
    await setTestMembership(db, A, id(p(1)), 'admin');
    const minted = mintCompanionToken();
    token = minted.token;
    const inserted = await db.from('companion_tokens').insert({
      group_id: A,
      player_id: id(p(0)),
      token_hash: minted.tokenHash,
      label: 'live error paths',
      last_seen_at: new Date().toISOString(),
    });
    expect(inserted.error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    recorder.restore();
    await deleteTestGroups(db, [A, B]);
    await db.from('players').delete().in('puuid', ten);
  });

  describe('the live signal on error paths (M19.9)', () => {
    it('lobby post: the lobby and member rows land, the membership insert throws: 500, and `lobby` still bumps last', async () => {
      fail.memberships = true;
      try {
        const body = lobbyBody({ partyId, members: ten.map((puuid) => ({ puuid })) });
        const { status, writes } = await recorded(() => postLobby(companion('lobby', body)));
        expect(status).toBe(500);
        const others = expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
        expect(others.map((write) => write.target)).toEqual(
          expect.arrayContaining(['lobbies', 'lobby_members']),
        );
      } finally {
        fail.memberships = false;
      }
      const { data } = await db.from('lobbies').select('id').eq('lcu_party_id', partyId).single();
      lobbyId = data?.id ?? '';
    });

    it('lobby post: the rename lands, its answer is lost: 500, `lobby` still bumps last; the retry bumps nothing', async () => {
      const body = lobbyBody({ partyId, lobbyName: 'renamed', members: ten.map((puuid) => ({ puuid })) });
      lose.match = (method, url, sent) =>
        method === 'PATCH' && url.includes('/rest/v1/lobbies?') && sent.includes('"lobby_name":"renamed"');
      try {
        const { status, writes } = await recorded(() => postLobby(companion('lobby', body)));
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
      } finally {
        lose.match = null;
      }
      const { data } = await db.from('lobbies').select('lobby_name').eq('id', lobbyId).single();
      expect(data?.lobby_name).toBe('renamed');
      const retry = await recorded(() => postLobby(companion('lobby', body)));
      expect(retry.status).toBe(200);
      expectBumpedLast(retry.writes, [], { groups: [A, B] });
    });

    it('roll: the claim and the lock land, the balance throws: 500, and `split` still bumps last', async () => {
      const route = rollRoute(lobbyId, asAdmin(p(1)));
      const body = { groupId: A, rosterKey: lobbyRosterKey(ten) };
      fail.balance = true;
      try {
        const { status, writes } = await recorded(() => route(json(`admin/lobbies/${lobbyId}/roll`, body)));
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'split' }]);
      } finally {
        fail.balance = false;
      }
      // The real roll, for the cases below.
      expect((await route(json(`admin/lobbies/${lobbyId}/roll`, body))).status).toBe(200);
    });

    it('reroll: the promotion lands, the Discord post throws: 500, and `split` still bumps last', async () => {
      const { data } = await db.from('splits').select('id').eq('lobby_id', lobbyId).eq('rank', 2).single();
      fail.post = true;
      try {
        const { status, writes } = await recorded(() =>
          rerollRoute(
            lobbyId,
            asAdmin(p(1)),
          )(json(`admin/lobbies/${lobbyId}/reroll`, { groupId: A, splitId: data?.id })),
        );
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'split' }]);
      } finally {
        fail.post = false;
      }
    });

    it('fearless reset: the reset lands, the Discord post throws: 500, and `mode` still bumps last', async () => {
      fail.post = true;
      try {
        const { status, writes } = await recorded(() =>
          fearlessResetRoute(asAdmin(p(1)))(json('admin/fearless/reset', { groupId: A })),
        );
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'mode' }]);
      } finally {
        fail.post = false;
      }
    });

    it('in_progress: the lobby lands in_game, the answer is lost: 500, `lobby` still bumps last; the retry bumps nothing', async () => {
      const before = await db.from('lobbies').select('status').eq('id', lobbyId).single();
      expect(before.data?.status).toBe('balanced');
      const body = { phase: 'in_progress', gameId, partyId };
      lose.match = (method, url, sent) =>
        method === 'PATCH' && url.includes('/rest/v1/lobbies?') && sent.includes('"status":"in_game"');
      try {
        const { status, writes } = await recorded(() => postGame(companion('game', body)));
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
      } finally {
        lose.match = null;
      }
      const after = await db.from('lobbies').select('status').eq('id', lobbyId).single();
      expect(after.data?.status).toBe('in_game');
      // The companion's retry: the lobby is already `in_game`, so it moves nothing, but the kickoff
      // record (M21.4) the 500 cut short is written now, and that write bumps `lobby` once.
      const retry = await recorded(() => postGame(companion('game', body)));
      expect(retry.status).toBe(200);
      expectBumpedLast(retry.writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
      const record = await db.from('lobbies').select('kickoff_kind').eq('id', lobbyId).single();
      expect(record.data?.kickoff_kind).not.toBeNull();
      // A second retry finds the move and the record done: it writes nothing and bumps nothing.
      const again = await recorded(() => postGame(companion('game', body)));
      expect(again.status).toBe(200);
      expectBumpedLast(again.writes, [], { groups: [A, B] });
    });

    it('eog: the game and its players land, the membership insert throws: 500, and `game` still bumps last', async () => {
      expect((await postGame(companion('game', { phase: 'in_progress', gameId, partyId }))).status).toBe(200);
      const body = eogBody({
        gameId,
        puuids: ten,
        partyId,
        startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      });
      fail.memberships = true;
      try {
        const { status, writes } = await recorded(() => postGame(companion('game', body)));
        expect(status).toBe(500);
        const others = expectBumpedLast(writes, [{ groupId: A, kind: 'game' }], { groups: [A, B] });
        expect(others.map((write) => write.target)).toEqual(
          expect.arrayContaining(['games', 'game_players']),
        );
      } finally {
        fail.memberships = false;
      }
      // The companion's retry finishes the game (rated, lobby finished) and bumps on its own.
      const retry = await recorded(() => postGame(companion('game', body)));
      expect(retry.status).toBe(200);
      expectBumpedLast(retry.writes, [{ groupId: A, kind: 'game' }], { groups: [A, B] });
    });

    it('start a lobby: the command lands, the answer is lost: 500, `lobby` still bumps; the ack lands, the fan-out throws: same', async () => {
      await db.from('companion_tokens').update({ last_seen_at: new Date().toISOString() }).eq('group_id', A);
      fail.enqueue = true;
      try {
        const { status, writes } = await recorded(() =>
          startLobbyRoute({
            ...asMe(p(2)),
            start: { gate: { create_lobby: true, invite: true, switch_side: false } },
          })(json('me/lobbies/start', { groupId: A })),
        );
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }]);
      } finally {
        fail.enqueue = false;
      }

      const { data } = await db
        .from('companion_commands')
        .select('id')
        .eq('group_id', A)
        .eq('kind', 'create_lobby')
        .eq('status', 'pending')
        .single();
      const commandId = data?.id ?? '';
      fail.ack = true;
      try {
        const { status, writes } = await recorded(() =>
          ackRoute(commandId)(
            companion(`commands/${commandId}/ack`, {
              result: { partyId: `le-${runId}-next`, lobbyName: 'next' },
            }),
          ),
        );
        expect(status).toBe(500);
        expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }]);
      } finally {
        fail.ack = false;
      }
    });
  });
}
