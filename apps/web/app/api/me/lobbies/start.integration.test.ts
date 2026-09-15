import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { companionCommandPayloadSchemas } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUserLike } from '@/lib/adminAuth';
import {
  COMMAND_ERRORS,
  type CommandGate,
  clearCommandHooks,
  enqueueCommands,
  fanOutInvites,
  inviteFanOutHook,
  registerCommandHook,
  sweepExpiredCommands,
} from '@/lib/commands';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import {
  LOBBY_ALREADY_OPEN,
  LOBBY_ALREADY_OPENING,
  LOBBY_WRITES_UNVERIFIED,
  NO_COMPANION_AROUND,
} from '@/lib/lobbyStart';
import { START_LOBBY_NOT_LINKED } from '@/lib/me/copy';
import { authorizeMe, type MeAuthResult, supabaseMeLookup } from '@/lib/me/identity';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Start a lobby, against the Supabase CLI local stack (M4.2's rules, M4.13's gate): the real
 * route, the real queue, the real ack route, and the invite fan-out driven by an ack that came
 * back through it.
 *
 * **The gate is M3.6's third class since M4.13**, so the session step below is `authorizeMe`
 * with only the Supabase user faked: `players.discord_id` is still looked up for real, which is
 * what makes "the presser is the session" an assertion about a row rather than about a mock.
 * There is no admin branch to test, because there is none in the handler — the admin here is
 * simply a linked player who happens to carry the flag.
 *
 * **The clock is 2019 on purpose.** Every read the press makes is bounded by `now` at both ends
 * — the night's 06:00 and `now` itself — so a run at a fixed instant six years ago sees exactly
 * the rows this file seeded and none of the shared stack's leftovers, however many other agents
 * are using it. Nothing here sleeps and nothing here can see another run's lobby.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('start a lobby against the local Supabase stack', () => {
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

  const { startLobbyRoute } = await import('./start/handler');
  // The real export, environment and all: this is what answers an anonymous request.
  const { POST: startRouteExport } = await import('./start/route');
  const { POST: ackCommandRoute } = await import('../../companion/commands/[id]/ack/route');
  const { POST: nackCommandRoute } = await import('../../companion/commands/[id]/nack/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** 22:00 Cairo, a Sunday in 2019. The night started at 04:00Z. */
  const NOW = new Date('2019-06-09T20:00:00.000Z');
  const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const nightsBefore = (nights: number): string =>
    new Date(NOW.getTime() - nights * 24 * 60 * 60 * 1000).toISOString();

  /** Season 1, seeded by `0001_init.sql` with a fixed id: never the *active* season of a run. */
  const SEASON_ONE = '00000000-0000-0000-0000-000000000001';
  /**
   * Both kinds green, which is also production since the writes were verified (16.18,
   * 2026-09-12). {@link OFF} is kept because the refusal it causes is still reachable: a patch
   * that breaks a write is a flag flip away, and the 409 has to keep working.
   */
  const ON = { create_lobby: true, invite: true, switch_side: false } as const;
  const OFF = { create_lobby: false, invite: false, switch_side: false } as const;

  const runId = randomUUID().slice(0, 8);
  const puuidOf = (name: string): string => `sl-${runId}-${name}`;
  const adminDiscordId = `9${runId.replace(/\D/g, '') || '1'}00001`;
  const memberDiscordId = `9${runId.replace(/\D/g, '') || '1'}00002`;

  const NAMES = ['admin', 'host', 'fresh', 'stale', 'recent', 'old', 'inlobby'] as const;
  type Name = (typeof NAMES)[number];
  const ids = new Map<Name, string>();
  const id = (name: Name): string => {
    const value = ids.get(name);
    if (value === undefined) throw new Error(`no player for ${name}`);
    return value;
  };

  const partyId = `sl-${runId}`;
  const gameIds = [9_100_000_000_000 + Math.floor(Math.random() * 1_000_000), 0];
  gameIds[1] = (gameIds[0] ?? 0) + 1;

  let hostToken = '';
  let lobbyId = '';
  let commandId = '';

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /**
   * The real `/api/me/*` gate with only the Supabase user injected: the Discord id is still
   * matched against `players` for real, so a session whose id nobody carries really does arrive
   * at the handler with `me.player === null`.
   */
  function authorizeAs(user: SessionUserLike | null) {
    return async (_request: Request, client: typeof db): Promise<MeAuthResult> =>
      authorizeMe({
        resolveSessionUser: async () => user,
        lookupPlayerByDiscordId: supabaseMeLookup(client),
      });
  }

  function press(options: { user?: SessionUserLike | null; gate?: CommandGate | undefined } = {}) {
    return startLobbyRoute({
      getClient: () => db,
      authorize: authorizeAs(options.user === undefined ? sessionUser(adminDiscordId) : options.user),
      // `exactOptionalPropertyTypes`: the gate is present or absent, never `undefined`.
      start: { now: NOW, password: () => '4821', ...(options.gate ? { gate: options.gate } : {}) },
    });
  }

  function postStart(body: unknown = {}): Request {
    return new Request('http://localhost/api/me/lobbies/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function companionPost(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/companion/commands/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hostToken}` },
      body: JSON.stringify(body),
    });
  }

  async function commandsOf(kind: 'create_lobby' | 'invite') {
    const { data, error } = await db
      .from('companion_commands')
      .select('id, kind, status, payload, target_player_id, expires_at, created_at')
      .in('target_player_id', [...ids.values()])
      .eq('kind', kind)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function seedGame(index: number, playerId: string, startedAt: string): Promise<void> {
    const lcuGameId = gameIds[index] ?? 0;
    const { data, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        // Explicit, never the active season: another file's run may have made its own active.
        season_id: SEASON_ONE,
        started_at: startedAt,
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(`seedGame: ${error.message}`);

    const { error: playerError } = await db
      .from('game_players')
      .insert({ game_id: data.id, player_id: playerId, side: 100, role: 'mid' });
    if (playerError) throw new Error(`seedGame: ${playerError.message}`);
  }

  beforeAll(async () => {
    const created = await ensurePlayers(
      db,
      NAMES.map((name) => ({ puuid: puuidOf(name) })),
    );
    for (const name of NAMES) {
      const playerId = created.get(puuidOf(name));
      if (playerId === undefined) throw new Error(`ensurePlayers missed ${name}`);
      ids.set(name, playerId);
    }

    const admin = await db
      .from('players')
      .update({ discord_id: adminDiscordId, is_admin: true })
      .eq('id', id('admin'));
    if (admin.error) throw new Error(admin.error.message);

    // Somebody signed in who is **not** an admin. Since M4.13 the route serves them too, and
    // the press below proves it opens the lobby on their own PC.
    const member = await db
      .from('players')
      .update({ discord_id: memberDiscordId, is_admin: false })
      .eq('id', id('fresh'));
    if (member.error) throw new Error(member.error.message);

    // A summoner id on one invitee only: the payload carries it when we have it and null when
    // we do not, and the companion picks the body the verification pass found.
    const summoner = await db.from('players').update({ summoner_id: '4242' }).eq('id', id('fresh'));
    if (summoner.error) throw new Error(summoner.error.message);

    async function mint(name: Name, lastSeenAt: string): Promise<string> {
      const { token, tokenHash } = mintCompanionToken();
      const { error } = await db.from('companion_tokens').insert({
        player_id: id(name),
        token_hash: tokenHash,
        label: `start ${runId} ${name}`,
        last_seen_at: lastSeenAt,
      });
      if (error) throw new Error(`mint: ${error.message}`);
      return token;
    }

    // The host: a client that was up a minute ago. `fresh` is inside the hour but outside the
    // ten-minute host window; `stale` is outside both.
    hostToken = await mint('host', minutesBefore(1));
    await mint('fresh', minutesBefore(59));
    await mint('stale', minutesBefore(61));
    // Around by every clause, and never invited anyway: they are in the lobby already.
    await mint('inlobby', minutesBefore(5));

    // Clause (b): a custom six nights ago is around, one eight nights ago is not.
    await seedGame(0, id('recent'), nightsBefore(6));
    await seedGame(1, id('old'), nightsBefore(8));
  });

  afterAll(async () => {
    clearCommandHooks();
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('games').delete().in('lcu_game_id', gameIds);
    // `companion_commands`, `companion_tokens` and `game_players` all cascade from here.
    await db
      .from('players')
      .delete()
      .in(
        'puuid',
        NAMES.map((name) => puuidOf(name)),
      );
  });

  describe('who may press (M4.13)', () => {
    /** Every `create_lobby` this describe wrote, gone, so the rest of the file starts empty. */
    async function clearCreates(): Promise<void> {
      const { error } = await db
        .from('companion_commands')
        .delete()
        .in('target_player_id', [...ids.values()])
        .eq('kind', 'create_lobby');
      if (error) throw new Error(`clearCreates: ${error.message}`);
    }

    it('refuses an anonymous caller with 401 and writes nothing', async () => {
      const response = await startRouteExport(postStart());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'sign in required' });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
    });

    it('answers a signed-in visitor with no player row in a sentence, never a 500', async () => {
      // A Discord account nobody has picked themselves with: the page cannot make this request,
      // so it is the forged post, and the honest answer to it is a sentence they can act on.
      const response = await press({ user: sessionUser('9999999999999999'), gate: ON })(postStart());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ ok: false, error: START_LOBBY_NOT_LINKED });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
    });

    it('lets a linked non-admin press it, and the presser is their own session', async () => {
      // Their own companion is up, so `chooseHost` prefers them — which is the observable proof
      // that `pressedByPlayerId` came from the session and not from the body or from the admin.
      const seen = await db
        .from('companion_tokens')
        .update({ last_seen_at: minutesBefore(2) })
        .eq('player_id', id('fresh'));
      if (seen.error) throw new Error(seen.error.message);

      try {
        const response = await press({ user: sessionUser(memberDiscordId), gate: ON })(postStart());

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        // `fresh` is not an admin: `0001_init.sql` defaults `is_admin` to false and nothing in
        // `beforeAll` set it. The lobby opens on their PC anyway.
        expect(body).toMatchObject({ ok: true, host: { playerId: id('fresh') } });

        const rows = await commandsOf('create_lobby');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.target_player_id).toBe(id('fresh'));
      } finally {
        await clearCreates();
        // Back outside the ten-minute host window and inside the hour: the fan-out's own
        // around set, which the rest of this file is written against.
        await db
          .from('companion_tokens')
          .update({ last_seen_at: minutesBefore(59) })
          .eq('player_id', id('fresh'));
      }
    });
  });

  describe('the refusals', () => {
    it('says the writes are not verified while the gate is off, and reads nothing', async () => {
      // The gate is named: the production table in `lib/commands/gate.ts` is all **on** since
      // the 16.18 verification, so this case is the flag being turned back off for a patch.
      const response = await press({ gate: OFF })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_WRITES_UNVERIFIED });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
      expect(await commandsOf('invite')).toHaveLength(0);
    });

    it('refuses when no companion has been up for ten minutes, and writes nothing anywhere', async () => {
      const { error } = await db
        .from('companion_tokens')
        .update({ last_seen_at: minutesBefore(11) })
        .in('player_id', [id('host'), id('inlobby')]);
      if (error) throw new Error(error.message);

      try {
        const response = await press({ gate: ON })(postStart());

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ ok: false, error: NO_COMPANION_AROUND });
        expect(await commandsOf('create_lobby')).toHaveLength(0);
      } finally {
        await db
          .from('companion_tokens')
          .update({ last_seen_at: minutesBefore(1) })
          .eq('player_id', id('host'));
        await db
          .from('companion_tokens')
          .update({ last_seen_at: minutesBefore(5) })
          .eq('player_id', id('inlobby'));
      }
    });
  });

  describe('the press', () => {
    it('queues exactly one create_lobby on the host, with a generated name and password', async () => {
      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        host: { playerId: id('host'), puuid: puuidOf('host') },
        lobbyName: 'Customs 09 Jun #1',
        lobbyPassword: '4821',
        cycle: 1,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      });
      expect(body.lobbyName).toMatch(/^Customs \d\d [A-Z][a-z]{2} #\d+$/);
      expect(body.lobbyPassword).toMatch(/^\d{4}$/);

      const rows = await commandsOf('create_lobby');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        target_player_id: id('host'),
        status: 'pending',
        payload: { lobbyName: 'Customs 09 Jun #1', lobbyPassword: '4821' },
        // The kind's own TTL: a minute is how long somebody stares at a button.
        expires_at: new Date(NOW.getTime() + 60_000).toISOString().replace('.000Z', '+00:00'),
      });

      commandId = rows[0]?.id ?? '';
      expect(commandId).toBeTruthy();
    });

    it('is a no-op on the second tap: one sentence, and no second row', async () => {
      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPENING });
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('sends a browser form back to the page it was pressed on, with the sentence', async () => {
      const form = new Request('http://localhost/api/me/lobbies/start', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ redirectTo: '/' }).toString(),
      });

      const response = await press({ gate: ON })(form);

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('error')).toBe(LOBBY_ALREADY_OPENING);
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it("sends /admin's own form back to /admin, on the same route (M4.13)", async () => {
      // The one button on the dashboard names `/admin` in its body, because the route's default
      // is the tonight page now. The no-JavaScript path is the only one that reads it.
      const form = new Request('http://localhost/api/me/lobbies/start', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ redirectTo: '/admin' }).toString(),
      });

      const response = await press({ gate: ON })(form);

      expect(response.status).toBe(303);
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/admin');
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('refuses while a lobby of tonight is live, before it looks at the pending row', async () => {
      // The lobby the host's client just opened, posted back by their companion.
      const { data, error } = await db
        .from('lobbies')
        .insert({
          lcu_party_id: partyId,
          status: 'open',
          lobby_name: 'Customs 09 Jun #1',
          created_at: minutesBefore(1),
          updated_at: minutesBefore(1),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      lobbyId = data.id;

      const members = await db.from('lobby_members').insert([
        { lobby_id: lobbyId, player_id: id('host'), side: 100 },
        { lobby_id: lobbyId, player_id: id('inlobby'), side: 100 },
      ]);
      if (members.error) throw new Error(members.error.message);

      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPEN });
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });
  });

  describe('the fan-out, off the ack', () => {
    it('queues one invite per person around, on the host, most recently active first', async () => {
      // The production hook with the clock, the gate and the client injected: the same object
      // `register.ts` builds, and the same path the ack route drives it through.
      clearCommandHooks();
      registerCommandHook(inviteFanOutHook({ now: NOW, gate: ON, getClient: () => db }));

      const response = await ackCommandRoute(
        companionPost(`${commandId}/ack`, { result: { partyId, lobbyName: 'Customs 09 Jun #1' } }),
        { params: Promise.resolve({ id: commandId }) },
      );
      expect(response.status).toBe(200);

      const invites = await commandsOf('invite');
      // Exactly the around set: `fresh` by their token, `recent` by a custom six nights ago.
      // Never the host, never `inlobby` who is already in it, never `stale` (a token last seen
      // 61 minutes ago), never `old` (whose last custom was eight nights back), never `admin`
      // who pressed the button from a phone with no companion anywhere.
      expect(invites).toHaveLength(2);
      expect(invites.map((row) => row.target_player_id)).toEqual([id('host'), id('host')]);
      expect(new Set(invites.map((row) => (row.payload as { puuid: string }).puuid))).toEqual(
        new Set([puuidOf('fresh'), puuidOf('recent')]),
      );
      // The invitee's summoner id when we have one, null when we do not, so M4.1's executor can
      // use whichever body the verification pass found.
      const summonerIds = new Map(
        invites.map((row) => {
          const payload = row.payload as { puuid: string; summonerId: string | null };
          return [payload.puuid, payload.summonerId];
        }),
      );
      expect(summonerIds.get(puuidOf('fresh'))).toBe('4242');
      expect(summonerIds.get(puuidOf('recent'))).toBeNull();
    });

    it('writes them most recently active first', async () => {
      // The rows of one insert share `created_at` to the microsecond, so the order lives in the
      // write and not in a column: this asserts the writer's own answer.
      const { error } = await db
        .from('companion_commands')
        .delete()
        .eq('target_player_id', id('host'))
        .eq('kind', 'invite');
      if (error) throw new Error(error.message);

      const result = await fanOutInvites(db, { hostPlayerId: id('host') }, { now: NOW, gate: ON });

      expect(result.invited).toEqual([id('fresh'), id('recent')]);
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('writes no second invite when the same ack arrives twice', async () => {
      const response = await ackCommandRoute(
        companionPost(`${commandId}/ack`, { result: { partyId, lobbyName: 'Customs 09 Jun #1' } }),
        { params: Promise.resolve({ id: commandId }) },
      );

      // The row is already settled: the second ack changes nothing and no hook runs.
      expect(response.status).toBe(409);
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('skips anybody already holding a live invite when it runs again', async () => {
      const result = await fanOutInvites(db, { hostPlayerId: id('host') }, { now: NOW, gate: ON });

      expect(result).toMatchObject({ invited: [], alreadyQueued: 2, gated: false });
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('queues nothing at all while the invite kind is gated off', async () => {
      // The gate off, on a host with nobody yet invited: no read, no write, no rows. The kind
      // is green in production since 16.18, so the flag is named rather than defaulted.
      const result = await fanOutInvites(db, { hostPlayerId: id('fresh') }, { now: NOW, gate: OFF });

      expect(result).toMatchObject({ invited: [], gated: true });
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('queues zero invites for a create_lobby that was nacked', async () => {
      const { queued } = await enqueueCommands(
        db,
        [
          {
            targetPlayerId: id('host'),
            kind: 'create_lobby',
            payload: { lobbyName: 'Customs 09 Jun #2', lobbyPassword: '1234' },
          },
        ],
        { now: NOW, gate: ON },
      );
      const second = queued[0] ?? '';

      const response = await nackCommandRoute(
        companionPost(`${second}/nack`, {
          error: 'already_in_lobby: partyId=abc',
          retryable: false,
        }),
        { params: Promise.resolve({ id: second }) },
      );

      expect(response.status).toBe(200);
      // No lobby, no invites, no half state: the failed create queues nothing.
      expect(await commandsOf('invite')).toHaveLength(2);
    });
  });

  describe('the lock is a database constraint (M4.9)', () => {
    /** Every `create_lobby` this file wrote, gone, so the lock is free for the next case. */
    async function clearCreates(): Promise<void> {
      const { error } = await db
        .from('companion_commands')
        .delete()
        .in('target_player_id', [...ids.values()])
        .eq('kind', 'create_lobby');
      if (error) throw new Error(`clearCreates: ${error.message}`);
    }

    const createPayload = (n: number) => ({ lobbyName: `Customs 09 Jun #${n}`, lobbyPassword: '1111' });

    beforeAll(async () => {
      // The night's first lobby finished, so Start is allowed again (M4.2's last edge case).
      const { error } = await db.from('lobbies').update({ status: 'finished' }).eq('id', lobbyId);
      if (error) throw new Error(error.message);
      await clearCreates();
    });

    afterEach(clearCreates);

    it('leaves one row and one 409 when two presses land in the same instant', async () => {
      // The whole point of the index: both requests read the same empty table and both try to
      // insert. Before `0008` this wrote two rows, opened two lobbies on two clients and fanned
      // out two sets of invites.
      const [first, second] = await Promise.all([
        press({ gate: ON })(postStart()),
        press({ gate: ON })(postStart()),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);

      const refused = first.status === 409 ? first : second;
      // The same sentence either way: the presser cannot tell whether the read refused them or
      // the index did, and neither can this test.
      await expect(refused.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPENING });

      const rows = await commandsOf('create_lobby');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('pending');
    });

    it('gives the presser the same sentence when the index is what refused them', async () => {
      // The interleaving the `Promise.all` above cannot be made to happen on demand: the other
      // press's row lands *after* our read and *before* our insert. Staged by writing a live
      // row the read cannot see — its `expires_at` is two TTLs out, and the read's window is
      // exactly one — so `decideStart` passes and only the index can refuse.
      const { error } = await db.from('companion_commands').insert({
        target_player_id: id('inlobby'),
        kind: 'create_lobby',
        payload: createPayload(9),
        expires_at: new Date(NOW.getTime() + 120_000).toISOString(),
      });
      if (error) throw new Error(error.message);

      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPENING });
      // One row: the one that was there. Not ours, and never a 500.
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('refuses a second live create_lobby on a different host, and says so rather than throwing', async () => {
      const first = await enqueueCommands(
        db,
        [{ targetPlayerId: id('host'), kind: 'create_lobby', payload: createPayload(2) }],
        { now: NOW, gate: ON },
      );
      expect(first.queued).toHaveLength(1);

      // A different target player on purpose: the lock is global, not per host. Per host would
      // still let two admins with two companions open two lobbies, which is the failure the
      // reviewer found.
      const second = await enqueueCommands(
        db,
        [{ targetPlayerId: id('inlobby'), kind: 'create_lobby', payload: createPayload(3) }],
        { now: NOW, gate: ON },
      );

      expect(second.queued).toEqual([]);
      expect(second.skipped).toEqual([{ kind: 'create_lobby', reason: 'conflict' }]);
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('still writes the rest of a batch whose create_lobby lost the race', async () => {
      await enqueueCommands(
        db,
        [{ targetPlayerId: id('host'), kind: 'create_lobby', payload: createPayload(4) }],
        { now: NOW, gate: ON },
      );

      const mixed = await enqueueCommands(
        db,
        [
          { targetPlayerId: id('host'), kind: 'create_lobby', payload: createPayload(5) },
          {
            targetPlayerId: id('host'),
            kind: 'invite',
            // Through the wire schema, which is where the branded puuid comes from.
            payload: companionCommandPayloadSchemas.invite.parse({
              puuid: puuidOf('old'),
              summonerId: null,
            }),
          },
        ],
        { now: NOW, gate: ON },
      );

      expect(mixed.skipped).toEqual([{ kind: 'create_lobby', reason: 'conflict' }]);
      expect(mixed.queued).toHaveLength(1);
      // The two the fan-out wrote earlier, plus this one: an insert is all-or-nothing, so
      // without the retry the invite would have been lost to somebody else's double tap.
      expect(await commandsOf('invite')).toHaveLength(3);

      const { error } = await db.from('companion_commands').delete().in('id', mixed.queued);
      if (error) throw new Error(error.message);
    });

    it('frees the slot when the sweep expires a stale pending create', async () => {
      // The host's companion went away between the press and the poll: the row is still
      // `pending`, its 60 seconds are up, and nobody has polled since. `expires_at` cannot be in
      // the index's predicate — `now()` is not immutable — so the sweep is what releases it.
      const { data, error } = await db
        .from('companion_commands')
        .insert({
          target_player_id: id('host'),
          kind: 'create_lobby',
          payload: createPayload(6),
          expires_at: new Date(NOW.getTime() - 1_000).toISOString(),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      const blocked = await enqueueCommands(
        db,
        [{ targetPlayerId: id('host'), kind: 'create_lobby', payload: createPayload(7) }],
        { now: NOW, gate: ON },
      );
      expect(blocked.skipped).toEqual([{ kind: 'create_lobby', reason: 'conflict' }]);

      // The clock is 2019, so this settles this file's row and nothing else on the shared stack.
      await sweepExpiredCommands(db, NOW);

      const swept = await db.from('companion_commands').select('status, error').eq('id', data.id).single();
      expect(swept.data).toMatchObject({ status: 'failed', error: COMMAND_ERRORS.expired });

      // `failed` is outside the index's predicate, so the slot is free again.
      const after = await enqueueCommands(
        db,
        [{ targetPlayerId: id('host'), kind: 'create_lobby', payload: createPayload(7) }],
        { now: NOW, gate: ON },
      );
      expect(after.queued).toHaveLength(1);
      expect(after.skipped).toEqual([]);
    });

    it('sweeps a stale pending create out of the way of a real press', async () => {
      const { error } = await db.from('companion_commands').insert({
        target_player_id: id('host'),
        kind: 'create_lobby',
        payload: createPayload(8),
        expires_at: new Date(NOW.getTime() - 1_000).toISOString(),
      });
      if (error) throw new Error(error.message);

      // `startLobby` sweeps before it reads, so the press does not inherit a dead lock from a
      // companion that went away.
      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(200);
      const rows = await commandsOf('create_lobby');
      expect(rows.filter((row) => row.status === 'pending')).toHaveLength(1);
    });
  });
}
