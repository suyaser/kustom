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
 * M21.11 against the local stack: a game matched to a stale lobby, through the real companion
 * routes.
 *
 * The 2026-10-02 night (lobby 422e74e0), replayed: a party's lobby of thirteen (ten sided, three
 * spectators) starts a game whose end-of-game block never comes (a remake, a companion that died),
 * so the row stays `in_game` with its roster frozen. The next rotation's lobby posts land on that
 * frozen row and change nothing, the next game starts, and its block resolved by the clock to the
 * frozen row -- five sided members who never played, five spectators or unsided members who did.
 *
 * Fixed: the block matches a lobby only when every sided member of it played. This one is stored
 * with no lobby (and still rated on its own sides), the frozen row is dropped so the party's next
 * post opens a fresh cycle, and the lost game's own block, arriving late, still finishes it.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('a game matched to a stale lobby against the local Supabase stack', () => {
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

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 15 }, (_, index) => `it-${runId}-st${index}`);
  /** The first game's ten: sided in the lobby. */
  const ten = all.slice(0, 10);
  /** Spectators in the lobby. */
  const spectators = all.slice(10, 13);
  /** In the lobby with no side. */
  const unsided = all.slice(13);
  const HOST = ten[0] ?? '';
  /** Sided in the first game's lobby, sat out the second game. */
  const SAT_OUT = ten[5] ?? '';
  /** The second game: five of the sided ten and the five who were not sided. */
  const secondTen = [...ten.slice(0, 5), ...spectators, ...unsided];
  const groups = { g: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const tokens = { host: '', satOut: '' };
  const partyId = `it-${runId}-party`;

  type Member = { puuid: string; side: 100 | 200 | null; isSpectator: boolean };

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  const sided = (puuids: readonly string[]): Member[] =>
    puuids.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200, isSpectator: false }));

  /** The 2026-10-02 roster: ten sided, three spectators, two with no side. */
  const firstRoster: Member[] = [
    ...sided(ten),
    ...spectators.map((puuid) => ({ puuid, side: null, isSpectator: true })),
    ...unsided.map((puuid) => ({ puuid, side: null, isSpectator: false })),
  ];
  /** The rotation: the second ten sided, the five who sat out watching. */
  const secondRoster: Member[] = [
    ...sided(secondTen),
    ...ten.slice(5).map((puuid) => ({ puuid, side: null, isSpectator: true })),
  ];

  async function postMembers(members: readonly Member[]) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: 'stale night',
          members: members.map((member) => ({
            puuid: member.puuid,
            gameName: `P${all.indexOf(member.puuid)}`,
            tagLine: 'EUW',
            summonerId: 9_000 + all.indexOf(member.puuid),
            side: member.side,
            isSpectator: member.isSpectator,
          })),
        },
        tokens.host,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string; status: string };
  }

  async function start(gameId: number) {
    const response = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, tokens.host),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string | null };
  }

  async function postEog(puuids: readonly string[], gameId: number, startedAt: Date, token = tokens.host) {
    gameIds.push(gameId);
    return postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId, puuids, startedAt: startedAt.toISOString() }),
        token,
      ),
    );
  }

  async function lobbyRow(lobbyId: string) {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function memberPuuids(lobbyId: string) {
    const { data, error } = await db
      .from('lobby_members')
      .select('players!inner(puuid)')
      .eq('lobby_id', lobbyId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.players.puuid).sort();
  }

  async function gameRow(gameId: number) {
    const { data, error } = await db
      .from('games')
      .select('id, lobby_id, group_id')
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    const players = await db.from('game_players').select('player_id, side, mu_after').eq('game_id', data.id);
    if (players.error) throw new Error(players.error.message);
    return { ...data, players: players.data ?? [] };
  }

  async function partyLobbies() {
    const { data, error } = await db
      .from('lobbies')
      .select('id, status')
      .eq('lcu_party_id', partyId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    groups.g = (await createTestGroups(db, runId, ['st'] as const)).st;
    await pinTestGroupMode(db, groups.g, 'normal');
    await setTestMembership(db, groups.g, idOf.get(HOST) ?? '', 'owner');
    for (const puuid of all.slice(1)) await setTestMembership(db, groups.g, idOf.get(puuid) ?? '', 'member');
    for (const [key, puuid] of [
      ['host', HOST],
      ['satOut', SAT_OUT],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `st-${key}-${runId}`,
        group_id: groups.g,
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

  it('stores the second game with no lobby, drops the frozen row, and the lost game still finishes it', async () => {
    // The first game: thirteen in the lobby, ten sided, started, never reported.
    const { lobbyId: frozen } = await postMembers(firstRoster);
    const firstGame = testGameId();
    expect((await start(firstGame)).lobbyId).toBe(frozen);
    expect((await lobbyRow(frozen)).status).toBe('in_game');
    // The night's clock, 61 minutes between the frozen roster and the next start, as on 2026-10-02.
    // Backdated with the service role so `started_at` against `created_at` does not depend on how
    // fast the test runs.
    const now = Date.now();
    const backdated = await db
      .from('lobbies')
      .update({ created_at: new Date(now - 90 * 60_000).toISOString() })
      .eq('id', frozen);
    expect(backdated.error).toBeNull();
    const firstStart = new Date(now - 85 * 60_000);
    const secondStart = new Date(now - 24 * 60_000);

    // The rotation's lobby post lands on the frozen row and changes nothing: the root cause's
    // first half, unchanged by M21.11 (a frozen roster is history, M2.9).
    const rotated = await postMembers(secondRoster);
    expect(rotated.lobbyId).toBe(frozen);
    expect(rotated.status).toBe('in_game');
    expect(await memberPuuids(frozen)).toEqual([...all].sort());

    // The second game starts: the party's live row is still the frozen one.
    const secondGame = testGameId();
    expect((await start(secondGame)).lobbyId).toBe(frozen);

    // A sided member of the frozen roster who sat this game out is not a member of the lobby it was
    // played from: before M21.11 the frozen row let this token report it.
    const refused = await postEog(secondTen, secondGame, secondStart, tokens.satOut);
    expect(refused.status).toBe(403);
    expect((await db.from('games').select('id').eq('lcu_game_id', secondGame)).data).toEqual([]);

    // The host's block: stored with no lobby (before M21.11: lobby_id = the frozen row, which it
    // then moved to `finished`), rated on its own sides, in the token's group.
    const answer = await postEog(secondTen, secondGame, secondStart);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { created: boolean; lobbyId: string | null; rated: boolean };
    expect(body).toMatchObject({ created: true, lobbyId: null, rated: true });
    const second = await gameRow(secondGame);
    expect(second.lobby_id).toBeNull();
    expect(second.group_id).toBe(groups.g);
    expect(second.players).toHaveLength(10);
    const sideOf = new Map(second.players.map((row) => [row.player_id, row.side]));
    secondTen.forEach((puuid, index) => {
      expect(sideOf.get(idOf.get(puuid) ?? '')).toBe(index < 5 ? 100 : 200);
    });
    expect(second.players.every((row) => row.mu_after !== null)).toBe(true);
    // The frozen row is another game's lobby, and that game is over: dropped, not finished.
    expect((await lobbyRow(frozen)).status).toBe('dropped');

    // A second companion's identical block: nothing moves.
    const repeat = await postEog(secondTen, secondGame, secondStart);
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as { created: boolean }).created).toBe(false);
    expect((await gameRow(secondGame)).players).toHaveLength(10);
    expect((await lobbyRow(frozen)).status).toBe('dropped');
    expect(await partyLobbies()).toHaveLength(1);

    // The party's next post opens a fresh cycle instead of landing on the frozen roster.
    const fresh = await postMembers(secondRoster);
    expect(fresh.lobbyId).not.toBe(frozen);
    expect(fresh.status).toBe('open');
    expect(await memberPuuids(fresh.lobbyId)).toEqual([...all].sort());

    // The lost first game's block, from a queue file: its ten are the frozen row's sided ten, so it
    // matches that row and finishes it (dropped -> finished, M5.11), and the fresh cycle is untouched.
    const late = await postEog(ten, firstGame, firstStart);
    expect(late.status).toBe(200);
    expect(((await late.json()) as { lobbyId: string | null }).lobbyId).toBe(frozen);
    expect((await gameRow(firstGame)).lobby_id).toBe(frozen);
    expect((await lobbyRow(frozen)).status).toBe('finished');
    expect((await lobbyRow(fresh.lobbyId)).status).toBe('open');
  });

  it('still matches a lobby whose sided ten played, with a spectator watching', async () => {
    const { lobbyId } = await postMembers(sided(ten));
    // The previous scenario left the party's fresh cycle open; this post replaces its roster.
    await postMembers([...sided(ten), { puuid: spectators[0] ?? '', side: null, isSpectator: true }]);
    const gameId = testGameId();
    expect((await start(gameId)).lobbyId).toBe(lobbyId);
    const answer = await postEog(ten, gameId, new Date());
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { lobbyId: string | null }).lobbyId).toBe(lobbyId);
    expect((await lobbyRow(lobbyId)).status).toBe('finished');
  });
}
