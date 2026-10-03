import { randomUUID } from 'node:crypto';
import type { Split } from '@customs/core';
import type { CompanionCommandRow, Database, Json, SideValue } from '@customs/db';
import {
  COMMANDS_PAGE_SIZE,
  COMPANION_COMMAND_TTL_MS,
  companionCommandsResponseSchema,
  ORIGINAL_GROUP_ID,
} from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { promoteSplit } from '@/lib/admin/reroll';
import {
  COMMAND_ERRORS,
  COMMANDS_MAX_DELIVERIES,
  COMMANDS_RECLAIM_MS,
  COMPANION_AROUND_MS,
  type CommandAckedEvent,
  claimCommands,
  clearCommandHooks,
  enqueueCommands,
  queueSwitchSideForBalance,
  registerCommandHook,
  sweepExpiredCommands,
} from '@/lib/commands';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import type { PoolMember } from '@/lib/ingest/selection';
import { IDLE_ABANDON_MS, moveLobby, sweepIdleLobbies } from '@/lib/lobbyState';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The command queue against the Supabase CLI local stack (M4.1, server half): the same route
 * handlers Next runs, the same service-role client, the same SQL.
 *
 * The clock is injected wherever a rule has a time in it — the 30-second reclaim, the TTLs, the
 * ten-minute "at their PC" window — so nothing here waits, and nothing here can touch a row
 * another agent's run put on the shared stack. Every row it creates is namespaced with a run id
 * and deleted afterwards.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the command queue against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';

  const { GET: pollCommands } = await import('./route');
  const { POST: ackCommandRoute } = await import('./[id]/ack/route');
  const { POST: nackCommandRoute } = await import('./[id]/nack/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuidOf = (name: string): string => `cq-${runId}-${name}`;
  const created = new Set<string>();
  const lobbyIds = new Set<string>();

  /**
   * The production table since the writes were verified (16.18, 2026-09-12). Both are named at
   * every call site: a case that wants rows passes {@link ON}, a case that wants none passes
   * {@link OFF}, and neither depends on which way `COMMAND_KIND_ENABLED` happens to be set.
   */
  const ON = { create_lobby: true, invite: true, switch_side: true } as const;
  const OFF = { create_lobby: false, invite: false, switch_side: false } as const;

  let owner = { token: '', playerId: '', tokenId: '' };
  let other = { token: '', playerId: '', tokenId: '' };
  let revoked = { token: '', playerId: '', tokenId: '' };

  async function player(name: string): Promise<string> {
    const puuid = puuidOf(name);
    created.add(puuid);
    const ids = await ensurePlayers(db, [{ puuid }]);
    const id = ids.get(puuid);
    if (id === undefined) throw new Error(`no player for ${puuid}`);
    return id;
  }

  async function mint(
    name: string,
    options: { revoked?: boolean; lastSeenAt?: Date | null } = {},
  ): Promise<{ token: string; playerId: string; tokenId: string }> {
    const playerId = await player(name);
    const { token, tokenHash } = mintCompanionToken();
    const { data, error } = await db
      .from('companion_tokens')
      .insert({
        player_id: playerId,
        token_hash: tokenHash,
        label: `commands ${name}`,
        revoked_at: options.revoked ? new Date().toISOString() : null,
        last_seen_at: options.lastSeenAt === undefined ? null : (options.lastSeenAt?.toISOString() ?? null),
      })
      .select('id')
      .single();
    if (error) throw new Error(`mint: ${error.message}`);
    return { token, playerId, tokenId: data.id };
  }

  function pollRequest(token: string | null, query: string): Request {
    const headers: Record<string, string> = {};
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return new Request(`http://localhost/api/companion/commands${query}`, { headers });
  }

  async function poll(
    token: string | null,
    clientConnected: boolean | 'missing' | 'nonsense' = true,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const query =
      clientConnected === 'missing'
        ? ''
        : clientConnected === 'nonsense'
          ? '?clientConnected=yes'
          : `?clientConnected=${clientConnected}`;
    const response = await pollCommands(pollRequest(token, query));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  function settleRequest(token: string | null, body: unknown): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return new Request('http://localhost/api/companion/commands/x/ack', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  async function ack(
    id: string,
    token: string | null,
    result: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await ackCommandRoute(settleRequest(token, { result }), {
      params: Promise.resolve({ id }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function nack(
    id: string,
    token: string | null,
    error: string,
    retryable: boolean,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await nackCommandRoute(settleRequest(token, { error, retryable }), {
      params: Promise.resolve({ id }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  /** One row, written the way the writer writes them, with the clock the case wants. */
  async function queue(
    playerId: string,
    kind: 'create_lobby' | 'invite' | 'switch_side',
    payload: Record<string, unknown>,
    now = new Date(),
  ): Promise<string> {
    const { queued } = await enqueueCommands(
      db,
      [{ targetPlayerId: playerId, groupId: ORIGINAL_GROUP_ID, kind, payload } as never],
      {
        now,
        gate: ON,
      },
    );
    const id = queued[0];
    if (id === undefined) throw new Error(`queue: ${kind} was not written`);
    return id;
  }

  const switchSidePayload = (targetSide: SideValue = 200) => ({ targetSide });
  const invitePayload = () => ({ puuid: puuidOf('invitee'), summonerId: '2686822975473024' });

  async function row(id: string): Promise<CompanionCommandRow> {
    const { data, error } = await db.from('companion_commands').select('*').eq('id', id).single();
    if (error) throw new Error(`row: ${error.message}`);
    return data;
  }

  async function lastSeenAt(tokenId: string): Promise<string | null> {
    const { data, error } = await db
      .from('companion_tokens')
      .select('last_seen_at')
      .eq('id', tokenId)
      .single();
    if (error) throw new Error(`lastSeenAt: ${error.message}`);
    return data.last_seen_at;
  }

  /** Everything this file wrote for one player, gone, so the next case starts empty. */
  async function clearQueue(...playerIds: string[]): Promise<void> {
    const { error } = await db.from('companion_commands').delete().in('target_player_id', playerIds);
    if (error) throw new Error(`clearQueue: ${error.message}`);
  }

  beforeAll(async () => {
    owner = await mint('owner');
    other = await mint('other');
    revoked = await mint('revoked', { revoked: true });
  });

  afterEach(async () => {
    clearCommandHooks();
    await clearQueue(owner.playerId, other.playerId, revoked.playerId);
  });

  afterAll(async () => {
    for (const lobbyId of lobbyIds) {
      await db.from('lobbies').delete().eq('id', lobbyId);
    }
    // `companion_tokens`, `companion_commands` and `lobby_members` all cascade from `players`.
    await db
      .from('players')
      .delete()
      .in('puuid', [...created]);
  });

  // -------------------------------------------------------------------------
  // GET /api/companion/commands
  // -------------------------------------------------------------------------

  describe('the poll', () => {
    it('answers 401 without a bearer, with an unknown token and with a revoked one', async () => {
      expect((await poll(null)).status).toBe(401);
      expect((await poll('not-a-token')).status).toBe(401);
      expect((await poll(revoked.token)).status).toBe(401);
    });

    it('refuses a missing or misspelt clientConnected with 400', async () => {
      expect((await poll(owner.token, 'missing')).status).toBe(400);
      expect((await poll(owner.token, 'nonsense')).status).toBe(400);
    });

    it('hands out this token player rows only, oldest first, and never another player queue', async () => {
      const now = Date.now();
      const first = await queue(owner.playerId, 'switch_side', switchSidePayload(100), new Date(now - 2000));
      const second = await queue(owner.playerId, 'invite', invitePayload(), new Date(now - 1000));
      const foreign = await queue(other.playerId, 'switch_side', switchSidePayload());

      const answer = await poll(owner.token);
      expect(answer.status).toBe(200);
      const parsed = companionCommandsResponseSchema.parse(answer.body);
      expect(parsed.commands.map((command) => command.id)).toEqual([first, second]);
      expect(parsed.commands.map((command) => command.kind)).toEqual(['switch_side', 'invite']);
      expect(parsed.commands[0]?.payload).toEqual({ targetSide: 100 });
      expect(parsed.nextPollInMs).toBe(5000);

      // The other player's row is untouched and invisible with this token.
      expect((await row(foreign)).status).toBe('pending');
      expect(parsed.commands.some((command) => command.id === foreign)).toBe(false);

      // ...and the owner's rows are equally invisible to the other token.
      const theirs = await poll(other.token);
      const theirParsed = companionCommandsResponseSchema.parse(theirs.body);
      expect(theirParsed.commands.map((command) => command.id)).toEqual([foreign]);
    });

    it('never answers more than a page, however many are waiting', async () => {
      const now = Date.now();
      for (let index = 0; index < COMMANDS_PAGE_SIZE + 3; index += 1) {
        await queue(owner.playerId, 'switch_side', switchSidePayload(), new Date(now - 60_000 + index));
      }
      const parsed = companionCommandsResponseSchema.parse((await poll(owner.token)).body);
      expect(parsed.commands).toHaveLength(COMMANDS_PAGE_SIZE);
    });

    it('marks a handed-out row sent, with attempts and sent_at', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);

      const after = await row(id);
      expect(after.status).toBe('sent');
      expect(after.attempts).toBe(1);
      expect(after.sent_at).not.toBeNull();
      expect(after.acked_at).toBeNull();
    });

    it('holds a sent row back for thirty seconds, then hands it out again', async () => {
      const start = new Date();
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload(), start);

      const first = await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, start);
      expect(first.map((command) => command.id)).toEqual([id]);

      const almost = new Date(start.getTime() + COMMANDS_RECLAIM_MS - 1_000);
      expect(await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, almost)).toEqual([]);
      expect((await row(id)).attempts).toBe(1);

      const past = new Date(start.getTime() + COMMANDS_RECLAIM_MS + 1_000);
      expect((await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, past)).map((c) => c.id)).toEqual([
        id,
      ]);
      expect((await row(id)).attempts).toBe(2);
    });

    it('gives up on the delivery that would be the fourth, and never offers it again', async () => {
      const start = new Date();
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload(), start);

      for (let delivery = 1; delivery <= COMMANDS_MAX_DELIVERIES; delivery += 1) {
        const at = new Date(start.getTime() + delivery * (COMMANDS_RECLAIM_MS + 1_000));
        const handed = await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, at);
        expect(
          handed.map((command) => command.id),
          `delivery ${delivery}`,
        ).toEqual([id]);
      }
      expect((await row(id)).attempts).toBe(COMMANDS_MAX_DELIVERIES);

      const fourth = new Date(start.getTime() + 4 * (COMMANDS_RECLAIM_MS + 1_000));
      expect(await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, fourth)).toEqual([]);

      const settled = await row(id);
      expect(settled.status).toBe('failed');
      expect(settled.error).toBe(COMMAND_ERRORS.notAcked);
      expect(settled.attempts).toBe(COMMANDS_MAX_DELIVERIES);

      // And it stays gone, however long anybody waits.
      const later = new Date(start.getTime() + 10 * COMMANDS_RECLAIM_MS);
      expect(await claimCommands(db, owner.playerId, ORIGINAL_GROUP_ID, later)).toEqual([]);
    });

    it('with clientConnected=false answers nothing, moves nothing and does not touch last_seen_at', async () => {
      const away = await mint('away');
      created.add(puuidOf('away'));
      const id = await queue(away.playerId, 'switch_side', switchSidePayload());

      const answer = await poll(away.token, false);
      expect(answer.status).toBe(200);
      expect(companionCommandsResponseSchema.parse(answer.body).commands).toEqual([]);

      const untouched = await row(id);
      expect(untouched.status).toBe('pending');
      expect(untouched.attempts).toBe(0);
      expect(untouched.sent_at).toBeNull();
      expect(await lastSeenAt(away.tokenId)).toBeNull();

      // The same token a second later, with the client up, does move both.
      await poll(away.token, true);
      expect((await row(id)).status).toBe('sent');
      expect(await lastSeenAt(away.tokenId)).not.toBeNull();

      await clearQueue(away.playerId);
    });

    it('never hands out an expired row, and fails it with expired on the next poll', async () => {
      const long_ago = new Date(Date.now() - 2 * COMPANION_COMMAND_TTL_MS.switch_side);
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload(), long_ago);

      const parsed = companionCommandsResponseSchema.parse((await poll(owner.token)).body);
      expect(parsed.commands.some((command) => command.id === id)).toBe(false);

      const swept = await row(id);
      expect(swept.status).toBe('failed');
      expect(swept.error).toBe(COMMAND_ERRORS.expired);
      expect(swept.attempts).toBe(0);
    });

    it('sweeps expiry even when the client is down: the server owns the clock', async () => {
      const long_ago = new Date(Date.now() - 2 * COMPANION_COMMAND_TTL_MS.invite);
      const id = await queue(owner.playerId, 'invite', invitePayload(), long_ago);

      await poll(owner.token, false);
      expect((await row(id)).error).toBe(COMMAND_ERRORS.expired);
    });

    it('writes each kind its own TTL', async () => {
      const now = new Date();
      for (const [kind, ttl] of Object.entries(COMPANION_COMMAND_TTL_MS)) {
        const payload =
          kind === 'create_lobby'
            ? { lobbyName: 'kustom night', lobbyPassword: '4821' }
            : kind === 'invite'
              ? invitePayload()
              : switchSidePayload();
        const id = await queue(owner.playerId, kind as 'invite', payload, now);
        const written = await row(id);
        expect(Date.parse(written.expires_at) - Date.parse(written.created_at), kind).toBeGreaterThan(
          ttl - 5_000,
        );
        expect(Date.parse(written.expires_at) - now.getTime(), kind).toBeLessThanOrEqual(ttl);
      }
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/companion/commands/{id}/ack and /nack
  // -------------------------------------------------------------------------

  describe('ack', () => {
    it('stores the result, sets acked_at, and runs the onAcked hooks', async () => {
      const seen: CommandAckedEvent[] = [];
      registerCommandHook({ onAcked: (event) => void seen.push(event) });

      const id = await queue(owner.playerId, 'invite', invitePayload());
      await poll(owner.token);

      const result = { puuid: puuidOf('invitee'), method: 'summonerId', state: 'Pending' };
      const answer = await ack(id, owner.token, result);
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ ok: true });

      const acked = await row(id);
      expect(acked.status).toBe('acked');
      expect(acked.acked_at).not.toBeNull();
      expect(acked.result).toEqual(result);
      expect(acked.error).toBeNull();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ commandId: id, kind: 'invite', status: 'acked' });
    });

    it('is idempotent: a second ack is 409 and changes not one column', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload(100));
      await poll(owner.token);
      expect((await ack(id, owner.token, { side: 100 })).status).toBe(200);
      const first = await row(id);

      const again = await ack(id, owner.token, { side: 200 });
      expect(again.status).toBe(409);
      expect(await row(id)).toEqual(first);
    });

    it('answers 404 for another player id, and never says the row exists', async () => {
      const id = await queue(other.playerId, 'switch_side', switchSidePayload());
      const answer = await ack(id, owner.token, { side: 200 });
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).not.toContain(id);
      expect((await row(id)).status).toBe('pending');
    });

    it('answers 404 for an id that is not a uuid at all', async () => {
      expect((await ack('../../admin', owner.token, { side: 200 })).status).toBe(404);
      expect((await ack(randomUUID(), owner.token, { side: 200 })).status).toBe(404);
    });

    it('answers 422 for a result that fails the kind schema, and leaves the row alone', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);
      const before = await row(id);

      const answer = await ack(id, owner.token, { side: 150 });
      expect(answer.status).toBe(422);
      expect(await row(id)).toEqual(before);

      // And the right result still lands afterwards: 422 is not a settlement.
      expect((await ack(id, owner.token, { side: 200 })).status).toBe(200);
    });

    it('answers 400 for a body that is not the ack shape', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      const response = await ackCommandRoute(settleRequest(owner.token, { outcome: 'done' }), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(400);
      expect((await row(id)).status).toBe('pending');
    });

    it('answers 401 without a token, before it looks at anything', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      expect((await ack(id, null, { side: 200 })).status).toBe(401);
      expect((await row(id)).status).toBe('pending');
    });
  });

  describe('nack', () => {
    it('fails the row with the reason verbatim and runs the hooks', async () => {
      const seen: CommandAckedEvent[] = [];
      registerCommandHook({ onAcked: (event) => void seen.push(event) });

      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);

      expect((await nack(id, owner.token, 'side_full', false)).status).toBe(200);
      const failed = await row(id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('side_full');
      expect(failed.result).toBeNull();
      expect(failed.acked_at).not.toBeNull();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ commandId: id, status: 'failed', error: 'side_full' });
    });

    it('stores a reason word plus its detail, and never refuses a prefix it does not know', async () => {
      const id = await queue(owner.playerId, 'create_lobby', {
        lobbyName: 'kustom night',
        lobbyPassword: '4821',
      });
      await poll(owner.token);

      const error = 'already_in_lobby: partyId=abc-123';
      expect((await nack(id, owner.token, error, false)).status).toBe(200);
      expect((await row(id)).error).toBe(error);

      const later = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);
      expect((await nack(later, owner.token, 'something_a_newer_exe_says: 42', false)).status).toBe(200);
    });

    it('with retryable puts the row back to pending, keeps attempts and runs no hook', async () => {
      const seen: CommandAckedEvent[] = [];
      registerCommandHook({ onAcked: (event) => void seen.push(event) });

      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);
      expect((await row(id)).attempts).toBe(1);

      expect((await nack(id, owner.token, 'not_connected', true)).status).toBe(200);
      const back = await row(id);
      expect(back.status).toBe('pending');
      expect(back.sent_at).toBeNull();
      expect(back.attempts).toBe(1);
      expect(back.error).toBe('not_connected');
      expect(back.acked_at).toBeNull();
      expect(seen).toEqual([]);

      // Pending again means the very next poll offers it, without waiting out the reclaim.
      const parsed = companionCommandsResponseSchema.parse((await poll(owner.token)).body);
      expect(parsed.commands.map((command) => command.id)).toEqual([id]);
      expect((await row(id)).attempts).toBe(2);
    });

    it('is idempotent: a second nack is 409 and changes not one column', async () => {
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload());
      await poll(owner.token);
      expect((await nack(id, owner.token, 'wrong_phase: ChampSelect', false)).status).toBe(200);
      const first = await row(id);

      expect((await nack(id, owner.token, 'wrong_phase: ChampSelect', false)).status).toBe(409);
      expect(await row(id)).toEqual(first);
    });

    it('answers 409 for a row the sweep already expired', async () => {
      const long_ago = new Date(Date.now() - 2 * COMPANION_COMMAND_TTL_MS.switch_side);
      const id = await queue(owner.playerId, 'switch_side', switchSidePayload(), long_ago);
      await sweepExpiredCommands(db);

      expect((await nack(id, owner.token, 'not_connected', true)).status).toBe(409);
      expect((await row(id)).error).toBe(COMMAND_ERRORS.expired);
    });

    it('answers 404 for another player id and 400 for a body without retryable', async () => {
      const foreign = await queue(other.playerId, 'switch_side', switchSidePayload());
      expect((await nack(foreign, owner.token, 'side_full', false)).status).toBe(404);

      const mine = await queue(owner.playerId, 'switch_side', switchSidePayload());
      const response = await nackCommandRoute(settleRequest(owner.token, { error: 'side_full' }), {
        params: Promise.resolve({ id: mine }),
      });
      expect(response.status).toBe(400);
      expect((await row(mine)).status).toBe('pending');
    });
  });

  // -------------------------------------------------------------------------
  // The state machine: queued on `balanced`, superseded on the way out
  // -------------------------------------------------------------------------

  describe('the balanced transition', () => {
    const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

    interface Seat {
      playerId: string;
      puuid: string;
      /** Where the client has them. */
      side: SideValue | null;
    }

    function poolMember(seat: Seat): PoolMember {
      return {
        playerId: seat.playerId,
        puuid: seat.puuid,
        name: seat.puuid,
        side: seat.side,
        isSpectator: seat.side === null,
        mainRole: null,
        secondaryRole: null,
        roleOverride: null,
        mu: 25,
        sigma: 8.333,
        gamesTonight: 0,
        lastSitOutAt: null,
      };
    }

    function splitOf(blue: readonly Seat[], red: readonly Seat[]): Split {
      return {
        blue: blue.map((seat, index) => ({ puuid: seat.puuid, role: ROLES[index] ?? 'top' })),
        red: red.map((seat, index) => ({ puuid: seat.puuid, role: ROLES[index] ?? 'top' })),
        gap: 10,
        blueWinProb: 0.5,
        score: 10,
        offRoleCount: 0,
      };
    }

    /**
     * A lobby row with members, so `supersedeLobbyCommands` has somebody to look up.
     *
     * `idleMs` ages the row on the way in: `lobbies_set_updated_at` is a `before update`
     * trigger, so the clock the two-hour sweep reads can only be set by an insert. That is how
     * the sweep cases below run with the **real** `now` and still cannot touch a row that is not
     * genuinely stale, on a stack other agents are using.
     */
    async function lobbyWith(
      seats: readonly Seat[],
      status: 'balanced' | 'in_game',
      idleMs = 0,
    ): Promise<string> {
      const at = new Date(Date.now() - idleMs).toISOString();
      const { data, error } = await db
        .from('lobbies')
        .insert({
          lcu_party_id: `cq-${runId}-${randomUUID().slice(0, 8)}`,
          status,
          reported_by_player_id: seats[0]?.playerId ?? null,
          lobby_name: 'kustom night',
          created_at: at,
          updated_at: at,
        })
        .select('id')
        .single();
      if (error) throw new Error(`lobbyWith: ${error.message}`);
      lobbyIds.add(data.id);

      const { error: memberError } = await db.from('lobby_members').insert(
        seats.map((seat) => ({
          lobby_id: data.id,
          player_id: seat.playerId,
          side: seat.side,
          is_spectator: seat.side === null,
        })),
      );
      if (memberError) throw new Error(`lobbyWith: ${memberError.message}`);
      return data.id;
    }

    async function pendingFor(playerIds: readonly string[]): Promise<CompanionCommandRow[]> {
      const { data, error } = await db
        .from('companion_commands')
        .select('*')
        .in('target_player_id', [...playerIds])
        .in('status', ['pending', 'sent']);
      if (error) throw new Error(`pendingFor: ${error.message}`);
      return data ?? [];
    }

    /** Ten seats, each with a live companion token, the client's side as asked. */
    let cast: Seat[] = [];
    let castTokens: string[] = [];

    beforeAll(async () => {
      cast = [];
      castTokens = [];
      for (let index = 0; index < 10; index += 1) {
        const minted = await mint(`seat${index}`, { lastSeenAt: new Date() });
        cast.push({
          playerId: minted.playerId,
          puuid: puuidOf(`seat${index}`),
          side: index < 5 ? 100 : 200,
        });
        castTokens.push(minted.token);
      }
    });

    afterEach(async () => {
      await clearQueue(...cast.map((seat) => seat.playerId));
    });

    function eventFor(seats: readonly Seat[], lobbyId: string) {
      const blue = seats.slice(0, 5);
      const red = seats.slice(5, 10);
      return { lobbyId, split: splitOf(blue, red), playing: seats.map(poolMember) };
    }

    it('queues nothing at all while the verification gate is off', async () => {
      // Everyone on the wrong side: the most a balance could possibly ask for.
      const seats = cast.map((seat, index) => ({ ...seat, side: index < 5 ? 200 : 100 }) as Seat);
      const lobbyId = await lobbyWith(seats, 'balanced');

      const result = await queueSwitchSideForBalance(db, eventFor(seats, lobbyId), { gate: OFF });
      expect(result.moves).toHaveLength(10);
      expect(result.queued).toBe(0);
      expect(await pendingFor(seats.map((seat) => seat.playerId))).toEqual([]);
    });

    it('with the gate on, queues the mismatched seats only, with the split side and a 3-minute TTL', async () => {
      // Two people traded places; everybody else is where the split wants them.
      const seats = cast.map((seat, index) =>
        index === 4
          ? { ...seat, side: 200 as SideValue }
          : index === 9
            ? { ...seat, side: 100 as SideValue }
            : seat,
      );
      const lobbyId = await lobbyWith(seats, 'balanced');

      const now = new Date();
      const result = await queueSwitchSideForBalance(db, eventFor(seats, lobbyId), { now, gate: ON });
      expect(result.queued).toBe(2);

      const rows = await pendingFor(seats.map((seat) => seat.playerId));
      expect(rows).toHaveLength(2);
      const byPlayer = new Map(rows.map((r) => [r.target_player_id, r]));
      expect(byPlayer.get(seats[4]?.playerId ?? '')?.payload).toEqual({ targetSide: 100 });
      expect(byPlayer.get(seats[9]?.playerId ?? '')?.payload).toEqual({ targetSide: 200 });
      for (const r of rows) {
        expect(r.kind).toBe('switch_side');
        expect(Date.parse(r.expires_at) - now.getTime()).toBeLessThanOrEqual(
          COMPANION_COMMAND_TTL_MS.switch_side,
        );
        expect(Date.parse(r.expires_at) - now.getTime()).toBeGreaterThan(
          COMPANION_COMMAND_TTL_MS.switch_side - 5_000,
        );
      }
    });

    it('is the listener on the balanced hook, so a real balance is what fills the queue', async () => {
      // The seam itself (`lib/commands/register.ts`), called the way `emitLobbyBalanced` calls
      // it: with the whole event and no client, reading the service client from the
      // environment — and with no `gate` argument anywhere, so this is the **shipped** table in
      // `lib/commands/gate.ts`. It was the harmless-no-op case until the writes were verified
      // (16.18, 2026-09-12); now it is the case that proves the listener is wired up at all.
      const { commandLobbyHook } = await import('@/lib/commands/register');
      const seats = cast.map((seat, index) => ({ ...seat, side: index < 5 ? 200 : 100 }) as Seat);
      const lobbyId = await lobbyWith(seats, 'balanced');
      const { split, playing } = eventFor(seats, lobbyId);

      await commandLobbyHook.onBalanced?.({
        lobbyId,
        groupId: ORIGINAL_GROUP_ID,
        splitId: randomUUID(),
        rosterKey: seats.map((seat) => seat.puuid).join(','),
        split,
        explanation: 'a split',
        lobbyName: 'kustom night',
        lobbyPassword: null,
        sitters: [],
        seatMoves: [],
        tiedOnGames: true,
        playing,
      });

      // All ten are on the wrong side, so all ten are queued, each with the split's side.
      const rows = await pendingFor(seats.map((seat) => seat.playerId));
      expect(rows).toHaveLength(10);
      expect(rows.every((r) => r.kind === 'switch_side')).toBe(true);
      const byPlayer = new Map(rows.map((r) => [r.target_player_id, r.payload]));
      for (const [index, seat] of seats.entries()) {
        expect(byPlayer.get(seat.playerId), seat.puuid).toEqual({ targetSide: index < 5 ? 100 : 200 });
      }
    });

    it('never queues a spectator, or a friend whose companion was last seen eleven minutes ago', async () => {
      const stale = await mint('stale', {
        lastSeenAt: new Date(Date.now() - COMPANION_AROUND_MS - 60_000),
      });
      const seats: Seat[] = [
        // Blue: four of the cast on red (all wrong), plus the stale-token friend, also wrong.
        ...cast.slice(0, 4).map((seat) => ({ ...seat, side: 200 as SideValue })),
        { playerId: stale.playerId, puuid: puuidOf('stale'), side: 200 },
        // Red: four right, and a spectator with no side at all.
        ...cast.slice(5, 9),
        { playerId: cast[9]?.playerId ?? '', puuid: cast[9]?.puuid ?? '', side: null },
      ];
      const lobbyId = await lobbyWith(seats, 'balanced');

      const result = await queueSwitchSideForBalance(db, eventFor(seats, lobbyId), { gate: ON });
      // The spectator is not even a move: a toggle cannot seat them.
      expect(result.moves.map((move) => move.puuid)).toEqual([
        ...cast.slice(0, 4).map((seat) => seat.puuid),
        puuidOf('stale'),
      ]);
      // ...and the stale token is a move that is never written.
      expect(result.queued).toBe(4);
      const rows = await pendingFor([...seats.map((seat) => seat.playerId)]);
      expect(rows.map((r) => r.target_player_id).sort()).toEqual(
        cast
          .slice(0, 4)
          .map((seat) => seat.playerId)
          .sort(),
      );

      await clearQueue(stale.playerId);
    });

    it('supersedes the previous split rows in the same write as the new ones (the reroll case)', async () => {
      const first = cast.map((seat, index) => ({ ...seat, side: index < 5 ? 200 : 100 }) as Seat);
      const lobbyId = await lobbyWith(first, 'balanced');
      await queueSwitchSideForBalance(db, eventFor(first, lobbyId), { gate: ON });
      const before = await pendingFor(first.map((seat) => seat.playerId));
      expect(before).toHaveLength(10);

      // The group rerolls: the same ten, seats rotated by one, so eight of them still have to
      // move and two of them no longer do.
      const rerolled = [...first.slice(1), first[0] as Seat];
      const result = await queueSwitchSideForBalance(db, eventFor(rerolled, lobbyId), { gate: ON });
      expect(result.superseded).toBe(10);
      expect(result.queued).toBe(8);

      const after = await pendingFor(first.map((seat) => seat.playerId));
      // At most one pending row per player at any time, and nobody is left holding a row from
      // the split the group just rerolled away from.
      expect(after).toHaveLength(8);
      expect(new Set(after.map((r) => r.target_player_id)).size).toBe(8);
      expect(after.every((r) => !before.some((old) => old.id === r.id))).toBe(true);

      const { data } = await db
        .from('companion_commands')
        .select('error')
        .in(
          'id',
          before.map((r) => r.id),
        );
      expect((data ?? []).every((r) => r.error?.startsWith('superseded'))).toBe(true);
    });

    /**
     * Two splits of the same ten, the second one the mirror of the first, so a promotion always
     * changes somebody's side. Returns the lobby and the two split ids, rank order.
     */
    async function lobbyWithTwoSplits(
      seats: readonly Seat[],
    ): Promise<{ lobbyId: string; splitIds: [string, string] }> {
      const lobbyId = await lobbyWith(seats, 'balanced');
      const key = [...seats.map((seat) => seat.puuid)].sort().join(',');
      const first = splitOf(seats.slice(0, 5), seats.slice(5, 10));
      // The reroll: blue and red swapped, so every one of the ten changes side.
      const second = splitOf(seats.slice(5, 10), seats.slice(0, 5));

      const { data, error } = await db
        .from('splits')
        .insert(
          [first, second].map((split, index) => ({
            lobby_id: lobbyId,
            rank: index + 1,
            blue: split.blue as unknown as Json,
            red: split.red as unknown as Json,
            gap: split.gap,
            blue_win_prob: split.blueWinProb,
            score: split.score,
            off_role_count: split.offRoleCount,
            is_chosen: index === 0,
            explanation: `split ${index + 1}`,
            roster_key: key,
          })),
        )
        .select('id, rank')
        .order('rank', { ascending: true });
      if (error) throw new Error(`lobbyWithTwoSplits: ${error.message}`);

      const ids = (data ?? []).map((r) => r.id);
      if (ids[0] === undefined || ids[1] === undefined) throw new Error('two splits expected');
      return { lobbyId, splitIds: [ids[0], ids[1]] };
    }

    it('promoteSplit queues the promoted split and supersedes the previous one (the reroll)', async () => {
      // Blue's five are on blue, red's five on red: split 1 is what the client already shows,
      // so the first balance queued nothing and only the promotion has anything to say.
      const seats = cast.map((seat) => ({ ...seat }));
      const { lobbyId, splitIds } = await lobbyWithTwoSplits(seats);

      // Split 1's rows, as the `balanced` transition would have written them: everyone is
      // already where split 1 wants them, so this is the pending queue of an *earlier* split —
      // written here by hand so the supersede has something real to fail.
      const stale = await Promise.all(
        seats.map((seat) => queue(seat.playerId, 'switch_side', { targetSide: 100 })),
      );

      const promoted = await promoteSplit(db, { lobbyId, splitId: splitIds[1] }, { gate: ON });
      expect(promoted.ok).toBe(true);
      if (promoted.ok) {
        // The admin route's answer is untouched by any of this.
        expect(promoted.value).toEqual({
          splitId: splitIds[1],
          rank: 2,
          splitCount: 2,
          promoted: true,
        });
      }

      const { data: old } = await db.from('companion_commands').select('status, error').in('id', stale);
      expect((old ?? []).every((r) => r.status === 'failed')).toBe(true);
      expect((old ?? []).every((r) => r.error === 'superseded: another split was chosen')).toBe(true);

      // Split 2 is the mirror, so all ten are now on the wrong side and all ten are queued.
      const fresh = await pendingFor(seats.map((seat) => seat.playerId));
      expect(fresh).toHaveLength(10);
      expect(fresh.every((r) => !stale.includes(r.id))).toBe(true);
      const byPlayer = new Map(fresh.map((r) => [r.target_player_id, r.payload]));
      for (const [index, seat] of seats.entries()) {
        expect(byPlayer.get(seat.playerId), seat.puuid).toEqual({ targetSide: index < 5 ? 200 : 100 });
      }
    });

    it('promoteSplit writes nothing at all while the gate is off', async () => {
      const seats = cast.map((seat) => ({ ...seat }));
      const { lobbyId, splitIds } = await lobbyWithTwoSplits(seats);
      const stale = await Promise.all(
        seats.map((seat) => queue(seat.playerId, 'switch_side', { targetSide: 100 })),
      );

      // The gate off for every kind: a reroll must not write a row a companion cannot run.
      const promoted = await promoteSplit(db, { lobbyId, splitId: splitIds[1] }, { gate: OFF });
      expect(promoted.ok).toBe(true);

      const rows = await pendingFor(seats.map((seat) => seat.playerId));
      expect(rows.map((r) => r.id).sort()).toEqual([...stale].sort());
      expect(rows.every((r) => r.status === 'pending')).toBe(true);
    });

    it('supersedes the queue when the lobby goes in_game', async () => {
      const seats = cast.map((seat, index) => ({ ...seat, side: index < 5 ? 200 : 100 }) as Seat);
      const lobbyId = await lobbyWith(seats, 'balanced');
      await queueSwitchSideForBalance(db, eventFor(seats, lobbyId), { gate: ON });
      expect(await pendingFor(seats.map((s) => s.playerId))).toHaveLength(10);

      expect(await moveLobby(db, { lobbyId, from: ['balanced'], to: 'in_game' })).toBe(true);
      expect(await pendingFor(seats.map((s) => s.playerId))).toEqual([]);

      const { data } = await db
        .from('companion_commands')
        .select('status, error')
        .in(
          'target_player_id',
          seats.map((s) => s.playerId),
        );
      expect((data ?? []).every((r) => r.status === 'failed')).toBe(true);
      expect((data ?? []).every((r) => r.error === 'superseded: lobby is now in_game')).toBe(true);
    });

    it('supersedes the queue when the lobby is abandoned or dropped by the sweep', async () => {
      const seats = cast.map((seat, index) => ({ ...seat, side: index < 5 ? 200 : 100 }) as Seat);
      const idleMs = IDLE_ABANDON_MS + 60_000;

      for (const [status, expected] of [
        ['balanced', 'abandoned'],
        ['in_game', 'dropped'],
      ] as const) {
        const lobbyId = await lobbyWith(seats, status, idleMs);
        await queueSwitchSideForBalance(db, eventFor(seats, lobbyId), { gate: ON });
        expect(await pendingFor(seats.map((s) => s.playerId))).toHaveLength(10);

        await sweepIdleLobbies(db);

        const { data: lobby } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
        expect(lobby?.status, status).toBe(expected);
        expect(await pendingFor(seats.map((s) => s.playerId)), status).toEqual([]);

        const { data } = await db
          .from('companion_commands')
          .select('error')
          .in(
            'target_player_id',
            seats.map((s) => s.playerId),
          );
        expect((data ?? []).every((r) => r.error === `superseded: lobby is now ${expected}`)).toBe(true);
        await clearQueue(...seats.map((s) => s.playerId));
      }
    });

    it('leaves create_lobby and invite alone when a lobby leaves balanced', async () => {
      const seats = cast.map((seat) => ({ ...seat }));
      const lobbyId = await lobbyWith(seats, 'balanced');
      const invite = await queue(seats[0]?.playerId ?? '', 'invite', invitePayload());

      expect(await moveLobby(db, { lobbyId, from: ['balanced'], to: 'finished' })).toBe(true);
      expect((await row(invite)).status).toBe('pending');
    });
  });
}
