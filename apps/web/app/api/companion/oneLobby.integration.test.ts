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
import { rollForTest } from '@/lib/testing/roll';

/**
 * M22.1 against the local stack: a host's Kustom is in one lobby at a time (decision row M22 D6).
 *
 * The owner's night, replayed through the real companion routes: two hosts in one group each open
 * a custom, Bo's (B) first and Ana's (A) second, so A is the newer row and Tonight draws it. Ana
 * leaves A and joins B. Before M22.1 nothing ended A (the client's lobby `Delete` posts nothing)
 * and Tonight stayed on A through B's whole game. Now Ana's post for B lets A go, and Tonight
 * follows her to B.
 *
 * Then the edge cases of the task: a rolled lobby's lock goes back to the card, a co-host still in
 * the left lobby keeps it, a post about another group's party still lets go, repeated posts write
 * nothing, a party's own next cycle lets nothing go, and a sweep plus a let-go bump once.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('one lobby per Kustom against the local Supabase stack', () => {
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
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { tonightState } = await import('@/lib/tonight/state');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { readStartLobbyState } = await import('@/lib/lobbyStart');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 22 }, (_, index) => `it-${runId}-ol${index}`);
  const BO = all[0] ?? '';
  const ANA = all[10] ?? '';
  /** Another group's host (case d). */
  const ZED = all[20] ?? '';
  /** In Bo's custom with him from the start. */
  const boCrew = all.slice(1, 9);
  /** In Ana's custom with her. */
  const anaCrew = all.slice(11, 15);
  /** Ana and nine friends: a rollable lobby. */
  const anaTen = all.slice(10, 20);
  const groups = { g: '', h: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const tokens = { bo: '', ana: '', zed: '' };
  const party = (name: string) => `it-${runId}-party-${name}`;

  type Member = { puuid: string; side: 100 | 200 | null; isSpectator: boolean };

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  const sided = (puuids: readonly string[]): Member[] =>
    puuids.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200, isSpectator: false }));

  async function post(partyId: string, members: readonly Member[], token: string) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `one lobby ${partyId.slice(-6)}`,
          members: members.map((member) => ({
            puuid: member.puuid,
            gameName: `P${all.indexOf(member.puuid)}`,
            tagLine: 'EUW',
            summonerId: 9_000 + all.indexOf(member.puuid),
            side: member.side,
            isSpectator: member.isSpectator,
          })),
        },
        token,
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

  async function liveVersion(groupId: string): Promise<number> {
    const { data, error } = await db
      .from('group_live')
      .select('version')
      .eq('group_id', groupId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.version ?? 0;
  }

  /** Every lobby row of the group: the row-count check for repeated posts. */
  async function groupLobbies(groupId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select('id, status, updated_at')
      .eq('group_id', groupId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function drawn(groupId = groups.g) {
    const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId });
    return { snapshot, id: snapshot.lobby?.id ?? null, state: tonightState(snapshot) };
  }

  async function cardRow(groupId = groups.g) {
    const { data, error } = await db
      .from('group_modes')
      .select('pending_rule, pending_region_blue, pending_region_red')
      .eq('group_id', groupId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function seen(key: keyof typeof tokens, at: Date | null) {
    const { error } = await db
      .from('companion_tokens')
      .update({ last_seen_at: at === null ? null : at.toISOString() })
      .eq('label', `ol-${key}-${runId}`);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    const made = await createTestGroups(db, runId, ['olg', 'olh'] as const);
    groups.g = made.olg;
    groups.h = made.olh;
    for (const groupId of [groups.g, groups.h]) await pinTestGroupMode(db, groupId, 'normal');
    await setTestMembership(db, groups.g, idOf.get(ANA) ?? '', 'owner');
    await setTestMembership(db, groups.g, idOf.get(BO) ?? '', 'member');
    await setTestMembership(db, groups.h, idOf.get(ZED) ?? '', 'owner');
    for (const [key, puuid, groupId] of [
      ['bo', BO, groups.g],
      ['ana', ANA, groups.g],
      ['zed', ZED, groups.h],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `ol-${key}-${runId}`,
        group_id: groupId,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', all);
  });

  it("the owner's scene: Tonight follows Ana from her custom to Bo's and A is abandoned", async () => {
    const B = party('b');
    const A = party('a');

    // Bo opens B first: Tonight draws B.
    const b = await post(B, sided([BO, ...boCrew]), tokens.bo);
    expect((await drawn()).id).toBe(b.lobbyId);

    // Ana opens A second: A is newer, so Tonight draws A (today's rule, unchanged).
    const a = await post(A, sided([ANA, ...anaCrew]), tokens.ana);
    expect((await drawn()).id).toBe(a.lobbyId);
    expect(await status(b.lobbyId)).toBe('open');

    // Ana leaves A and joins B. Her post for B lets A go; one bump for the roster write and the let-go.
    const before = await liveVersion(groups.g);
    const joined = await post(B, sided([BO, ...boCrew, ANA]), tokens.ana);
    expect(joined.lobbyId).toBe(b.lobbyId);
    expect(await liveVersion(groups.g)).toBe(before + 1);
    expect(await status(a.lobbyId)).toBe('abandoned');
    expect(await status(b.lobbyId)).toBe('open');
    const filling = await drawn();
    expect(filling.id).toBe(b.lobbyId);
    expect(filling.state.kind).toBe('filling');
    expect(filling.snapshot.lobby?.members.map((member) => member.puuid).sort()).toEqual(
      [BO, ...boCrew, ANA].sort(),
    );

    // Start a lobby refuses on B, the live lobby, and no longer on A.
    const start = await readStartLobbyState(db, { groupId: groups.g });
    expect(start.liveLobbyId).toBe(b.lobbyId);

    // B's game starts: Tonight shows B in game.
    const gameId = testGameId();
    const started = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId: B }, tokens.bo),
    );
    expect(started.status).toBe(200);
    const inGame = await drawn();
    expect(inGame.id).toBe(b.lobbyId);
    expect(inGame.snapshot.lobby?.status).toBe('in_game');
    expect(inGame.state.kind).toBe('in-game');

    // B's result is the primary block, and A is nowhere on the tape.
    gameIds.push(gameId);
    const eog = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId: B, puuids: [BO, ...boCrew, ANA], startedAt: new Date().toISOString() }),
        tokens.bo,
      ),
    );
    expect(eog.status).toBe(200);
    const result = await drawn();
    expect(result.id).toBe(b.lobbyId);
    expect(result.state.kind).toBe('result');
    expect(result.snapshot.tape.map((entry) => entry.lobbyId)).not.toContain(a.lobbyId);
    expect(await status(a.lobbyId)).toBe('abandoned');
  });

  it('(b) a rolled lobby let go hands its region wars lock back to the card', async () => {
    const { error } = await db
      .from('group_modes')
      .update({ pending_rule: 'region', pending_region_blue: 'demacia', pending_region_red: 'noxus' })
      .eq('group_id', groups.g);
    expect(error).toBeNull();

    const rolled = await post(party('rolled'), sided(anaTen), tokens.ana);
    await rollForTest(db, rolled.lobbyId);
    expect(await status(rolled.lobbyId)).toBe('balanced');
    expect(await cardRow()).toMatchObject({ pending_rule: null, pending_region_blue: null });

    const elsewhere = await post(party('elsewhere'), sided([ANA]), tokens.ana);
    expect(await status(rolled.lobbyId)).toBe('abandoned');
    expect(await cardRow()).toEqual({
      pending_rule: 'region',
      pending_region_blue: 'demacia',
      pending_region_red: 'noxus',
    });
    const { data: lock } = await db
      .from('lobbies')
      .select('lock_rule, lock_region_blue, lock_region_red, locked_at')
      .eq('id', rolled.lobbyId)
      .single();
    expect(lock).toEqual({ lock_rule: null, lock_region_blue: null, lock_region_red: null, locked_at: null });

    // (e) The same post again and again: nothing to let go, nothing written, no bump.
    const rows = await groupLobbies(groups.g);
    const version = await liveVersion(groups.g);
    for (let i = 0; i < 3; i += 1) {
      expect((await post(party('elsewhere'), sided([ANA]), tokens.ana)).lobbyId).toBe(elsewhere.lobbyId);
    }
    expect(await groupLobbies(groups.g)).toEqual(rows);
    expect(await liveVersion(groups.g)).toBe(version);

    // Leave the card as the other scenarios expect it.
    await db
      .from('group_modes')
      .update({ pending_rule: null, pending_region_blue: null, pending_region_red: null })
      .eq('group_id', groups.g);
  });

  it('(c) a co-host whose Kustom is still in the left lobby keeps it; once his Kustom is gone, it goes', async () => {
    const shared = await post(party('shared'), sided([ANA, BO, ...anaCrew]), tokens.ana);
    await seen('bo', new Date());

    const version = await liveVersion(groups.g);
    const next = await post(party('next'), sided([ANA]), tokens.ana);
    expect(await status(shared.lobbyId)).toBe('open');
    // Only the new lobby's own writes bumped.
    expect(await liveVersion(groups.g)).toBe(version + 1);

    // A token unseen for longer than HOST_WINDOW_MS is not a Kustom in the lobby.
    await seen('bo', new Date(Date.now() - 11 * 60_000));
    await post(party('next'), sided([ANA]), tokens.ana);
    expect(await status(shared.lobbyId)).toBe('abandoned');
    expect(await status(next.lobbyId)).toBe('open');
  });

  it("(d) Ana's post about another group's party still lets her own lobby go", async () => {
    const foreign = party('foreign');
    const zeds = await post(foreign, sided([ZED]), tokens.zed);
    const mine = await post(party('mine'), sided([ANA, ...anaCrew]), tokens.ana);

    const answer = await post(foreign, sided([ZED, ANA]), tokens.ana);
    // The foreign no-op, as before: Zed's lobby, untouched.
    expect(answer).toMatchObject({ lobbyId: zeds.lobbyId, created: false });
    const { count } = await db
      .from('lobby_members')
      .select('player_id', { count: 'exact', head: true })
      .eq('lobby_id', zeds.lobbyId);
    expect(count).toBe(1);
    // Ana is not in her lobby any more.
    expect(await status(mine.lobbyId)).toBe('abandoned');
    // Group h's lobby is never a let-go candidate of group g's token.
    expect(await status(zeds.lobbyId)).toBe('open');
  });

  it("(f) Ana's own party across cycles lets nothing go", async () => {
    const own = party('own');
    const first = await post(own, sided(anaTen), tokens.ana);
    const gameId = testGameId() + 1;
    gameIds.push(gameId);
    const eog = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId: own, puuids: anaTen, startedAt: new Date().toISOString() }),
        tokens.ana,
      ),
    );
    expect(eog.status).toBe(200);
    expect(await status(first.lobbyId)).toBe('finished');

    const second = await post(own, sided(anaTen), tokens.ana);
    expect(second.created).toBe(true);
    expect(second.lobbyId).not.toBe(first.lobbyId);
    expect(await status(first.lobbyId)).toBe('finished');
    expect(await status(second.lobbyId)).toBe('open');
  });

  it('(g) a sweep and a let-go in the same request bump once', async () => {
    const left = await post(party('left'), sided([ANA, ...anaCrew]), tokens.ana);
    // Inserted after that post, whose own sweep would have taken it.
    const idle = await db
      .from('lobbies')
      .insert({
        group_id: groups.g,
        lcu_party_id: party('idle'),
        reported_by_player_id: idOf.get(BO) ?? null,
        status: 'open',
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000 - 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (idle.error) throw new Error(idle.error.message);

    const version = await liveVersion(groups.g);
    await post(party('arrived'), sided([ANA]), tokens.ana);
    expect(await status(idle.data.id)).toBe('abandoned');
    expect(await status(left.lobbyId)).toBe('abandoned');
    expect(await liveVersion(groups.g)).toBe(version + 1);
  });

  it('in_game is never touched', async () => {
    const playing = party('playing');
    const lobby = await post(playing, sided(anaTen), tokens.ana);
    const gameId = testGameId() + 2;
    const started = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId: playing }, tokens.ana),
    );
    expect(started.status).toBe(200);
    expect(await status(lobby.lobbyId)).toBe('in_game');

    await post(party('after'), sided([ANA]), tokens.ana);
    expect(await status(lobby.lobbyId)).toBe('in_game');
  });
}
