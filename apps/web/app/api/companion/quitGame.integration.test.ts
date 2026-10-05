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
 * The 2026-10-04 night (owner bug 2026-10-05), replayed through the real companion routes: a Rift
 * custom starts (`in_progress`), everybody quits it, no end-of-game block ever comes, so the lobby
 * stays `in_game` with the Rift lock and the Rift kickoff record. The same ten then play a custom
 * ARAM from the same party. Before the fix the ARAM's `in_progress` found the Rift lobby still
 * `in_game` and did nothing, and its block was stored **against the Rift lobby**: `lobby_id` of the
 * quit game's cycle, stamped with the Rift lock's mode and rule, and the Rift lobby `finished` by
 * it -- so Tonight showed the ARAM's result as the quit Rift game's, teams, odds and rule included.
 *
 * Fixed (decision in the route's header): an `in_progress` for a **different game id** on a lobby
 * already `in_game` with a kickoff for another game ends that cycle (`dropped`), and the new game is
 * stored with no lobby; an ARAM never rates and never takes a Rift rule, whatever lock it meets.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('a quit game followed by an ARAM against the local Supabase stack', () => {
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
  process.env.DISCORD_WEBHOOK_URL = '';

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-qg${index}`);
  const HOST = ten[0] ?? '';
  const groups = { g: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const tokens = { host: '' };
  const partyId = `it-${runId}-party`;

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  async function postMembers(puuids: readonly string[]) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: 'quit night',
          members: puuids.map((puuid, index) => ({
            puuid,
            gameName: `Q${index}`,
            tagLine: 'EUW',
            summonerId: 8_000 + index,
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        tokens.host,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string; status: string };
  }

  async function start(gameId: number, gameMode: string) {
    gameIds.push(gameId);
    const response = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId, gameMode }, tokens.host),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string | null };
  }

  async function postEog(puuids: readonly string[], gameId: number, startedAt: Date, gameMode: string) {
    gameIds.push(gameId);
    return postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId, puuids, startedAt: startedAt.toISOString(), raw: { gameMode } }),
        tokens.host,
      ),
    );
  }

  async function lobbyRow(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select('status, lock_mode, kickoff_kind, kickoff_game_mode')
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function gameRow(gameId: number) {
    const { data, error } = await db
      .from('games')
      .select('id, lobby_id, mode, rule, rated, rule_checked, game_mode')
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    const players = await db.from('game_players').select('player_id, mu_after').eq('game_id', data.id);
    if (players.error) throw new Error(players.error.message);
    return { ...data, players: players.data ?? [] };
  }

  async function ratingsSnapshot() {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games')
      .eq('group_id', groups.g)
      .order('player_id');
    if (error) throw new Error(error.message);
    return JSON.stringify(data ?? []);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    groups.g = (await createTestGroups(db, runId, ['qg'] as const)).qg;
    await pinTestGroupMode(db, groups.g, 'normal');
    await setTestMembership(db, groups.g, idOf.get(HOST) ?? '', 'owner');
    for (const puuid of ten.slice(1)) await setTestMembership(db, groups.g, idOf.get(puuid) ?? '', 'member');
    const minted = mintCompanionToken();
    const inserted = await db.from('companion_tokens').insert({
      player_id: idOf.get(HOST) ?? '',
      token_hash: minted.tokenHash,
      label: `qg-host-${runId}`,
      group_id: groups.g,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    tokens.host = minted.token;
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', ten);
  });

  it('a quit Rift game, then an ARAM with the same ten: the ARAM is never the Rift lobby’s, never rated, never a Rift rule', async () => {
    // The Rift game starts and is quit: no end-of-game block, ever.
    const { lobbyId: rift } = await postMembers(ten);
    const riftGame = testGameId();
    expect((await start(riftGame, 'CLASSIC')).lobbyId).toBe(rift);
    const atRiftStart = await lobbyRow(rift);
    expect(atRiftStart).toMatchObject({
      status: 'in_game',
      lock_mode: 'normal',
      kickoff_game_mode: 'CLASSIC',
    });
    const before = await ratingsSnapshot();

    // The ARAM, same party, same ten. Its lobby posts land on the frozen row (M2.9).
    expect((await postMembers(ten)).lobbyId).toBe(rift);
    const aramGame = testGameId();
    const aramStart = new Date();
    // ARAM: Mayhem, as on 2026-10-04 (`KIWI`).
    const started = await start(aramGame, 'KIWI');
    // The quit game's cycle is over: its lobby is not the ARAM's.
    expect(started.lobbyId).not.toBe(rift);
    expect((await lobbyRow(rift)).status).toBe('dropped');

    const answer = await postEog(ten, aramGame, aramStart, 'KIWI');
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as {
      created: boolean;
      lobbyId: string | null;
      rated: boolean;
      reason: string;
    };
    expect(body).toMatchObject({ created: true, rated: false, reason: 'game-mode' });
    expect(body.lobbyId).not.toBe(rift);
    const aram = await gameRow(aramGame);
    expect(aram.lobby_id).not.toBe(rift);
    expect(aram).toMatchObject({ rated: false, rule: null, rule_checked: false, game_mode: 'KIWI' });
    expect(aram.players).toHaveLength(10);
    expect(aram.players.every((row) => row.mu_after === null)).toBe(true);
    expect(await ratingsSnapshot()).toBe(before);
    // The quit game's lobby stays dropped (not finished by somebody else's game).
    expect((await lobbyRow(rift)).status).toBe('dropped');

    // A second companion's ARAM block: nothing moves.
    const repeat = await postEog(ten, aramGame, aramStart, 'KIWI');
    expect(((await repeat.json()) as { created: boolean }).created).toBe(false);
    expect(await ratingsSnapshot()).toBe(before);

    // The quit game's own block, late from a queue file: it still finishes its lobby (dropped ->
    // finished, M5.11), on its own lock.
    const late = await postEog(ten, riftGame, new Date(aramStart.getTime() - 30 * 60_000), 'CLASSIC');
    expect(late.status).toBe(200);
    expect(((await late.json()) as { lobbyId: string | null }).lobbyId).toBe(rift);
    expect((await lobbyRow(rift)).status).toBe('finished');
  });

  it('the ARAM start was never heard: its block alone refuses the Rift lobby by mode and drops it', async () => {
    const { lobbyId: rift } = await postMembers(ten);
    const riftGame = testGameId();
    expect((await start(riftGame, 'CLASSIC')).lobbyId).toBe(rift);
    const before = await ratingsSnapshot();

    // No in_progress for the ARAM (the companion restarted mid-game): only its block.
    const aramGame = testGameId();
    const answer = await postEog(ten, aramGame, new Date(), 'ARAM');
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { lobbyId: string | null; rated: boolean };
    expect(body).toMatchObject({ lobbyId: null, rated: false });
    expect((await gameRow(aramGame)).lobby_id).toBeNull();
    expect((await lobbyRow(rift)).status).toBe('dropped');
    expect(await ratingsSnapshot()).toBe(before);
  });

  it('the same mode twice (or a mode unknown) is unchanged: a Rift game after a quit Rift game still lands on the row', async () => {
    const { lobbyId } = await postMembers(ten);
    const first = testGameId();
    expect((await start(first, 'CLASSIC')).lobbyId).toBe(lobbyId);
    // An older companion names no mode: no evidence, nothing dropped.
    const second = testGameId();
    gameIds.push(second);
    const response = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId: second, partyId }, tokens.host),
    );
    expect(((await response.json()) as { lobbyId: string | null }).lobbyId).toBe(lobbyId);
    expect((await start(second, 'CLASSIC')).lobbyId).toBe(lobbyId);
    expect((await lobbyRow(lobbyId)).status).toBe('in_game');
    const answer = await postEog(ten, second, new Date(), 'CLASSIC');
    expect((await answer.json()) as { lobbyId: string | null; rated: boolean }).toMatchObject({
      lobbyId,
      rated: true,
    });
  });
}
