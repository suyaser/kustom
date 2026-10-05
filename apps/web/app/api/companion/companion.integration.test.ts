import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The companion routes against the Supabase CLI local stack: the same route handlers Next
 * runs, the same service-role client, the same SQL constraints.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`), so `pnpm -r test`
 * stays green on a machine without Docker. Every row it creates is namespaced with a run id
 * and deleted afterwards, so reruns pass.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('companion routes against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  // The route handlers build their client from the environment, exactly as they do on Vercel.
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  // Bootstrapping an admin is M1.6's story; keep it out of this run.
  process.env.BOOTSTRAP_ADMIN_PUUID = '';

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');
  const { POST: postRank } = await import('./rank/route');
  const { GET: getMe } = await import('./me/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const outsiderPuuid = `it-${runId}-outsider`;
  const spectatorPuuid = `it-${runId}-spectator`;
  const rankPuuid = `it-${runId}-rank`;
  const allPuuids = [...puuids, outsiderPuuid, spectatorPuuid, rankPuuid];

  const partyId = `it-party-${runId}`;
  const otherPartyId = `it-party-${runId}-b`;
  // One party per case that moves a roster around, so the ten-player lobby the game tests
  // read stays as it was left.
  const spectatorPartyId = `it-party-${runId}-spec`;
  const emptyPartyId = `it-party-${runId}-empty`;
  const frozenPartyId = `it-party-${runId}-frozen`;
  const unknownPartyId = `it-party-${runId}-unknown`;
  const botPartyId = `it-party-${runId}-bots`;
  const ranksPartyId = `it-party-${runId}-ranks`;
  const cyclePartyId = `it-party-${runId}-cycle`;
  const oldCyclePartyId = `it-party-${runId}-old-cycle`;
  const watchedPartyId = `it-party-${runId}-watched`;
  const allPartyIds = [
    partyId,
    otherPartyId,
    spectatorPartyId,
    emptyPartyId,
    frozenPartyId,
    unknownPartyId,
    botPartyId,
    ranksPartyId,
    cyclePartyId,
    oldCyclePartyId,
    watchedPartyId,
  ];
  const gameId = testGameId();
  const rejectedGameId = gameId + 1;
  const scrubGameId = gameId + 2;
  const namedGameId = gameId + 3;
  const cycleGameId = gameId + 4;
  const oldCycleGameId = gameId + 5;
  const watchedGameId = gameId + 6;
  const gameIds = [
    gameId,
    rejectedGameId,
    scrubGameId,
    namedGameId,
    cycleGameId,
    oldCycleGameId,
    watchedGameId,
  ];

  let ownerToken = '';
  let outsiderToken = '';
  let revokedToken = '';
  let spectatorToken = '';

  async function mintToken(puuid: string, label: string, revoked = false): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const playerId = ids.get(puuid);
    if (playerId === undefined) throw new Error(`no player for ${puuid}`);

    const { token, tokenHash } = mintCompanionToken();
    const { error } = await db.from('companion_tokens').insert({
      group_id: ORIGINAL_GROUP_ID,
      player_id: playerId,
      token_hash: tokenHash,
      label,
      revoked_at: revoked ? new Date().toISOString() : null,
    });
    if (error) throw new Error(`mintToken: ${error.message}`);
    return token;
  }

  function post(body: unknown, token: string | null): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  function lobbyBody(
    members: readonly string[],
    spectators: readonly string[] = [],
    party: string = partyId,
  ): unknown {
    return {
      partyId: party,
      lobbyName: 'customs night',
      lobbyPassword: '1234',
      members: [
        ...members.map((puuid, index) => ({
          puuid,
          gameName: `Player${index}`,
          tagLine: 'EUW',
          // A JSON number, which is what the client reports (M2.10, point 1).
          summonerId: 1000 + index,
          side: index < 5 ? 100 : 200,
          isSpectator: false,
        })),
        ...spectators.map((puuid) => ({ puuid, side: null, isSpectator: true })),
      ],
    };
  }

  function get(token: string | null): Request {
    const headers: Record<string, string> = {};
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return new Request('http://localhost/api/companion/me', { method: 'GET', headers });
  }

  async function countLobbies(party: string): Promise<number> {
    const { count, error } = await db
      .from('lobbies')
      .select('id', { count: 'exact', head: true })
      .eq('lcu_party_id', party);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function memberRows(lobbyId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await db
      .from('lobby_members')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function lobbyRow(party: string): Promise<Record<string, unknown>> {
    const { data, error } = await db.from('lobbies').select('*').eq('lcu_party_id', party).single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setStatus(
    lobbyId: string,
    status: 'open' | 'balanced' | 'in_game' | 'finished' | 'abandoned',
  ): Promise<void> {
    // Drives one row, by id: a party can hold several rows over a night (M2.14) and only one
    // of them may be live at a time.
    const { error } = await db.from('lobbies').update({ status }).eq('id', lobbyId);
    if (error) throw new Error(error.message);
  }

  async function lobbyRowsForParty(party: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await db
      .from('lobbies')
      .select('*')
      .eq('lcu_party_id', party)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function countMembers(lobbyId: string): Promise<number> {
    const { count, error } = await db
      .from('lobby_members')
      .select('player_id', { count: 'exact', head: true })
      .eq('lobby_id', lobbyId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function countGames(lcuGameId: number): Promise<number> {
    const { count, error } = await db
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('lcu_game_id', lcuGameId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function gamePlayerRows(gameRowId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await db
      .from('game_players')
      .select('*')
      .eq('game_id', gameRowId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    ownerToken = await mintToken(puuids[0] ?? '', `it-${runId}-owner`);
    outsiderToken = await mintToken(outsiderPuuid, `it-${runId}-outsider`);
    revokedToken = await mintToken(`${outsiderPuuid}-revoked`, `it-${runId}-revoked`, true);
    spectatorToken = await mintToken(spectatorPuuid, `it-${runId}-spectator`);
    allPuuids.push(`${outsiderPuuid}-revoked`);
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await db.from('lobbies').delete().in('lcu_party_id', allPartyIds);
    await db.from('players').delete().in('puuid', allPuuids);
  });

  describe('POST /api/companion/lobby', () => {
    it('creates the lobby, its members and the players, then changes nothing on a repeat', async () => {
      const body = lobbyBody(puuids, [spectatorPuuid]);

      const first = await postLobby(post(body, ownerToken));
      expect(first.status).toBe(200);
      const firstJson = await first.json();
      expect(firstJson).toMatchObject({ ok: true, created: true, status: 'open', memberCount: 11 });

      const lobbyId = firstJson.lobbyId as string;
      expect(await countLobbies(partyId)).toBe(1);
      expect(await countMembers(lobbyId)).toBe(11);

      const { data: before } = await db.from('lobbies').select('*').eq('id', lobbyId).single();
      const { data: membersBefore } = await db
        .from('lobby_members')
        .select('*')
        .eq('lobby_id', lobbyId)
        .order('player_id');

      const second = await postLobby(post(body, ownerToken));
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true, created: false, lobbyId, memberCount: 11 });

      expect(await countLobbies(partyId)).toBe(1);
      expect(await countMembers(lobbyId)).toBe(11);

      const { data: after } = await db.from('lobbies').select('*').eq('id', lobbyId).single();
      const { data: membersAfter } = await db
        .from('lobby_members')
        .select('*')
        .eq('lobby_id', lobbyId)
        .order('player_id');

      // Not one column moved, updated_at included.
      expect(after).toEqual(before);
      expect(membersAfter).toEqual(membersBefore);
    });

    it('records who reported it from the token, not from the body', async () => {
      const { data: lobby } = await db
        .from('lobbies')
        .select('reported_by_player_id')
        .eq('lcu_party_id', partyId)
        .single();
      const { data: owner } = await db
        .from('players')
        .select('id')
        .eq('puuid', puuids[0] ?? '')
        .single();

      expect(lobby?.reported_by_player_id).toBe(owner?.id);
    });

    it('replaces the member list when someone leaves', async () => {
      const response = await postLobby(post(lobbyBody(puuids.slice(0, 6)), ownerToken));
      const json = await response.json();

      expect(json.memberCount).toBe(6);
      expect(await countMembers(json.lobbyId as string)).toBe(6);

      // Put the full roster back for the game tests below.
      await postLobby(post(lobbyBody(puuids, [spectatorPuuid]), ownerToken));
      expect(await countMembers(json.lobbyId as string)).toBe(11);
    });

    it('answers 403 and changes no row when the caller is not in the posted members', async () => {
      const lobbyId = (await lobbyRow(partyId)).id as string;
      const before = await lobbyRow(partyId);
      const membersBefore = await memberRows(lobbyId);
      expect(membersBefore).toHaveLength(11);

      // The M1.8 failure verified on 2026-09-08: a token for a player in no lobby posted this
      // party with one member and the roster dropped from eleven rows to one.
      const response = await postLobby(post(lobbyBody(puuids.slice(0, 1)), outsiderToken));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: 'a companion may only report a lobby it is in',
      });
      expect(await lobbyRow(partyId)).toEqual(before);
      expect(await memberRows(lobbyId)).toEqual(membersBefore);
    });

    it('answers 403 for an empty member list from an outsider', async () => {
      const lobbyId = (await lobbyRow(partyId)).id as string;
      const membersBefore = await memberRows(lobbyId);

      // An empty list cannot contain the caller, so "everyone left" from a stranger is a 403.
      const response = await postLobby(post(lobbyBody([], [], partyId), outsiderToken));

      expect(response.status).toBe(403);
      expect(await memberRows(lobbyId)).toEqual(membersBefore);
    });

    it('does not create an unknown party for a caller who is not in the list', async () => {
      const response = await postLobby(post(lobbyBody(puuids, [], unknownPartyId), outsiderToken));

      expect(response.status).toBe(403);
      expect(await countLobbies(unknownPartyId)).toBe(0);
    });

    it('accepts a caller listed as a spectator', async () => {
      const response = await postLobby(
        post(lobbyBody(puuids.slice(0, 4), [spectatorPuuid], spectatorPartyId), spectatorToken),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({ ok: true, created: true, memberCount: 5, rosterFrozen: false });
      expect(await countMembers(json.lobbyId as string)).toBe(5);

      // The spectator's Kustom goes back to the main lobby, so the owner's posts about other
      // parties below do not let it go (M22.3: a Kustom is in the party it last posted, M22 D7).
      const back = await postLobby(post(lobbyBody(puuids, [spectatorPuuid]), spectatorToken));
      expect(back.status).toBe(200);
      expect(await back.json()).toMatchObject({ created: false, memberCount: 11 });
    });

    it('accepts an empty list from the companion that reported the lobby', async () => {
      // The "everyone left" report: the caller is no longer in its own list, but it owns the
      // lobby row, which is the fallback M1.8 keeps for a client that stops listing it.
      const created = await postLobby(post(lobbyBody(puuids.slice(0, 3), [], emptyPartyId), ownerToken));
      const lobbyId = (await created.json()).lobbyId as string;
      expect(await countMembers(lobbyId)).toBe(3);

      const response = await postLobby(post(lobbyBody([], [], emptyPartyId), ownerToken));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, memberCount: 0, rosterFrozen: false });
      expect(await countMembers(lobbyId)).toBe(0);
    });

    it('freezes the roster once the lobby leaves open, and thaws nothing on the way back', async () => {
      const created = await postLobby(post(lobbyBody(puuids, [], frozenPartyId), ownerToken));
      const lobbyId = (await created.json()).lobbyId as string;
      const membersBefore = await memberRows(lobbyId);
      expect(membersBefore).toHaveLength(10);

      // M2.5 will do this; until then the test drives the status.
      await setStatus(lobbyId, 'in_game');

      // A companion that reconnects mid-game and posts a partial list changes nothing.
      const partial = await postLobby(post(lobbyBody(puuids.slice(0, 3), [], frozenPartyId), ownerToken));
      expect(partial.status).toBe(200);
      expect(await partial.json()).toMatchObject({
        ok: true,
        status: 'in_game',
        created: false,
        memberCount: 10,
        rosterFrozen: true,
      });
      expect(await memberRows(lobbyId)).toEqual(membersBefore);

      // The last companion shutting down and reporting an empty lobby changes nothing either.
      const emptied = await postLobby(post(lobbyBody([], [], frozenPartyId), ownerToken));
      expect(emptied.status).toBe(200);
      expect(await emptied.json()).toMatchObject({ memberCount: 10, rosterFrozen: true });
      expect(await memberRows(lobbyId)).toEqual(membersBefore);

      // `finished` is terminal for this row: the next post opens the night's next cycle
      // (M2.14) and these ten stay exactly where they are.
      await setStatus(lobbyId, 'finished');
      const nextCycle = await postLobby(post(lobbyBody(puuids, [], frozenPartyId), ownerToken));
      const nextCycleJson = await nextCycle.json();
      expect(nextCycleJson).toMatchObject({ ok: true, created: true, status: 'open', memberCount: 10 });
      expect(nextCycleJson.lobbyId).not.toBe(lobbyId);
      expect(await memberRows(lobbyId)).toEqual(membersBefore);

      // That new row is `open`, so someone leaving is a real leave: the deletes apply as they
      // did before, and they apply to the new row only.
      const reopened = await postLobby(post(lobbyBody(puuids.slice(0, 3), [], frozenPartyId), ownerToken));
      expect(await reopened.json()).toMatchObject({ memberCount: 3, rosterFrozen: false });
      expect(await memberRows(nextCycleJson.lobbyId as string)).toHaveLength(3);
      expect(await memberRows(lobbyId)).toEqual(membersBefore);
    });

    it("stores the client's numeric summonerId as text (M2.10, no migration)", async () => {
      const { data } = await db
        .from('players')
        .select('summoner_id')
        .eq('puuid', puuids[0] ?? '')
        .single();

      // `players.summoner_id` is `text` in 0001_init.sql; the payload schema normalises the
      // client's JSON number to digits, so nothing here needed a migration.
      expect(data?.summoner_id).toBe('1000');
    });

    it('drops a bot the companion left in the list and keeps everyone else', async () => {
      // M2.10, point 4: a bot leaking through must never cost the group the other members.
      const body = lobbyBody(puuids.slice(0, 4), [], botPartyId) as Record<string, unknown>;
      const members = body.members as Record<string, unknown>[];
      const response = await postLobby(
        post(
          {
            ...body,
            members: [
              ...members,
              { puuid: '', summonerId: 0, isBot: true, isSpectator: false },
              { puuid: '00000000-0000-0000-0000-000000000000', summonerId: 0, isSpectator: false },
            ],
          },
          ownerToken,
        ),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({ ok: true, memberCount: 4 });
      expect(await countMembers(json.lobbyId as string)).toBe(4);
      // No `players` row was created for either placeholder.
      const { count } = await db
        .from('players')
        .select('id', { count: 'exact', head: true })
        .in('puuid', ['', '00000000-0000-0000-0000-000000000000']);
      expect(count).toBe(0);
    });

    it('accepts a roster with no names at all, because the lobby response carries none', async () => {
      // M2.10, point 2: posting a lobby never waits on a name lookup.
      const response = await postLobby(
        post(
          {
            partyId: botPartyId,
            members: puuids.slice(0, 3).map((puuid, index) => ({
              puuid,
              summonerId: 1000 + index,
              side: 100,
              isSpectator: false,
            })),
          },
          ownerToken,
        ),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, memberCount: 3 });
    });

    it('answers 400 for a body that does not match the schema', async () => {
      const response = await postLobby(post({ partyId: 'x' }, ownerToken));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: 'request body failed validation' });
    });

    it.each([
      ['no header', null],
      ['a token nobody minted', 'not-a-real-token'],
    ])('answers 401 with %s', async (_label, token) => {
      const response = await postLobby(post(lobbyBody(puuids, [], otherPartyId), token));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false });
      expect(await countLobbies(otherPartyId)).toBe(0);
    });

    it('answers 401 for a revoked token', async () => {
      const response = await postLobby(post(lobbyBody(puuids, [], otherPartyId), revokedToken));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'companion token has been revoked' });
      expect(await countLobbies(otherPartyId)).toBe(0);
    });
  });

  describe('POST /api/companion/lobby: a lobby row is one game cycle (M2.14)', () => {
    // The client keeps one party id all night - fixture evidence: party `e3c69392` played at
    // 16:37 and was still emitting lobby events at 17:39 with no new id. So the second game
    // of the night has to get its own row, or it never gets teams.
    it("starts a new row for the night's next game and leaves the first one alone", async () => {
      const first = await postLobby(post(lobbyBody(puuids, [], cyclePartyId), ownerToken));
      const firstJson = await first.json();
      const firstLobbyId = firstJson.lobbyId as string;
      expect(firstJson).toMatchObject({ created: true, status: 'open', memberCount: 10 });

      // Game one: it lands on the first row and closes it.
      const eog = await postGame(
        post(eogBody({ gameId: cycleGameId, puuids, partyId: cyclePartyId }), ownerToken),
      );
      expect(eog.status).toBe(200);
      expect((await eog.json()).lobbyId).toBe(firstLobbyId);
      await setStatus(firstLobbyId, 'finished');

      const membersOfFirst = await memberRows(firstLobbyId);
      const rowOfFirst = (await lobbyRowsForParty(cyclePartyId))[0];

      // Game two, same party id, same ten.
      const second = await postLobby(post(lobbyBody(puuids, [], cyclePartyId), ownerToken));
      const secondJson = await second.json();
      expect(second.status).toBe(200);
      expect(secondJson).toMatchObject({ created: true, status: 'open', memberCount: 10 });
      expect(secondJson.lobbyId).not.toBe(firstLobbyId);

      const rowsNow = await lobbyRowsForParty(cyclePartyId);
      expect(rowsNow).toHaveLength(2);
      expect(rowsNow[0]).toEqual(rowOfFirst);
      expect(rowsNow[1]?.status).toBe('open');
      expect(await memberRows(firstLobbyId)).toEqual(membersOfFirst);

      // A late repost of game one's block still lands on the row it was played from, once.
      const late = await postGame(
        post(eogBody({ gameId: cycleGameId, puuids, partyId: cyclePartyId }), ownerToken),
      );
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ created: false, lobbyId: firstLobbyId });
      expect(await countGames(cycleGameId)).toBe(1);

      // And a third cycle behaves the same.
      await setStatus(secondJson.lobbyId as string, 'abandoned');
      const third = await postLobby(post(lobbyBody(puuids, [], cyclePartyId), ownerToken));
      const thirdJson = await third.json();
      expect(thirdJson).toMatchObject({ created: true, status: 'open' });
      expect(thirdJson.lobbyId).not.toBe(secondJson.lobbyId);
      expect(await lobbyRowsForParty(cyclePartyId)).toHaveLength(3);
    });

    it('lands a late game on the cycle that was live when it started, not the one after it', async () => {
      // Two closed-then-reopened cycles for one party, an hour apart, built by hand so the
      // timestamps are not a matter of milliseconds.
      const hour = 60 * 60 * 1000;
      const now = Date.now();
      const { data, error } = await db
        .from('lobbies')
        .insert([
          {
            group_id: ORIGINAL_GROUP_ID,
            lcu_party_id: oldCyclePartyId,
            status: 'finished',
            created_at: new Date(now - 2 * hour).toISOString(),
          },
          {
            group_id: ORIGINAL_GROUP_ID,
            lcu_party_id: oldCyclePartyId,
            status: 'open',
            created_at: new Date(now - hour).toISOString(),
          },
        ])
        .select('id, status');
      if (error) throw new Error(error.message);
      const first = data?.find((row) => row.status === 'finished')?.id ?? '';
      const second = data?.find((row) => row.status === 'open')?.id ?? '';

      const response = await postGame(
        post(
          eogBody({
            gameId: oldCycleGameId,
            puuids,
            partyId: oldCyclePartyId,
            startedAt: new Date(now - 90 * 60 * 1000).toISOString(),
          }),
          ownerToken,
        ),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.lobbyId).toBe(first);
      expect(json.lobbyId).not.toBe(second);
    });

    it('keeps posting to the live row while the cycle is open', async () => {
      // Idempotency is unchanged: only a closed cycle starts a row, never a repeat post.
      const before = await lobbyRowsForParty(cyclePartyId);
      const repeat = await postLobby(post(lobbyBody(puuids, [], cyclePartyId), ownerToken));
      expect(await repeat.json()).toMatchObject({ created: false });
      expect(await lobbyRowsForParty(cyclePartyId)).toHaveLength(before.length);
    });
  });

  describe('POST /api/companion/lobby: ranksNeeded (M2.4)', () => {
    // "Once, then weekly" is a rule about our data, so the server owns it and the companion
    // just asks about the puuids it is handed (decision row, 2026-09-08).
    const freshPuuid = `it-${runId}-rank-fresh`;
    const stalePuuid = `it-${runId}-rank-stale`;
    const newPuuid = `it-${runId}-rank-new`;
    const day = 24 * 60 * 60 * 1000;

    function ranksBody(members: readonly string[]): unknown {
      return {
        partyId: ranksPartyId,
        members: members.map((puuid, index) => ({
          puuid,
          summonerId: 5000 + index,
          side: 100,
          isSpectator: false,
        })),
      };
    }

    beforeAll(async () => {
      allPuuids.push(freshPuuid, stalePuuid, newPuuid);
      await ensurePlayers(db, [{ puuid: freshPuuid }, { puuid: stalePuuid }]);
      // Six days old is inside the window; eight days is outside it. The boundary is the
      // whole schedule, so it is asserted from both sides.
      await db
        .from('players')
        .update({ rank_updated_at: new Date(Date.now() - 6 * day).toISOString() })
        .eq('puuid', freshPuuid);
      await db
        .from('players')
        .update({ rank_updated_at: new Date(Date.now() - 8 * day).toISOString() })
        .eq('puuid', stalePuuid);
    });

    it('names the members whose rank is missing or over a week old, in posted order', async () => {
      const caller = puuids[0] ?? '';
      const response = await postLobby(
        post(ranksBody([caller, freshPuuid, stalePuuid, newPuuid]), ownerToken),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      // The caller has never had a rank reported either, so they are on the list too. The
      // six-day-old one is not, and a puuid with no `players` row at all is.
      expect(json.ranksNeeded).toEqual([caller, stalePuuid, newPuuid]);
      // M2.5 fills this in; until then there is never anything to knock about.
      expect(json.recheckInMs).toBeNull();
    });

    it('drops a puuid off the list the moment its rank POST lands', async () => {
      await postRank(post({ puuid: stalePuuid, tier: 'SILVER', division: 'IV', lp: 12 }, ownerToken));

      const response = await postLobby(
        post(ranksBody([puuids[0] ?? '', freshPuuid, stalePuuid, newPuuid]), ownerToken),
      );

      const json = await response.json();
      expect(json.ranksNeeded).not.toContain(stalePuuid);
      expect(json.ranksNeeded).toContain(newPuuid);
    });

    it('includes a spectator, who plays the next round and needs a name either way', async () => {
      const watcherPuuid = `it-${runId}-rank-watcher`;
      allPuuids.push(watcherPuuid);

      const response = await postLobby(
        post(
          {
            partyId: ranksPartyId,
            members: [
              { puuid: puuids[0] ?? '', summonerId: 5100, side: 100, isSpectator: false },
              { puuid: watcherPuuid, summonerId: 5101, side: null, isSpectator: true },
            ],
          },
          ownerToken,
        ),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ranksNeeded).toContain(watcherPuuid);
    });

    it('still answers it for a frozen roster, because those people still need a rank', async () => {
      // M2.9 freezes `lobby_members`, not the question of whose rank we are missing.
      const body = ranksBody([puuids[0] ?? '', newPuuid]);
      const lobbyId = (await postLobby(post(body, ownerToken)).then((r) => r.json())).lobbyId as string;
      await db.from('lobbies').update({ status: 'in_game' }).eq('id', lobbyId);

      const response = await postLobby(post(body, ownerToken));
      const json = await response.json();

      expect(json).toMatchObject({ rosterFrozen: true });
      expect(json.ranksNeeded).toContain(newPuuid);

      await db.from('lobbies').update({ status: 'open' }).eq('id', lobbyId);
    });
  });

  describe('POST /api/companion/game', () => {
    it('stores the game once, with ten players, however many companions post it', async () => {
      const body = eogBody({ gameId, puuids, partyId });

      const first = await postGame(post(body, ownerToken));
      expect(first.status).toBe(200);
      const firstJson = await first.json();
      expect(firstJson).toMatchObject({ ok: true, phase: 'eog', created: true, participants: 10 });

      const gameRowId = firstJson.gameId as string;
      expect(await countGames(gameId)).toBe(1);

      // The party id links the game to the lobby the companion reported earlier.
      const { data: lobby } = await db.from('lobbies').select('id').eq('lcu_party_id', partyId).single();
      expect(firstJson.lobbyId).toBe(lobby?.id);

      const { data: gameBefore } = await db.from('games').select('*').eq('id', gameRowId).single();
      const playersBefore = await gamePlayerRows(gameRowId);
      expect(playersBefore).toHaveLength(10);
      expect(playersBefore.filter((row) => row.side === 100)).toHaveLength(5);

      // The second companion in the same game posts the same block.
      const second = await postGame(post(body, ownerToken));
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({
        ok: true,
        created: false,
        gameId: gameRowId,
        participants: 10,
      });

      expect(await countGames(gameId)).toBe(1);
      const { data: gameAfter } = await db.from('games').select('*').eq('id', gameRowId).single();
      expect(gameAfter).toEqual(gameBefore);
      expect(await gamePlayerRows(gameRowId)).toEqual(playersBefore);
    });

    it('keeps the raw block and fills the rating columns in (M2.5)', async () => {
      const { data: game } = await db
        .from('games')
        .select('id, raw, source')
        .eq('lcu_game_id', gameId)
        .single();
      expect(game?.source).toBe('eog');
      expect(game?.raw).toMatchObject({ gameType: 'CUSTOM_GAME' });

      // Ten players, five a side, over five minutes: the fold ran on the way through.
      const { data: rows } = await db
        .from('game_players')
        .select('player_id, mu_before, sigma_before, mu_after, sigma_after')
        .eq('game_id', game?.id ?? '');
      expect(rows).toHaveLength(10);
      expect(
        rows?.every(
          (row) =>
            row.mu_before !== null &&
            row.sigma_before !== null &&
            row.mu_after !== null &&
            row.sigma_after !== null,
        ),
      ).toBe(true);

      const { count } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .in(
          'player_id',
          (rows ?? []).map((row) => row.player_id),
        );
      expect(count).toBe(10);
    });

    it('scrubs the chat credentials out of games.raw, which is public-read', async () => {
      // M2.10, point 11: the block carries a live chat JWT and password and `games` has a
      // public read policy, so this is a leak fix, not hygiene.
      const response = await postGame(
        post(
          eogBody({
            gameId: scrubGameId,
            puuids,
            partyId,
            raw: {
              mucJwtDto: { jwt: 'live-jwt-value', channelClaim: 'c' },
              multiUserChatPassword: 'live-password-value',
              teams: [{ teamId: 100, nested: { mucJwtDto: 'deep-jwt-value' } }],
            },
          }),
          ownerToken,
        ),
      );
      expect(response.status).toBe(200);

      const { data } = await db.from('games').select('raw').eq('lcu_game_id', scrubGameId).single();
      const raw = data?.raw as Record<string, unknown>;
      expect(raw.mucJwtDto).toBe('[redacted]');
      expect(raw.multiUserChatPassword).toBe('[redacted]');
      const text = JSON.stringify(raw);
      expect(text).not.toContain('live-jwt-value');
      expect(text).not.toContain('live-password-value');
      expect(text).not.toContain('deep-jwt-value');
      // Everything else is still there for M5.2's rebuild.
      expect(raw.gameType).toBe('CUSTOM_GAME');
    });

    it('answers 422 and writes nothing for a block nobody won', async () => {
      // A remake or a TerminatedInError block. The companion is not supposed to post one.
      const response = await postGame(
        post(eogBody({ gameId: rejectedGameId, puuids, winningSide: null }), ownerToken),
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        ok: false,
        error: 'no winning team; remake or terminated',
      });
      expect(await countGames(rejectedGameId)).toBe(0);
    });

    it('fills in a name from the end-of-game block for a player a lobby could not name', async () => {
      const puuid = `it-${runId}-nameless`;
      allPuuids.push(puuid);
      await ensurePlayers(db, [{ puuid }]);

      const body = eogBody({ gameId: namedGameId, puuids: [...puuids.slice(0, 9), puuid] });
      const participants = (body.participants as Record<string, unknown>[]).map((participant) =>
        participant.puuid === puuid ? { ...participant, gameName: 'Nameless', tagLine: 'EUW' } : participant,
      );

      const response = await postGame(post({ ...body, participants }, ownerToken));
      expect(response.status).toBe(200);

      const { data } = await db
        .from('players')
        .select('game_name, tag_line, display_name')
        .eq('puuid', puuid)
        .single();
      expect(data).toMatchObject({ game_name: 'Nameless', tag_line: 'EUW', display_name: 'Nameless' });
    });

    it("accepts a spectator's post for a game they watched from the lobby (M2.8)", async () => {
      // The friend who sits out a round and runs the companion while watching. Their PUUID is
      // not on the scoreboard; it is in `lobby_members` with `is_spectator` true.
      const created = await postLobby(post(lobbyBody(puuids, [spectatorPuuid], watchedPartyId), ownerToken));
      expect(created.status).toBe(200);

      const response = await postGame(
        post(eogBody({ gameId: watchedGameId, puuids, partyId: watchedPartyId }), spectatorToken),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, created: true, participants: 10 });
      expect(await countGames(watchedGameId)).toBe(1);
    });

    it('still refuses a token whose player is in neither the game nor its lobby (M2.8)', async () => {
      const response = await postGame(
        post(eogBody({ gameId: rejectedGameId, puuids, partyId: watchedPartyId }), outsiderToken),
      );

      expect(response.status).toBe(403);
      expect(await countGames(rejectedGameId)).toBe(0);
    });

    it('answers 403 when the token belongs to someone who was not in the game', async () => {
      const response = await postGame(post(eogBody({ gameId: rejectedGameId, puuids }), outsiderToken));

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false });
      expect(await countGames(rejectedGameId)).toBe(0);
    });

    it('answers 422 for a game that is not a custom', async () => {
      const response = await postGame(
        post(eogBody({ gameId: rejectedGameId, puuids, gameType: 'MATCHED_GAME' }), ownerToken),
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ ok: false, error: 'gameType must be CUSTOM_GAME' });
      expect(await countGames(rejectedGameId)).toBe(0);
    });

    it('accepts the in_progress ping without writing a game', async () => {
      const response = await postGame(
        post({ phase: 'in_progress', gameId: rejectedGameId, partyId }, ownerToken),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, phase: 'in_progress', created: false });
      expect(await countGames(rejectedGameId)).toBe(0);
    });

    it('answers 401 for a revoked token before it looks at the body', async () => {
      const response = await postGame(post(eogBody({ gameId: rejectedGameId, puuids }), revokedToken));

      expect(response.status).toBe(401);
      expect(await countGames(rejectedGameId)).toBe(0);
    });
  });

  describe('GET /api/companion/me', () => {
    it('answers with the identity the token carries, and writes nothing', async () => {
      // M2.1: the companion calls this on first run so a mistyped token is a sentence on the
      // friend's screen rather than a silent 401 on the first lobby of the night.
      const response = await getMe(get(ownerToken));

      expect(response.status).toBe(200);
      const { data: owner } = await db
        .from('players')
        .select('id, display_name')
        .eq('puuid', puuids[0] ?? '')
        .single();
      const { data: group } = await db
        .from('groups')
        .select('id, slug, name')
        .eq('id', ORIGINAL_GROUP_ID)
        .single();
      expect(await response.json()).toEqual({
        ok: true,
        puuid: puuids[0],
        playerId: owner?.id,
        displayName: owner?.display_name ?? null,
        // M14.12: the token's group, the shape Kustom's `companionMeWithGroupSchema` reads.
        group,
      });
    });

    it('answers 401 without a token', async () => {
      const response = await getMe(get(null));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'missing bearer token' });
    });

    it('answers 401 for a token nobody minted and for a revoked one', async () => {
      const unknown = await getMe(get('not-a-real-token'));
      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toEqual({ ok: false, error: 'unknown companion token' });

      const revoked = await getMe(get(revokedToken));
      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toEqual({ ok: false, error: 'companion token has been revoked' });
    });
  });

  describe('POST /api/companion/rank', () => {
    it('creates the player and stores the rank for a PUUID the caller has never met', async () => {
      const response = await postRank(
        post({ puuid: rankPuuid, tier: 'GOLD', division: 'II', lp: 47 }, ownerToken),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, stored: true });

      const { data } = await db
        .from('players')
        .select('rank_tier, rank_division, rank_lp, rank_updated_at')
        .eq('puuid', rankPuuid)
        .single();
      expect(data).toMatchObject({ rank_tier: 'GOLD', rank_division: 'II', rank_lp: 47 });
      expect(data?.rank_updated_at).not.toBeNull();
    });

    it('updates the rank on a second report', async () => {
      await postRank(post({ puuid: rankPuuid, tier: 'PLATINUM', division: 'IV', lp: 3 }, ownerToken));

      const { data } = await db
        .from('players')
        .select('rank_tier, rank_division')
        .eq('puuid', rankPuuid)
        .single();
      expect(data).toMatchObject({ rank_tier: 'PLATINUM', rank_division: 'IV' });
    });

    it("normalises the client's unranked strings to null (M2.10, point 12)", async () => {
      const unrankedPuuid = `it-${runId}-unranked`;
      allPuuids.push(unrankedPuuid);

      // 16.17 unranked reads tier "" and division "NA"; `losses` is 0 for everyone but the
      // local player, so the payload does not carry it and this one is ignored.
      const response = await postRank(
        post({ puuid: unrankedPuuid, tier: '', division: 'NA', lp: 0, losses: 41 }, ownerToken),
      );

      expect(response.status).toBe(200);
      const { data } = await db
        .from('players')
        .select('rank_tier, rank_division, rank_lp')
        .eq('puuid', unrankedPuuid)
        .single();
      expect(data).toEqual({ rank_tier: null, rank_division: null, rank_lp: null });
    });

    it('takes the name the sweep looked up and applies the M1.7 display-name rule', async () => {
      // Lobby members carry no Riot ID on 16.17, so the rank sweep is where a first-time
      // player's name arrives (M2.4). One POST, both facts.
      const namedPuuid = `it-${runId}-rank-named`;
      allPuuids.push(namedPuuid);

      const response = await postRank(
        post(
          { puuid: namedPuuid, tier: 'SILVER', division: 'II', lp: 1, gameName: 'XETA', tagLine: 'EUNE' },
          ownerToken,
        ),
      );
      expect(response.status).toBe(200);

      const { data } = await db
        .from('players')
        .select('game_name, tag_line, display_name, rank_tier, rank_updated_at')
        .eq('puuid', namedPuuid)
        .single();
      expect(data).toMatchObject({
        game_name: 'XETA',
        tag_line: 'EUNE',
        display_name: 'XETA',
        rank_tier: 'SILVER',
      });
      expect(data?.rank_updated_at).not.toBeNull();
    });

    it("renames the Riot ID without touching an admin's display name", async () => {
      const overriddenPuuid = `it-${runId}-rank-override`;
      allPuuids.push(overriddenPuuid);
      await ensurePlayers(db, [{ puuid: overriddenPuuid, gameName: 'OldName' }]);
      await db.from('players').update({ display_name: 'Boss' }).eq('puuid', overriddenPuuid);

      await postRank(
        post({ puuid: overriddenPuuid, tier: 'GOLD', division: 'IV', gameName: 'NewName' }, ownerToken),
      );

      const { data } = await db
        .from('players')
        .select('game_name, display_name')
        .eq('puuid', overriddenPuuid)
        .single();
      // The Riot ID moved; the name the group chose did not (M1.7).
      expect(data).toMatchObject({ game_name: 'NewName', display_name: 'Boss' });
    });

    it('leaves the rank alone for a queue we do not seed from', async () => {
      const response = await postRank(
        post(
          { puuid: rankPuuid, tier: 'DIAMOND', division: 'I', lp: 99, queue: 'RANKED_FLEX_SR' },
          ownerToken,
        ),
      );

      expect(await response.json()).toMatchObject({ ok: true, stored: false });

      const { data } = await db.from('players').select('rank_tier').eq('puuid', rankPuuid).single();
      expect(data?.rank_tier).toBe('PLATINUM');
    });
  });
}
