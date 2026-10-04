import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { groupLiveFilter, groupLiveRowSchema } from '@customs/db/schemas';
import { createClient, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import type { MeAuthResult } from '@/lib/me/identity';
import { eogBody, lobbyBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { expectBumpedLast, installWriteRecorder, type RecordedWrite } from '@/lib/testing/writeRecorder';

/**
 * M19.8 and M19.9 against the local stack, through the real route handlers.
 *
 * - **Bumps last (M19.9 acceptance 3).** Every write route in the M19.9 list runs once with a
 *   recording `fetch` under every Supabase client in this file: the request must make exactly the
 *   expected `bump_group_live` call, once per group, and every other write must have finished
 *   before it started (`lib/testing/writeRecorder.ts`). A request that wrote nothing must bump
 *   nothing: the same lobby twice, the same eog twice, a roll whose teams were already up, a mode
 *   it already was, a role it already had, a join of a member.
 * - **A lobby post that changed nothing writes nothing (M19.8 acceptance 2).** The same post twice:
 *   no write request at all to `lobbies`, `lobby_members`, `players` or `group_memberships`, and no
 *   `group_live` event; one side change: exactly one `lobby_members` row written and exactly one
 *   `group_live` event. (M19.8 also counted `lobby_members` events; since M19.11 (`0044`) that
 *   table is in no publication, so the write recorder is what proves the one row.)
 * - **One eog, one signal (M19.9 acceptance 2).** An eog gives exactly one `group_live` event, and
 *   when it arrives the game, its ten players with their ratings, and the group's ratings are all
 *   readable with the anon key; the same block again gives none.
 *
 * The routes run in the order a night does, in one scratch group, so each one's preconditions are
 * the previous one's result. Skipped without the stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the live signal against the local Supabase stack (M19.8, M19.9)', () => {
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
  process.env.CRON_SECRET = `live-cron-${randomUUID()}`;

  // Before any client exists: supabase-js takes `fetch` when a client is built.
  const recorder = installWriteRecorder(stack.url);

  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { ackRoute } = await import('@/app/api/companion/commands/[id]/settle');
  const { rollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/roll/handler');
  const { rerollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/reroll/handler');
  const { setGroupModeRoute } = await import('@/app/api/admin/mode/handler');
  const { fearlessResetRoute } = await import('@/app/api/admin/fearless/reset/handler');
  const { ratingsResetRoute } = await import('@/app/api/admin/ratings/reset/handler');
  const { memberRoleRoute } = await import('@/app/api/admin/members/role/handler');
  const { memberRemoveRoute } = await import('@/app/api/admin/members/remove/handler');
  const { ownerTransferRoute } = await import('@/app/api/admin/owner/transfer/handler');
  const { memberUnlinkDiscordRoute } = await import('@/app/api/admin/members/unlink-discord/handler');
  const { startLobbyRoute } = await import('@/app/api/me/lobbies/start/handler');
  const { roleTonightRoute } = await import('@/app/api/me/role-tonight/handler');
  const { selfLinkRoute } = await import('@/app/api/me/link/handler');
  const { joinGroupRoute } = await import('@/app/api/groups/join/handler');
  const { GET: cronSweep } = await import('@/app/api/cron/sweep/route');
  const { GET: cronRebuild } = await import('@/app/api/cron/rebuild/route');
  const { runRebuildCommand } = await import('@/lib/ingest/rebuildCommand');
  const { rebuildAllGroups } = await import('@/lib/ingest/rebuild');
  const { lobbyRosterKey } = await import('@/lib/ingest/lobby');
  const { ensurePlayers } = await import('@/lib/ingest/players');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `lv-${runId}-p${index}`);
  const joiner = `lv-${runId}-joiner`;
  const linkme = `lv-${runId}-linkme`;
  const allPuuids = [...ten, joiner, linkme];
  const ids = new Map<string, string>();
  const id = (puuid: string): string => {
    const value = ids.get(puuid);
    if (value === undefined) throw new Error(`no player for ${puuid}`);
    return value;
  };
  const p = (index: number): string => ten[index] as string;

  let A = '';
  let B = '';
  let slugA = '';
  let token = '';
  let lobbyId = '';
  const partyId = `lv-${runId}-party`;
  const gameId = testGameId();
  const backfillGameId = gameId + 1;

  /** Run one request and return what it wrote. */
  async function recorded<T>(run: () => Promise<T>): Promise<{ result: T; writes: RecordedWrite[] }> {
    const mark = recorder.mark();
    const result = await run();
    return { result, writes: recorder.since(mark) };
  }

  function companion(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  function json(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function cron(path: string): Request {
    return new Request(`http://localhost/api/cron/${path}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
  }

  /** The admin gate, answered for `puuid` as an admin of whatever group the body names. */
  function asAdmin(puuid: string) {
    return {
      authorize: async (
        _request: Request,
        _client: unknown,
        groupId: string | null,
      ): Promise<AdminAuthResult> => ({
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
    };
  }

  /** The `/api/me/*` session step, answered for `puuid` (or a session with no player). */
  function asMe(puuid: string | null, discordId = `8${Date.now()}${Math.floor(Math.random() * 1e6)}`) {
    return {
      authorize: async (): Promise<MeAuthResult> => ({
        ok: true,
        me: {
          userId: randomUUID(),
          discordId,
          player: puuid === null ? null : { playerId: id(puuid), puuid },
        },
      }),
    };
  }

  function membersBody(
    sideOf: (index: number) => 100 | 200 = (i) => (i < 5 ? 100 : 200),
    extra: string[] = [],
  ) {
    return lobbyBody({
      partyId,
      members: [
        ...ten.map((puuid, index) => ({ puuid, side: sideOf(index) })),
        ...extra.map((puuid) => ({ puuid })),
      ],
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Realtime: one anon channel for the whole file, on this group's live row.
  // ---------------------------------------------------------------------------------------------

  type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;
  const liveEvents: Payload[] = [];
  let wake: () => void = () => {};
  function until(label: string, done: () => boolean, timeoutMs = 45_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wake = () => {};
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      const check = () => {
        if (!done()) return;
        clearTimeout(timer);
        wake = () => {};
        resolve();
      };
      wake = check;
      check();
    });
  }
  const kindOf = (event: Payload) => (event.new as { kind?: string }).kind;

  /** Subscribe and prove the stream is live with nudges of A's live row (sentinel kind `roster`). */
  async function openChannel(): Promise<void> {
    const sawNudge = () => liveEvents.some((event) => kindOf(event) === 'roster');
    const nudger = setInterval(() => {
      void db.rpc('bump_group_live', { p_group: A, p_kind: 'roster' }).then(() => undefined);
    }, 1_000);
    try {
      for (let attempt = 1; !sawNudge(); attempt += 1) {
        const next = anon.channel(`it-live-routes-${runId}-${attempt}`);
        let ok = false;
        next.on('system', {}, (message: { extension?: string; status?: string }) => {
          if (message.extension === 'postgres_changes' && message.status === 'ok') {
            ok = true;
            wake();
          }
        });
        next.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_live', filter: groupLiveFilter(A) },
          (e) => {
            liveEvents.push(e);
            wake();
          },
        );
        const subscribed = until('the subscription', () => ok, 30_000);
        next.subscribe();
        await subscribed;
        const last = attempt === 4;
        const heard = await until('a warm-up bump', sawNudge, last ? 30_000 : 15_000).then(
          () => true,
          (error: unknown) => {
            if (last) throw error;
            return false;
          },
        );
        if (!heard) await anon.removeChannel(next);
      }
    } finally {
      clearInterval(nudger);
    }
  }

  /** A sentinel bump of A, waited for: every event a request before it caused has arrived. */
  async function drain(): Promise<void> {
    const before = liveEvents.length;
    const { error } = await db.rpc('bump_group_live', { p_group: A, p_kind: 'roster' });
    expect(error).toBeNull();
    await until('the sentinel', () => liveEvents.slice(before).some((event) => kindOf(event) === 'roster'));
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['a', 'b']);
    A = groups.a;
    B = groups.b;
    slugA = `it-${runId}-a`;
    const players = await ensurePlayers(
      db,
      allPuuids.map((puuid) => ({ puuid })),
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
      label: 'live test',
      last_seen_at: new Date().toISOString(),
    });
    expect(inserted.error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    recorder.restore();
    await anon.removeAllChannels();
    await db.from('group_invites').delete().in('group_id', [A, B]);
    await deleteTestGroups(db, [A, B]);
    await db.from('players').delete().in('puuid', allPuuids);
  });

  describe('the live signal against the local Supabase stack (M19.8, M19.9)', () => {
    it('lobby post: a new lobby bumps `lobby` once, last', async () => {
      const { result, writes } = await recorded(() => postLobby(companion('lobby', membersBody())));
      expect(result.status).toBe(200);
      lobbyId = ((await result.json()) as { lobbyId: string }).lobbyId;
      expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
    });

    it('lobby post (M19.8): the same post writes nothing and sends no event; one side change writes one row and sends one', async () => {
      await openChannel();
      const liveBefore = liveEvents.length;

      const same = await recorded(() => postLobby(companion('lobby', membersBody())));
      expect(same.result.status).toBe(200);
      const sameWrites = expectBumpedLast(same.writes, [], { groups: [A, B] });
      // What is left is the route's door, not the ingest: the idle sweep's two statements (they
      // match only lobbies two hours idle, none of them this one) and at most the token's
      // `last_seen_at`. No lobby, member, player or membership write request at all.
      const ingest = sameWrites.filter((write) => {
        const status = (write.body as { status?: string } | null)?.status;
        const sweep = write.target === 'lobbies' && (status === 'abandoned' || status === 'dropped');
        return !sweep && write.target !== 'companion_tokens';
      });
      expect(ingest.map((write) => `${write.method} ${write.target}`)).toEqual([]);

      // One friend crosses to red: exactly one `lobby_members` row, one upsert of one row.
      const swap = await recorded(() =>
        postLobby(
          companion(
            'lobby',
            membersBody((i) => (i < 4 ? 100 : 200)),
          ),
        ),
      );
      expect(swap.result.status).toBe(200);
      const swapWrites = expectBumpedLast(swap.writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
      const memberWrites = swapWrites.filter((write) => write.target === 'lobby_members');
      expect(memberWrites).toHaveLength(1);
      expect(memberWrites[0]?.body).toEqual([expect.objectContaining({ player_id: id(p(4)), side: 200 })]);

      // Realtime delivers in WAL order: once the swap's own event is here, an event from the
      // repeated post would already have arrived before it.
      await until('the swap on group_live', () =>
        liveEvents.slice(liveBefore).some((e) => kindOf(e) === 'lobby'),
      );
      await drain();
      expect(liveEvents.slice(liveBefore).filter((event) => kindOf(event) === 'lobby')).toHaveLength(1);
    }, 300_000);

    it('roll: teams up bumps `split` last; the same press again bumps nothing', async () => {
      const route = rollRoute(lobbyId, asAdmin(p(1)));
      const body = { groupId: A, rosterKey: lobbyRosterKey(ten) };
      const first = await recorded(() => route(json(`admin/lobbies/${lobbyId}/roll`, body)));
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'split' }]);

      const again = await recorded(() => route(json(`admin/lobbies/${lobbyId}/roll`, body)));
      expect(again.result.status).toBe(200);
      expect(((await again.result.json()) as { outcome: string }).outcome).toBe('already_rolled');
      expectBumpedLast(again.writes, []);
    });

    it('reroll: another split up bumps `split` last; the same split again bumps nothing', async () => {
      const { data } = await db.from('splits').select('id').eq('lobby_id', lobbyId).eq('rank', 2).single();
      const route = rerollRoute(lobbyId, asAdmin(p(1)));
      const body = { groupId: A, splitId: data?.id };
      const first = await recorded(() => route(json(`admin/lobbies/${lobbyId}/reroll`, body)));
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'split' }]);

      const again = await recorded(() => route(json(`admin/lobbies/${lobbyId}/reroll`, body)));
      expect(again.result.status).toBe(200);
      expectBumpedLast(again.writes, []);
    });

    it('in_progress: the lobby going in_game bumps `lobby` last; a repeat bumps nothing', async () => {
      const body = { phase: 'in_progress', gameId, partyId };
      const first = await recorded(() => postGame(companion('game', body)));
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });

      const again = await recorded(() => postGame(companion('game', body)));
      expectBumpedLast(again.writes, [], { groups: [A, B] });
    });

    it('eog: one `game` event, after the game, its players and its ratings are readable; the same block again sends none', async () => {
      const liveBefore = liveEvents.length;
      let readAtSignal: { game: number; rated: number; ratings: number } | null = null;
      const onSignal = new Promise<void>((resolve) => {
        const check = async () => {
          if (!liveEvents.slice(liveBefore).some((event) => kindOf(event) === 'game')) return;
          // Read the moment the signal lands, as a page would: anon key, public columns.
          const game = await anon.from('games').select('id').eq('lcu_game_id', gameId);
          const gameRow = game.data?.[0]?.id ?? '';
          const rated = await anon
            .from('game_players')
            .select('player_id')
            .eq('game_id', gameRow)
            .not('mu_after', 'is', null);
          const ratings = await anon
            .from('ratings')
            .select('player_id')
            .eq('group_id', A)
            .in('player_id', ten.map(id));
          readAtSignal = {
            game: game.data?.length ?? 0,
            rated: rated.data?.length ?? 0,
            ratings: ratings.data?.length ?? 0,
          };
          resolve();
        };
        const previous = wake;
        wake = () => {
          previous();
          void check();
        };
      });

      const body = eogBody({
        gameId,
        puuids: ten,
        partyId,
        startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
      });
      const first = await recorded(() => postGame(companion('game', body)));
      expect(first.result.status).toBe(200);
      expect(await first.result.json()).toMatchObject({ created: true, rated: true });
      const writes = expectBumpedLast(first.writes, [{ groupId: A, kind: 'game' }], { groups: [A, B] });
      expect(writes.map((write) => write.target)).toEqual(
        expect.arrayContaining(['games', 'game_players', 'ratings', 'lobbies']),
      );

      await onSignal;
      expect(readAtSignal).toEqual({ game: 1, rated: 10, ratings: 10 });

      const again = await recorded(() => postGame(companion('game', body)));
      expect(again.result.status).toBe(200);
      expectBumpedLast(again.writes, [], { groups: [A, B] });
      await drain();
      expect(liveEvents.slice(liveBefore).filter((event) => kindOf(event) === 'game')).toHaveLength(1);
      for (const event of liveEvents) groupLiveRowSchema.parse(event.new);
    }, 300_000);

    it('backfill: a stored backfilled game bumps `game` last; a repeat bumps nothing', async () => {
      const { partyId: _none, ...body } = eogBody({
        gameId: backfillGameId,
        puuids: ten,
        startedAt: '2026-08-01T20:00:00.000Z',
      }) as Record<string, unknown> & { partyId: unknown };
      const backfill = { ...body, source: 'backfill' };
      const first = await recorded(() => postGame(companion('game', backfill)));
      expect(first.result.status).toBe(200);
      expect(await first.result.json()).toMatchObject({ created: true, rated: false });
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'game' }], { groups: [A, B] });

      const again = await recorded(() => postGame(companion('game', backfill)));
      expectBumpedLast(again.writes, [], { groups: [A, B] });
    });

    it('cron rebuild: a group whose fold wrote bumps `ratings` once, after every group', async () => {
      // The rebuild's guard refuses a group with a game in the last fifteen minutes.
      await db
        .from('games')
        .update({ created_at: new Date(Date.now() - 60 * 60_000).toISOString() })
        .eq('group_id', A);
      const { result, writes } = await recorded(() => cronRebuild(cron('rebuild')));
      expect(result.status).toBe(200);
      const lines = ((await result.json()) as { groups: { groupId: string; status: string }[] }).groups;
      expect(lines.find((line) => line.groupId === A)?.status).toBe('rated');
      expectBumpedLast(writes, [{ groupId: A, kind: 'ratings' }], { groups: [A, B] });
    }, 120_000);

    it('rebuild-ratings: a fold that writes bumps `ratings` last; an unchanged database bumps nothing', async () => {
      const run = () =>
        runRebuildCommand(
          ['--group', slugA, '--force'],
          { NEXT_PUBLIC_SUPABASE_URL: stack.url, SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey },
          {
            createClient: (url, key) => createClient<Database>(url, key, { auth: { persistSession: false } }),
            rebuildAllGroups,
            now: () => Date.now(),
            out: () => {},
            err: () => {},
          },
        );
      const unchanged = await recorded(run);
      expect(unchanged.result).toBe(0);
      expectBumpedLast(unchanged.writes, []);

      // Drift one stored rating column: the rebuild puts it back, which is a write.
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', gameId).single();
      await db
        .from('game_players')
        .update({ mu_after: 1 })
        .eq('game_id', game?.id ?? '')
        .eq('player_id', id(p(0)));
      const fixed = await recorded(run);
      expect(fixed.result).toBe(0);
      expectBumpedLast(fixed.writes, [{ groupId: A, kind: 'ratings' }]);
    }, 120_000);

    it('mode: a new mode bumps `mode` last; the mode it already is bumps nothing', async () => {
      const route = setGroupModeRoute(asAdmin(p(1)));
      const first = await recorded(() => route(json('admin/mode', { groupId: A, mode: 'normal' })));
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'mode' }]);

      const again = await recorded(() => route(json('admin/mode', { groupId: A, mode: 'normal' })));
      expect(again.result.status).toBe(200);
      expectBumpedLast(again.writes, []);

      const rated = await recorded(() => route(json('admin/mode', { groupId: A, rated: false })));
      expect(rated.result.status).toBe(200);
      expectBumpedLast(rated.writes, [{ groupId: A, kind: 'mode' }]);
    });

    it('fearless reset bumps `mode` last', async () => {
      const { result, writes } = await recorded(() =>
        fearlessResetRoute(asAdmin(p(1)))(json('admin/fearless/reset', { groupId: A })),
      );
      expect(result.status).toBe(200);
      expectBumpedLast(writes, [{ groupId: A, kind: 'mode' }]);
    });

    it('ratings reset bumps `ratings` last', async () => {
      const { result, writes } = await recorded(() =>
        ratingsResetRoute(asAdmin(p(0)))(json('admin/ratings/reset', { groupId: A, confirmSlug: slugA })),
      );
      expect(result.status).toBe(200);
      expectBumpedLast(writes, [{ groupId: A, kind: 'ratings' }]);
    });

    it('cron sweep: a group with a lobby swept bumps `lobby` once, last', async () => {
      const stale = await db
        .from('lobbies')
        .insert({
          group_id: A,
          lcu_party_id: `lv-${runId}-stale`,
          updated_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        })
        .select('id')
        .single();
      expect(stale.error).toBeNull();
      const { result, writes } = await recorded(() => cronSweep(cron('sweep')));
      expect(result.status).toBe(200);
      expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }], { groups: [A, B] });
    });

    it('start a lobby bumps `lobby` last, and so does the create_lobby ack', async () => {
      await db.from('companion_tokens').update({ last_seen_at: new Date().toISOString() }).eq('group_id', A);
      const start = await recorded(() =>
        startLobbyRoute({
          ...asMe(p(2)),
          start: { gate: { create_lobby: true, invite: true, switch_side: false } },
        })(json('me/lobbies/start', { groupId: A })),
      );
      expect(start.result.status).toBe(200);
      const { commandId } = (await start.result.json()) as { commandId: string };
      expectBumpedLast(start.writes, [{ groupId: A, kind: 'lobby' }]);

      const ack = await recorded(() =>
        ackRoute(commandId)(
          companion(`commands/${commandId}/ack`, {
            result: { partyId: `lv-${runId}-next`, lobbyName: 'next' },
          }),
        ),
      );
      expect(ack.result.status).toBe(200);
      expectBumpedLast(ack.writes, [{ groupId: A, kind: 'lobby' }]);
    });

    it('role for tonight bumps `lobby` last', async () => {
      // The night's next cycle, with somebody to link later in it.
      const posted = await postLobby(
        companion(
          'lobby',
          lobbyBody({ partyId: `lv-${runId}-next`, members: [...ten, linkme].map((puuid) => ({ puuid })) }),
        ),
      );
      expect(posted.status).toBe(200);
      const next = ((await posted.json()) as { lobbyId: string }).lobbyId;

      const { result, writes } = await recorded(() =>
        roleTonightRoute(asMe(p(2)))(json('me/role-tonight', { groupId: A, lobbyId: next, role: 'mid' })),
      );
      expect(result.status).toBe(200);
      expectBumpedLast(writes, [{ groupId: A, kind: 'lobby' }]);
    });

    it('member role and owner transfer bump `roster` last only when they changed something', async () => {
      const role = memberRoleRoute(asAdmin(p(0)));
      const first = await recorded(() =>
        role(json('admin/members/role', { groupId: A, playerId: id(p(3)), role: 'admin' })),
      );
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'roster' }]);
      const again = await recorded(() =>
        role(json('admin/members/role', { groupId: A, playerId: id(p(3)), role: 'admin' })),
      );
      expect(again.result.status).toBe(200);
      expectBumpedLast(again.writes, []);

      const transfer = await recorded(() =>
        ownerTransferRoute(asAdmin(p(0)))(json('admin/owner/transfer', { groupId: A, playerId: id(p(1)) })),
      );
      expect(transfer.result.status).toBe(200);
      expectBumpedLast(transfer.writes, [{ groupId: A, kind: 'roster' }]);
    });

    it('member removal and Discord unlink bump `roster` last', async () => {
      const removed = await recorded(() =>
        memberRemoveRoute(asAdmin(p(1)))(json('admin/members/remove', { groupId: A, playerId: id(p(9)) })),
      );
      expect(removed.result.status).toBe(200);
      expectBumpedLast(removed.writes, [{ groupId: A, kind: 'roster' }]);

      await db
        .from('players')
        .update({ discord_id: `7${Date.now()}` })
        .eq('id', id(p(5)));
      const unlinked = await recorded(() =>
        memberUnlinkDiscordRoute(asAdmin(p(1)))(
          json('admin/members/unlink-discord', { groupId: A, playerId: id(p(5)) }),
        ),
      );
      expect(unlinked.result.status).toBe(200);
      expectBumpedLast(unlinked.writes, [{ groupId: A, kind: 'roster' }]);
    });

    it('join bumps `roster` last for a new member and nothing for a member', async () => {
      const code = randomBytes(16).toString('base64url');
      expect((await db.from('group_invites').insert({ group_id: A, code })).error).toBeNull();
      const join = joinGroupRoute({ ...asMe(joiner) });
      const first = await recorded(() => join(json('groups/join', { code })));
      expect(first.result.status).toBe(200);
      expectBumpedLast(first.writes, [{ groupId: A, kind: 'roster' }]);
      const again = await recorded(() => join(json('groups/join', { code })));
      expect(again.result.status).toBe(200);
      expectBumpedLast(again.writes, []);
    });

    it('self link bumps `roster` last', async () => {
      const { result, writes } = await recorded(() =>
        selfLinkRoute(asMe(null))(json('me/link', { groupId: A, puuid: linkme })),
      );
      expect(result.status).toBe(200);
      expectBumpedLast(writes, [{ groupId: A, kind: 'roster' }]);
    });
  });
}
