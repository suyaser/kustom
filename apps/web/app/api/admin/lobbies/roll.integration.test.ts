import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Database, rosterKey } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NO_SUCH_LOBBY } from '@/lib/admin/reroll';
import { ROLL_IN_FLIGHT, ROLL_IN_FLIGHT_MS, STALE_ROSTER } from '@/lib/admin/roll';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import { SWITCH_SIDE_ENABLED } from '@/lib/commands/gate';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { moveLobby } from '@/lib/lobbyState';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { storedRosterKey } from '@/lib/testing/roll';

/**
 * The roll (2026-10-03) against the Supabase CLI local stack: the admin's press that replaced
 * the ten-second auto-balance, through the real handler, with a webhook that is a real HTTP
 * server in this process.
 *
 * What it is here to prove:
 *
 * - only an admin can press it (401 anonymous, 403 for a signed-in non-admin);
 * - a press balances an `open` lobby of ten into three splits and posts one teams embed;
 * - **idempotent**: the same press again answers the split already up — no fourth split, no
 *   second embed — and two presses at once make one balance;
 * - 409, with nothing written, for a stale roster, fewer than ten, and a lobby past `balanced`;
 * - a leave after the roll sends the lobby back to `open` and needs another press.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the roll against the local Supabase stack', () => {
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

  // The handler import is also what registers the Discord and command-queue listeners.
  const { rollRoute } = await import('./[lobbyId]/roll/handler');
  const { POST: rollRouteExport } = await import('./[lobbyId]/roll/route');
  const { POST: postLobby } = await import('../../companion/lobby/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-rl${String(index).padStart(2, '0')}`);
  const spare = `it-${runId}-rl-spare`;
  const adminPuuid = `it-${runId}-rl-admin`;
  const allPuuids = [...ten, spare, adminPuuid];
  const adminDiscordId = `9${runId.replace(/\D/g, '') || '1'}00001`;
  const memberDiscordId = `9${runId.replace(/\D/g, '') || '1'}00002`;
  const guildId = `it-${runId}-rl-guild`;
  const partyIds = new Set<string>();

  let token = '';
  let server: Server | null = null;
  let posts: { body: Record<string, unknown> }[] = [];
  let webhookUrl = '';
  const playerIds = new Map<string, string>();

  function party(name: string): string {
    const id = `rl-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /** The real gate with only the session injected: `players.is_admin` is still read for real. */
  function authorizeAs(user: SessionUserLike | null) {
    return async (_request: Request, client: typeof db): Promise<AdminAuthResult> =>
      authorizeAdmin({
        resolveSessionUser: async () => user,
        lookupPlayerByDiscordId: supabaseAdminLookup(client),
      });
  }

  function rollRequest(lobbyId: string, body: unknown): Request {
    return new Request(`http://localhost/api/admin/lobbies/${lobbyId}/roll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Press as `user` (the admin by default) with `body`, at `now` (the wall clock by default). */
  async function press(
    lobbyId: string,
    body: unknown,
    options: { user?: SessionUserLike | null; now?: Date } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const user = options.user === undefined ? sessionUser(adminDiscordId) : options.user;
    const now = options.now;
    const response = await rollRoute(lobbyId, {
      getClient: () => db,
      authorize: authorizeAs(user),
      ...(now ? { now: () => now } : {}),
    })(rollRequest(lobbyId, body));
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  function lobbyBody(partyId: string, members: readonly string[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs-night',
      members: members.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 5_000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    };
  }

  async function companionPost(partyId: string, members: readonly string[]) {
    const response = await postLobby(
      new Request('http://localhost/api/companion/lobby', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(lobbyBody(partyId, members)),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string; status: string; memberCount: number };
  }

  async function lobbyStatus(lobbyId: string): Promise<string> {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  async function splitCount(lobbyId: string): Promise<number> {
    const { count, error } = await db
      .from('splits')
      .select('id', { count: 'exact', head: true })
      .eq('lobby_id', lobbyId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function chosenSplitId(lobbyId: string): Promise<string | null> {
    const { data, error } = await db
      .from('splits')
      .select('id')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  /** Commands are addressed to players, not lobbies; these ten belong to this file alone. */
  async function pendingSwitchSides(): Promise<number> {
    const { count, error } = await db
      .from('companion_commands')
      .select('id', { count: 'exact', head: true })
      .in(
        'target_player_id',
        ten.map((puuid) => playerIds.get(puuid) ?? ''),
      )
      .eq('kind', 'switch_side')
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  /**
   * A lobby row inserted at `status` with members and an `updated_at` of its own — the trigger
   * is `before update`, so an insert may set it. For the cases no companion post can reach.
   */
  async function insertLobby(
    partyId: string,
    status: Database['public']['Enums']['lobby_status'],
    members: readonly string[],
    idleMs = 0,
  ): Promise<string> {
    const { data, error } = await db
      .from('lobbies')
      .insert({ lcu_party_id: partyId, status, updated_at: new Date(Date.now() - idleMs).toISOString() })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const { error: memberError } = await db.from('lobby_members').insert(
      members.map((puuid, index) => ({
        lobby_id: data.id,
        player_id: playerIds.get(puuid) ?? '',
        side: index < 5 ? 100 : 200,
        is_spectator: false,
      })),
    );
    if (memberError) throw new Error(memberError.message);
    return data.id;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      allPuuids.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) playerIds.set(puuid, id);

    const { error: adminError } = await db
      .from('players')
      .update({ discord_id: adminDiscordId, is_admin: true })
      .eq('id', ids.get(adminPuuid) ?? '');
    if (adminError) throw new Error(adminError.message);
    const { error: memberError } = await db
      .from('players')
      .update({ discord_id: memberDiscordId, is_admin: false })
      .eq('id', ids.get(ten[0] ?? '') ?? '');
    if (memberError) throw new Error(memberError.message);

    // A token each, seen just now, so every one of the ten counts as having a live companion
    // and the switch_side queue (M4.1) writes a row for everybody the split moves.
    const minted = ten.map((puuid) => ({ puuid, ...mintCompanionToken() }));
    const { error: tokenError } = await db.from('companion_tokens').insert(
      minted.map(({ puuid, tokenHash }) => ({
        player_id: ids.get(puuid) ?? '',
        token_hash: tokenHash,
        label: `rl-${runId}`,
        last_seen_at: new Date().toISOString(),
      })),
    );
    if (tokenError) throw new Error(tokenError.message);
    token = minted[0]?.token ?? '';

    server = createServer((incoming, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
        response.writeHead(204).end();
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;

    await db.from('discord_config').delete().like('guild_id', 'it-%');
    const { error: configError } = await db
      .from('discord_config')
      .insert({ guild_id: guildId, webhook_url: webhookUrl });
    if (configError) throw new Error(configError.message);
  });

  afterEach(() => {
    posts = [];
  });

  afterAll(async () => {
    await db.from('discord_config').delete().eq('guild_id', guildId);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', allPuuids);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  describe('a press', () => {
    it('balances an open lobby of ten into three splits and posts one teams embed', async () => {
      const opened = await companionPost(party('happy'), ten);
      expect(opened).toMatchObject({ status: 'open', memberCount: 10 });
      expect(posts).toHaveLength(0);

      const { status, json } = await press(opened.lobbyId, { rosterKey: rosterKey(ten) });

      expect(status).toBe(200);
      expect(json).toMatchObject({
        ok: true,
        lobbyId: opened.lobbyId,
        status: 'balanced',
        outcome: 'rolled',
      });
      expect(json.splitId).toBe(await chosenSplitId(opened.lobbyId));
      expect(await lobbyStatus(opened.lobbyId)).toBe('balanced');
      expect(await splitCount(opened.lobbyId)).toBe(3);
      // M3.1's teams embed, exactly once.
      expect(posts).toHaveLength(1);
      // M4.1: the command queue heard the same event — one pending switch_side for everybody
      // the chosen split puts on the other side from where the lobby post had them.
      const { data: chosen } = await db.from('splits').select('blue').eq('id', String(json.splitId)).single();
      const blue = new Set(((chosen?.blue ?? []) as { puuid: string }[]).map((seat) => seat.puuid));
      const moved = ten.filter((puuid, index) => blue.has(puuid) !== index < 5).length;
      expect(await pendingSwitchSides()).toBe(SWITCH_SIDE_ENABLED ? moved : 0);
    });

    it('is a no-op when pressed again with the same roster: same split, no new rows, no new post', async () => {
      const opened = await companionPost(party('repeat'), ten);
      const first = await press(opened.lobbyId, { rosterKey: rosterKey(ten) });
      expect(first.json.outcome).toBe('rolled');
      posts = [];

      const second = await press(opened.lobbyId, { rosterKey: rosterKey(ten) });
      expect(second.status).toBe(200);
      expect(second.json).toMatchObject({
        status: 'balanced',
        outcome: 'already_rolled',
        splitId: first.json.splitId,
      });
      expect(await splitCount(opened.lobbyId)).toBe(3);
      expect(posts).toHaveLength(0);
    });

    it('makes one balance when two presses land at the same moment', async () => {
      const opened = await companionPost(party('race'), ten);
      const answers = await Promise.all([
        press(opened.lobbyId, { rosterKey: rosterKey(ten) }),
        press(opened.lobbyId, { rosterKey: rosterKey(ten) }),
      ]);

      const rolled = answers.filter((answer) => answer.json.outcome === 'rolled');
      expect(rolled).toHaveLength(1);
      // The other saw the teams up, or caught the first between its claim and its splits.
      for (const answer of answers.filter((a) => a.json.outcome !== 'rolled')) {
        expect([200, 409]).toContain(answer.status);
        if (answer.status === 409) expect(answer.json.error).toBe(ROLL_IN_FLIGHT);
      }
      expect(await splitCount(opened.lobbyId)).toBe(3);
      expect(posts).toHaveLength(1);
    });

    it('needs another press after somebody leaves, and the old key is stale from then on', async () => {
      const id = party('leave');
      const opened = await companionPost(id, ten);
      expect((await press(opened.lobbyId, { rosterKey: rosterKey(ten) })).json.outcome).toBe('rolled');

      // One leaves and somebody else takes the seat: ingest sends the lobby back to `open`.
      const swapped = [...ten.slice(0, 9), spare];
      expect(await companionPost(id, swapped)).toMatchObject({ status: 'open', memberCount: 10 });
      // ...and it stays there; there is no timer any more.
      expect(await companionPost(id, swapped)).toMatchObject({ status: 'open' });
      expect(await splitCount(opened.lobbyId)).toBe(3);

      const stale = await press(opened.lobbyId, { rosterKey: rosterKey(ten) });
      expect(stale).toEqual({ status: 409, json: { ok: false, error: STALE_ROSTER } });

      const again = await press(opened.lobbyId, { rosterKey: rosterKey(swapped) });
      expect(again.json).toMatchObject({ status: 'balanced', outcome: 'rolled' });
      expect(await splitCount(opened.lobbyId)).toBe(6);
      expect(posts).toHaveLength(2);
    });
  });

  describe('a refusal writes nothing', () => {
    it('is 409 for a roster the presser saw that is not the one stored', async () => {
      const opened = await companionPost(party('stale'), ten);
      const seen = rosterKey([...ten.slice(0, 9), spare]);

      const { status, json } = await press(opened.lobbyId, { rosterKey: seen });
      expect(status).toBe(409);
      expect(json).toEqual({ ok: false, error: STALE_ROSTER });
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');
      expect(await splitCount(opened.lobbyId)).toBe(0);
      expect(posts).toHaveLength(0);
    });

    it('is 409 with fewer than ten in the lobby, even with a matching key', async () => {
      const nine = ten.slice(0, 9);
      const opened = await companionPost(party('nine'), nine);

      const { status, json } = await press(opened.lobbyId, { rosterKey: rosterKey(nine) });
      expect(status).toBe(409);
      expect(json.error).toBe('9 of 10 are in the lobby; it takes 10 to roll teams');
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');
      expect(await splitCount(opened.lobbyId)).toBe(0);
    });

    it.each([
      ['in_game', 'the game has started, so the teams on the rift are the teams'],
      ['dropped', 'the game has started, so the teams on the rift are the teams'],
      ['finished', 'that game is over'],
      ['abandoned', 'that lobby was abandoned'],
    ] as const)('is 409 for a lobby that is %s', async (status, error) => {
      const lobbyId = await insertLobby(party(`status-${status}`), status, ten);

      const answer = await press(lobbyId, { rosterKey: rosterKey(ten) });
      expect(answer).toEqual({ status: 409, json: { ok: false, error } });
      expect(await lobbyStatus(lobbyId)).toBe(status);
      expect(await splitCount(lobbyId)).toBe(0);
    });

    it('is 404 for a lobby that does not exist, and for a path segment that is not a uuid', async () => {
      expect(await press(randomUUID(), { rosterKey: rosterKey(ten) })).toEqual({
        status: 404,
        json: { ok: false, error: NO_SUCH_LOBBY },
      });
      expect(await press('not-a-uuid', { rosterKey: rosterKey(ten) })).toEqual({
        status: 404,
        json: { ok: false, error: NO_SUCH_LOBBY },
      });
    });

    it('is 400 for a body with no roster key', async () => {
      const opened = await companionPost(party('no-key'), ten);
      expect((await press(opened.lobbyId, {})).status).toBe(400);
      expect((await press(opened.lobbyId, { rosterKey: '' })).status).toBe(400);
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');
    });
  });

  describe('who may press it', () => {
    it('answers 401 to an anonymous request through the real route export', async () => {
      const opened = await companionPost(party('anon'), ten);
      const response = await rollRouteExport(rollRequest(opened.lobbyId, { rosterKey: rosterKey(ten) }), {
        params: Promise.resolve({ lobbyId: opened.lobbyId }),
      });
      expect(response.status).toBe(401);
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');
      expect(posts).toHaveLength(0);
    });

    it('answers 403 to a session whose player is not an admin', async () => {
      const opened = await companionPost(party('member'), ten);
      const answer = await press(
        opened.lobbyId,
        { rosterKey: rosterKey(ten) },
        { user: sessionUser(memberDiscordId) },
      );
      expect(answer.status).toBe(403);
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');
      expect(await splitCount(opened.lobbyId)).toBe(0);
      expect(posts).toHaveLength(0);
    });
  });

  describe('a balanced lobby with no chosen split', () => {
    it('is a roll in flight for the first thirty seconds: 409, nothing balanced', async () => {
      const lobbyId = await insertLobby(party('in-flight'), 'balanced', ten);

      const answer = await press(lobbyId, { rosterKey: rosterKey(ten) });
      expect(answer).toEqual({ status: 409, json: { ok: false, error: ROLL_IN_FLIGHT } });
      expect(await splitCount(lobbyId)).toBe(0);
    });

    it('is a roll that died after that, and a press makes the splits it never wrote', async () => {
      const lobbyId = await insertLobby(party('died'), 'balanced', ten, ROLL_IN_FLIGHT_MS + 5_000);

      const answer = await press(lobbyId, { rosterKey: await storedRosterKey(db, lobbyId) });
      expect(answer.json).toMatchObject({ status: 'balanced', outcome: 'rolled' });
      expect(await splitCount(lobbyId)).toBe(3);
      expect(posts).toHaveLength(1);
    });
  });

  describe('the compare-and-set guard', () => {
    it('refuses a move whose updated_at the row has moved past', async () => {
      const opened = await companionPost(party('cas'), ten);
      const { data } = await db.from('lobbies').select('updated_at').eq('id', opened.lobbyId).single();
      const read = data?.updated_at ?? '';

      // A roster change between the roll's read and its claim: ingest rewrites the row.
      await companionPost(party('cas'), [...ten.slice(0, 9), spare]);

      expect(
        await moveLobby(db, {
          lobbyId: opened.lobbyId,
          from: ['open'],
          to: 'balanced',
          unchangedSince: read,
        }),
      ).toBe(false);
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');

      // And with the value as it is now, the same move goes through.
      const { data: fresh } = await db.from('lobbies').select('updated_at').eq('id', opened.lobbyId).single();
      expect(
        await moveLobby(db, {
          lobbyId: opened.lobbyId,
          from: ['open'],
          to: 'balanced',
          unchangedSince: fresh?.updated_at ?? '',
        }),
      ).toBe(true);
    });
  });
}
