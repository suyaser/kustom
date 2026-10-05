import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M22.3 against the local stack: which Kustom is in which lobby (each token's current party,
 * `0050`) and which lobbies are live (`liveTables`, decision rows M22 D4 and D7), through the real
 * companion routes.
 *
 * Each scenario has a group of its own, so one scenario's tokens never watch another's tables.
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('live tables against the local Supabase stack', () => {
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

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');
  const { liveTables, TABLE_LINGER_MS } = await import('@/lib/liveTables');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const SCENES = ['same', 'two', 'move', 'gap', 'stop', 'linger'] as const;
  type Scene = (typeof SCENES)[number];
  const all = Array.from({ length: 12 }, (_, index) => `it-${runId}-lt${index}`);
  const ANA = all[0] ?? '';
  const BO = all[1] ?? '';
  const crew = all.slice(2, 10);
  const groups = {} as Record<Scene, string>;
  /** Bearer tokens and token ids, per scene and host. */
  const tokens = {} as Record<Scene, Record<'ana' | 'bo', { bearer: string; id: string }>>;
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const party = (name: string) => `it-${runId}-party-${name}`;

  type Member = { puuid: string; side: 100 | 200 | null; isSpectator: boolean };
  const sided = (puuids: readonly string[]): Member[] =>
    puuids.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200, isSpectator: false }));

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  async function post(partyId: string, members: readonly Member[], bearer: string) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `tables ${partyId.slice(-6)}`,
          members: members.map((member) => ({
            puuid: member.puuid,
            gameName: `P${all.indexOf(member.puuid)}`,
            tagLine: 'EUW',
            summonerId: 8_000 + all.indexOf(member.puuid),
            side: member.side,
            isSpectator: member.isSpectator,
          })),
        },
        bearer,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string; status: string; created: boolean };
  }

  async function status(lobbyId: string) {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  async function tables(scene: Scene, now = new Date()) {
    return liveTables(db, groups[scene], now);
  }

  /** Every lobby and token row of the scene's group: the "nothing written" check. */
  async function rowsOf(scene: Scene) {
    const [lobbies, tokenRows] = await Promise.all([
      db.from('lobbies').select('*').eq('group_id', groups[scene]).order('created_at'),
      db.from('companion_tokens').select('*').eq('group_id', groups[scene]).order('id'),
    ]);
    if (lobbies.error) throw new Error(lobbies.error.message);
    if (tokenRows.error) throw new Error(tokenRows.error.message);
    return { lobbies: lobbies.data, tokens: tokenRows.data };
  }

  async function tokenParty(scene: Scene, host: 'ana' | 'bo') {
    const { data, error } = await db
      .from('companion_tokens')
      .select('current_party_id, current_party_at')
      .eq('id', tokens[scene][host].id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function seen(scene: Scene, host: 'ana' | 'bo', at: Date) {
    const { error } = await db
      .from('companion_tokens')
      .update({ last_seen_at: at.toISOString() })
      .eq('id', tokens[scene][host].id);
    if (error) throw new Error(error.message);
  }

  const watcherIds = (table: { watchers: { tokenId: string }[] } | undefined) =>
    (table?.watchers ?? []).map((watcher) => watcher.tokenId).sort();

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    const made = await createTestGroups(db, runId, SCENES.map((scene) => `lt${scene}`) as `lt${Scene}`[]);
    for (const scene of SCENES) {
      const groupId = made[`lt${scene}`];
      groups[scene] = groupId;
      await pinTestGroupMode(db, groupId, 'normal');
      await setTestMembership(db, groupId, idOf.get(ANA) ?? '', 'owner');
      await setTestMembership(db, groupId, idOf.get(BO) ?? '', 'member');
      const pair = {} as Record<'ana' | 'bo', { bearer: string; id: string }>;
      for (const [host, puuid] of [
        ['ana', ANA],
        ['bo', BO],
      ] as const) {
        const minted = mintCompanionToken();
        const inserted = await db
          .from('companion_tokens')
          .insert({
            player_id: idOf.get(puuid) ?? '',
            token_hash: minted.tokenHash,
            label: `lt-${scene}-${host}-${runId}`,
            group_id: groupId,
          })
          .select('id')
          .single();
        if (inserted.error) throw new Error(inserted.error.message);
        pair[host] = { bearer: minted.token, id: inserted.data.id };
      }
      tokens[scene] = pair;
    }
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', all);
  });

  it('two Kustoms in one custom: one table, both watching, and a repeat writes nothing', async () => {
    const t = tokens.same;
    const X = party('same-x');
    const first = await post(X, sided([ANA, BO, ...crew]), t.ana.bearer);
    const second = await post(X, sided([ANA, BO, ...crew]), t.bo.bearer);
    expect(second.lobbyId).toBe(first.lobbyId);
    expect(await tokenParty('same', 'ana')).toMatchObject({ current_party_id: X });
    expect(await tokenParty('same', 'bo')).toMatchObject({ current_party_id: X });

    const live = await tables('same');
    expect(live).toHaveLength(1);
    expect(live[0]?.partyId).toBe(X);
    expect(live[0]?.lobby.id).toBe(first.lobbyId);
    expect(watcherIds(live[0])).toEqual([t.ana.id, t.bo.id].sort());
    expect(live[0]?.label.hostPlayerId).toBe(idOf.get(ANA));

    // M19.8: the same post from both Kustoms, again and again: no lobby row, no token row moves.
    const before = await rowsOf('same');
    for (let i = 0; i < 2; i += 1) {
      await post(X, sided([ANA, BO, ...crew]), t.ana.bearer);
      await post(X, sided([ANA, BO, ...crew]), t.bo.bearer);
    }
    expect(await rowsOf('same')).toEqual(before);
  });

  it('two customs: two tables, one watcher each, labelled by their first reporter', async () => {
    const t = tokens.two;
    const X = party('two-x');
    const Y = party('two-y');
    const x = await post(X, sided([ANA, ...crew.slice(0, 4)]), t.ana.bearer);
    const y = await post(Y, sided([BO, ...crew.slice(4)]), t.bo.bearer);

    const live = await tables('two');
    expect(live.map((table) => table.lobby.id)).toEqual([x.lobbyId, y.lobbyId]);
    expect(watcherIds(live[0])).toEqual([t.ana.id]);
    expect(watcherIds(live[1])).toEqual([t.bo.id]);
    expect(live.map((table) => table.label.hostPlayerId)).toEqual([idOf.get(ANA), idOf.get(BO)]);
    expect(await status(x.lobbyId)).toBe('open');
    expect(await status(y.lobbyId)).toBe('open');
  });

  it('a host moving between customs: the old table goes only when nobody else is in it', async () => {
    const t = tokens.move;
    const X = party('move-x');
    const Y = party('move-y');
    // Ana reports X; Bo's Kustom is in X too.
    const x = await post(X, sided([ANA, BO, ...crew.slice(0, 3)]), t.ana.bearer);
    await post(X, sided([ANA, BO, ...crew.slice(0, 3)]), t.bo.bearer);

    // Ana moves to Y: Bo's Kustom is still in X, so X stays.
    const y = await post(Y, sided([ANA]), t.ana.bearer);
    expect(await status(x.lobbyId)).toBe('open');
    let live = await tables('move');
    expect(live.map((table) => table.partyId)).toEqual([X, Y]);
    expect(watcherIds(live[0])).toEqual([t.bo.id]);
    expect(watcherIds(live[1])).toEqual([t.ana.id]);

    // Bo follows. X was Ana's (its first reporter), not Bo's: before M22.3 nothing let it go.
    // Bo's Kustom held X, and nobody is in it now, so it goes.
    await post(Y, sided([ANA, BO]), t.bo.bearer);
    expect(await status(x.lobbyId)).toBe('abandoned');
    expect(await status(y.lobbyId)).toBe('open');
    live = await tables('move');
    expect(live.map((table) => table.partyId)).toEqual([Y]);
    expect(watcherIds(live[0])).toEqual([t.ana.id, t.bo.id].sort());
  });

  it("M22.1's co-host gap: a co-host whose Kustom moved first no longer keeps the left lobby", async () => {
    const t = tokens.gap;
    const A = party('gap-a');
    const B = party('gap-b');
    const a = await post(A, sided([ANA, BO, ...crew.slice(0, 3)]), t.ana.bearer);
    await post(A, sided([ANA, BO, ...crew.slice(0, 3)]), t.bo.bearer);

    // Bo's Kustom gets to B first: Ana's Kustom is still in A, so A stays.
    await post(B, sided([BO]), t.bo.bearer);
    expect(await status(a.lobbyId)).toBe('open');

    // Ana's Kustom follows. Bo still sits on A's roster with his Kustom up, which kept A alive
    // under M22.1; his Kustom said B after taking that seat, so he is not in A.
    await post(B, sided([BO, ANA]), t.ana.bearer);
    expect(await status(a.lobbyId)).toBe('abandoned');
    expect((await tables('gap')).map((table) => table.partyId)).toEqual([B]);
  });

  it('a Kustom that stops: watched until HOST_WINDOW_MS passes, then the two-hour sweep as before', async () => {
    const t = tokens.stop;
    const X = party('stop-x');
    const Y = party('stop-y');
    const x = await post(X, sided([ANA, ...crew.slice(0, 3)]), t.ana.bearer);
    expect(watcherIds((await tables('stop'))[0])).toEqual([t.ana.id]);

    // Ana's Kustom goes quiet. Nine minutes on, still watched; eleven, nobody.
    const now = Date.now();
    await seen('stop', 'ana', new Date(now - 9 * 60_000));
    expect(watcherIds((await tables('stop'))[0])).toEqual([t.ana.id]);
    await seen('stop', 'ana', new Date(now - 11 * 60_000));
    let live = await tables('stop');
    expect(live.map((table) => table.lobby.id)).toEqual([x.lobbyId]);
    expect(live[0]?.watchers).toEqual([]);

    // Somebody else's posts let nothing go and do not touch X: Ana's Kustom never said it left, and
    // X's `updated_at` (the two-hour sweep's clock, `sweepIdleLobbies`, proven by staleLobby and
    // oneLobby (g)) runs exactly as before M22.3.
    const before = await db.from('lobbies').select('*').eq('id', x.lobbyId).single();
    await post(Y, sided([BO]), t.bo.bearer);
    await post(Y, sided([BO, ...crew.slice(4, 6)]), t.bo.bearer);
    const after = await db.from('lobbies').select('*').eq('id', x.lobbyId).single();
    expect(after.data).toEqual(before.data);
    expect(after.data?.status).toBe('open');
    live = await tables('stop');
    expect(live.map((table) => table.partyId)).toEqual([X, Y]);
    expect(live[0]?.watchers).toEqual([]);
  });

  it('a finished table lingers 20 minutes, its next cycle keeps the first reporter as host', async () => {
    const t = tokens.linger;
    const X = party('linger-x');
    const ten = [ANA, BO, ...crew];
    const first = await post(X, sided(ten), t.ana.bearer);
    const gameId = testGameId() + 31;
    gameIds.push(gameId);
    const eog = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId: X, puuids: ten, startedAt: new Date().toISOString() }),
        t.ana.bearer,
      ),
    );
    expect(eog.status).toBe(200);
    expect(await status(first.lobbyId)).toBe('finished');

    // The walk back: still live, the finished row is the newest.
    expect((await tables('linger')).map((table) => table.lobby.id)).toEqual([first.lobbyId]);
    // Past the linger with no next cycle: ended.
    expect(await tables('linger', new Date(Date.now() + TABLE_LINGER_MS + 1_000))).toEqual([]);

    // Bo's Kustom posts the next cycle first: a new row, Bo its reporter, Ana still the host.
    const second = await post(X, sided(ten), t.bo.bearer);
    expect(second.created).toBe(true);
    const live = await tables('linger');
    expect(live.map((table) => table.lobby.id)).toEqual([second.lobbyId]);
    expect(live[0]?.lobby.reportedByPlayerId).toBe(idOf.get(BO));
    expect(live[0]?.label.hostPlayerId).toBe(idOf.get(ANA));
  });
}
