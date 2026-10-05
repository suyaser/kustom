import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import {
  companionMeResponseSchema,
  ORIGINAL_GROUP_ID,
  overlayGroupsResponseSchema,
} from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken, NOT_A_MEMBER_ERROR } from '@/lib/companionAuth';
import { loadGroupPool, lobbyGroupId } from '@/lib/ingest/balance';
import { ensurePlayers } from '@/lib/ingest/players';
import { rebuildRatings } from '@/lib/ingest/rebuild';
import { eogBody, lobbyBody, testGameId } from '@/lib/testing/fixtures';
import { pinTestGroupMode } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M13.3 end to end: two groups, one player in both, and every companion-facing path asked
 * "which group" -- lobbies, games, the live fold, lazy membership, start-a-lobby targeting, the
 * command poll, backfill's six-of-ten rule and its per-group approval, the two overlay
 * endpoints, a token whose membership is gone, and `rebuild-ratings` per group.
 *
 * The groups here are this file's own (`it-<run>-a`, `-b`, `-c`), so nothing the original group
 * holds can move any number checked below, and the cleanup removes every row it made.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('groups (M13.3) against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');
  const { GET: getMe } = await import('./me/route');
  const { GET: getCommands } = await import('./commands/route');
  const { POST: postScan } = await import('./backfill/scan/route');
  const { GET: getOverlay } = await import('../overlay/route');
  const { GET: getOverlayGroups } = await import('../overlay/groups/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const p = (name: string): string => `it-${runId}-${name}`;

  /** In both groups: the subject of acceptance 1. */
  const both = p('both');
  const hostA = p('hosta');
  const hostB = p('hostb');
  const aOnly = Array.from({ length: 8 }, (_, index) => p(`a${index}`));
  const bOnly = Array.from({ length: 8 }, (_, index) => p(`b${index}`));
  /** Ten for group A's games and ten for group B's, with `both` in each. */
  const rosterA = [hostA, both, ...aOnly];
  const rosterB = [hostB, both, ...bOnly];
  /** A's game that B's host also played in: what the cross-group eog dedupe is posted with. */
  const sharedRoster = [hostA, hostB, both, ...aOnly.slice(0, 7)];
  const newcomer = p('newcomer');
  const leaver = p('leaver');
  const hostC = p('hostc');
  const cRoster = [hostC, ...Array.from({ length: 9 }, (_, index) => p(`c${index}`))];
  const stranger = p('stranger');
  const allPuuids = [
    ...new Set([...rosterA, ...rosterB, newcomer, leaver, ...cRoster, stranger, p('pboth-a'), p('pboth-b')]),
  ];

  const groupIds = { a: '', b: '', c: '' };
  const tokens = { a: '', b: '', leaver: '', c: '', bothA: '', bothB: '' };
  const playerId = new Map<string, string>();
  const partyIds: string[] = [];
  const gameIds: number[] = [];
  let nextGame = testGameId();

  function gameNumber(): number {
    nextGame += 1;
    gameIds.push(nextGame);
    return nextGame;
  }

  function party(name: string): string {
    const id = `it-party-${runId}-${name}`;
    partyIds.push(id);
    return id;
  }

  function id(puuid: string): string {
    const value = playerId.get(puuid);
    if (value === undefined) throw new Error(`no player id for ${puuid}`);
    return value;
  }

  function companion(path: string, token: string, body?: unknown, method = 'POST'): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function mintToken(
    puuid: string,
    groupId: string,
    lastSeenAt: string | null = null,
  ): Promise<{ token: string; tokenId: string }> {
    const { token, tokenHash } = mintCompanionToken();
    const { data, error } = await db
      .from('companion_tokens')
      .insert({
        player_id: id(puuid),
        token_hash: tokenHash,
        label: `it-${runId}`,
        group_id: groupId,
        last_seen_at: lastSeenAt,
      })
      .select('id')
      .single();
    if (error) throw new Error(`mintToken: ${error.message}`);
    return { token, tokenId: data.id };
  }

  async function ratingRow(puuid: string, groupId: string): Promise<string | null> {
    const { data, error } = await db
      .from('ratings')
      .select('*')
      .eq('player_id', id(puuid))
      .eq('group_id', groupId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data === null ? null : JSON.stringify(data);
  }

  async function groupRatings(groupId: string): Promise<string> {
    const { data, error } = await db.from('ratings').select('*').eq('group_id', groupId).order('player_id');
    if (error) throw new Error(error.message);
    return JSON.stringify(data);
  }

  async function membership(puuid: string, groupId: string): Promise<{ role: string } | null> {
    const { data, error } = await db
      .from('group_memberships')
      .select('role')
      .eq('group_id', groupId)
      .eq('player_id', id(puuid))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function postEog(body: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
    const response = await postGame(companion('game', token, body));
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(json)).toBe(200);
    return json;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      allPuuids.filter((puuid) => puuid !== newcomer).map((puuid) => ({ puuid })),
    );
    for (const [puuid, value] of ids) playerId.set(puuid, value);

    for (const key of ['a', 'b', 'c'] as const) {
      const { data, error } = await db
        .from('groups')
        .insert({ slug: `it-${runId}-${key}`, name: `it ${runId} ${key}` })
        .select('id')
        .single();
      if (error) throw new Error(`group ${key}: ${error.message}`);
      groupIds[key] = data.id;
      // M13.5 inserts a group's fearless cursor with the group; this file does it by hand, in
      // the past, so every game below is in its group's pool.
      const cursor = await db
        .from('fearless_state')
        .insert({ group_id: data.id, reset_at: '2020-01-01T00:00:00.000Z' });
      if (cursor.error) throw new Error(`fearless ${key}: ${cursor.error.message}`);
      // M14.46: a new group starts on Normal since 0030; these build on the fearless pool.
      await pinTestGroupMode(db, data.id, 'fearless');
    }

    // `both` joined A first and B a month later: the overlay groups list is oldest first.
    const joined = await db.from('group_memberships').insert([
      { group_id: groupIds.a, player_id: id(both), role: 'member', created_at: '2026-01-01T00:00:00.000Z' },
      { group_id: groupIds.b, player_id: id(both), role: 'member', created_at: '2026-02-01T00:00:00.000Z' },
    ]);
    if (joined.error) throw new Error(joined.error.message);

    tokens.a = (await mintToken(hostA, groupIds.a)).token;
    tokens.b = (await mintToken(hostB, groupIds.b)).token;
    tokens.leaver = (await mintToken(leaver, groupIds.a)).token;
    tokens.c = (await mintToken(hostC, groupIds.c)).token;
  });

  afterAll(async () => {
    const groups = Object.values(groupIds).filter((value) => value !== '');
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await db.from('games').delete().in('group_id', groups);
    await db.from('lobbies').delete().in('group_id', groups);
    await db.from('lobbies').delete().in('lcu_party_id', partyIds);
    await db.from('companion_commands').delete().in('group_id', groups);
    await db.from('companion_tokens').delete().in('group_id', groups);
    await db.from('ratings').delete().in('group_id', groups);
    await db.from('fearless_state').delete().in('group_id', groups);
    await db.from('group_memberships').delete().in('group_id', groups);
    await db
      .from('players')
      .delete()
      .in('puuid', [...allPuuids, newcomer]);
    await db.from('groups').delete().in('id', groups);
  });

  // ---------------------------------------------------------------------------
  // Acceptance 1: ratings are per group
  // ---------------------------------------------------------------------------

  describe('ratings, one per person per group (acceptance 1)', () => {
    it("moves the posting group's rating and leaves the other group's byte-identical, both ways", async () => {
      // B first, so `both` has a B row for the A game to leave alone.
      const firstB = await postEog(eogBody({ gameId: gameNumber(), puuids: rosterB }), tokens.b);
      expect(firstB).toMatchObject({ created: true, rated: true });
      const bAfterFirst = await ratingRow(both, groupIds.b);
      expect(bAfterFirst).not.toBeNull();
      expect(await ratingRow(both, groupIds.a)).toBeNull();

      // A game posted with A's token: `both`'s A row is created at the seed and moved; B's row
      // is byte-identical, `updated_at` included.
      const firstA = await postEog(eogBody({ gameId: gameNumber(), puuids: rosterA }), tokens.a);
      expect(firstA).toMatchObject({ created: true, rated: true });
      const aAfterFirst = await ratingRow(both, groupIds.a);
      expect(aAfterFirst).not.toBeNull();
      expect(await ratingRow(both, groupIds.b)).toBe(bAfterFirst);

      // A newcomer to a group starts there at the seed (1200 = mu 20), not at their other number:
      // one game from the seed gives the same mu_before as anybody else's first game.
      const { data: before } = await db
        .from('game_players')
        .select('mu_before, sigma_before, games!inner(lcu_game_id)')
        .eq('player_id', id(both))
        .eq('group_id', groupIds.a);
      expect(before?.[0]?.mu_before).toBe(20);

      // And the other way round.
      await postEog(eogBody({ gameId: gameNumber(), puuids: rosterB, winningSide: 200 }), tokens.b);
      expect(await ratingRow(both, groupIds.a)).toBe(aAfterFirst);
      expect(await ratingRow(both, groupIds.b)).not.toBe(bAfterFirst);

      // Two `ratings` rows for one player: one per group (`0019`'s per-group key).
      const { count } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .eq('player_id', id(both))
        .in('group_id', [groupIds.a, groupIds.b]);
      expect(count).toBe(2);
    });

    it('stores a game with no lobby in the token group, and every player of it becomes a member', async () => {
      const { data } = await db
        .from('games')
        .select('group_id')
        .in('lcu_game_id', gameIds.slice(0, 3))
        .order('lcu_game_id');
      expect(data?.map((row) => row.group_id)).toEqual([groupIds.b, groupIds.a, groupIds.b]);
      for (const puuid of rosterB) expect(await membership(puuid, groupIds.b)).not.toBeNull();
      for (const puuid of bOnly) expect(await membership(puuid, groupIds.a)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 2: global dedupe, the first group keeps it
  // ---------------------------------------------------------------------------

  describe('a party and a game belong to the group that posted them first (acceptance 2)', () => {
    it("answers B's post of A's party as a duplicate and never moves the lobby", async () => {
      const partyId = party('shared');
      const fromA = await postLobby(
        companion('lobby', tokens.a, lobbyBody({ partyId, members: rosterA.map((puuid) => ({ puuid })) })),
      );
      expect(fromA.status).toBe(200);
      const opened = (await fromA.json()) as { lobbyId: string; created: boolean; memberCount: number };
      expect(opened).toMatchObject({ created: true, memberCount: 10 });

      // B's host is in the lobby, so the M1.8 check passes; the roster B's companion sees is
      // different (four people fewer), and none of that may land.
      const fromB = await postLobby(
        companion(
          'lobby',
          tokens.b,
          lobbyBody({
            partyId,
            members: [hostB, both, ...bOnly.slice(0, 4)].map((puuid) => ({ puuid })),
            lobbyName: 'renamed by B',
          }),
        ),
      );
      expect(fromB.status).toBe(200);
      expect(await fromB.json()).toMatchObject({
        ok: true,
        lobbyId: opened.lobbyId,
        created: false,
        status: 'open',
        memberCount: 10,
      });

      const { data: lobbies } = await db
        .from('lobbies')
        .select('id, group_id, lobby_name')
        .eq('lcu_party_id', partyId);
      expect(lobbies).toEqual([{ id: opened.lobbyId, group_id: groupIds.a, lobby_name: 'customs night' }]);
      const { count } = await db
        .from('lobby_members')
        .select('player_id', { count: 'exact', head: true })
        .eq('lobby_id', opened.lobbyId);
      expect(count).toBe(10);
      // B's post wrote no membership in A: its host never joined A by posting someone else's party.
      expect(await membership(hostB, groupIds.a)).toBeNull();

      // The party's next cycle stays A's: after the lobby is abandoned, B's post still opens nothing.
      await db.from('lobbies').update({ status: 'abandoned' }).eq('id', opened.lobbyId);
      const nextFromB = await postLobby(
        companion('lobby', tokens.b, lobbyBody({ partyId, members: [{ puuid: hostB }, { puuid: both }] })),
      );
      expect(await nextFromB.json()).toMatchObject({ lobbyId: opened.lobbyId, created: false });
      const { count: rows } = await db
        .from('lobbies')
        .select('id', { count: 'exact', head: true })
        .eq('lcu_party_id', partyId);
      expect(rows).toBe(1);
    });

    it("answers B's post of A's game as a no-op: one game, A's, and A's ratings untouched", async () => {
      const gameId = gameNumber();
      const body = eogBody({ gameId, puuids: sharedRoster });
      expect(await postEog(body, tokens.a)).toMatchObject({ created: true, rated: true });
      const ratingsA = await groupRatings(groupIds.a);
      const ratingsB = await groupRatings(groupIds.b);

      const second = await postEog(body, tokens.b);
      expect(second).toMatchObject({ created: false, rated: false, reason: 'other-group', participants: 10 });

      const { data } = await db.from('games').select('id, group_id').eq('lcu_game_id', gameId);
      expect(data?.map((row) => row.group_id)).toEqual([groupIds.a]);
      expect(await groupRatings(groupIds.a)).toBe(ratingsA);
      expect(await groupRatings(groupIds.b)).toBe(ratingsB);
    });

    it("stores a live game in its lobby's group even when the other group's companion posts it", async () => {
      const partyId = party('lobby-game');
      const opened = await postLobby(
        companion(
          'lobby',
          tokens.a,
          lobbyBody({ partyId, members: sharedRoster.map((puuid) => ({ puuid })) }),
        ),
      );
      const { lobbyId } = (await opened.json()) as { lobbyId: string };

      const gameId = gameNumber();
      const posted = await postEog(eogBody({ gameId, puuids: sharedRoster, partyId }), tokens.b);
      expect(posted).toMatchObject({ created: true, rated: true, lobbyId });
      const { data } = await db.from('games').select('group_id').eq('lcu_game_id', gameId).single();
      expect(data?.group_id).toBe(groupIds.a);
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 3: playing is joining
  // ---------------------------------------------------------------------------

  describe('lazy membership (acceptance 3)', () => {
    it('creates an unseen PUUID and its member row in the posting group, and leaves an admin an admin', async () => {
      await db
        .from('group_memberships')
        .update({ role: 'admin' })
        .eq('group_id', groupIds.a)
        .eq('player_id', id(aOnly[0] as string));

      const partyId = party('newcomer');
      const response = await postLobby(
        companion(
          'lobby',
          tokens.a,
          lobbyBody({ partyId, members: [hostA, aOnly[0] as string, newcomer].map((puuid) => ({ puuid })) }),
        ),
      );
      expect(response.status).toBe(200);

      const { data: created } = await db.from('players').select('id').eq('puuid', newcomer).single();
      expect(created).not.toBeNull();
      playerId.set(newcomer, created?.id ?? '');
      expect(await membership(newcomer, groupIds.a)).toEqual({ role: 'member' });
      expect(await membership(newcomer, groupIds.b)).toBeNull();
      expect(await membership(aOnly[0] as string, groupIds.a)).toEqual({ role: 'admin' });
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 4: the poll is per token group (the lobby press half went with M22.11)
  // ---------------------------------------------------------------------------

  describe('the command poll (acceptance 4)', () => {
    it('hands a player in two groups only the polling token group', async () => {
      tokens.bothA = (await mintToken(both, groupIds.a, new Date().toISOString())).token;
      tokens.bothB = (await mintToken(both, groupIds.b, new Date().toISOString())).token;
      const queued = await db
        .from('companion_commands')
        .insert({
          group_id: groupIds.b,
          target_player_id: id(both),
          kind: 'switch_side',
          payload: { targetSide: 100 },
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select('id')
        .single();
      expect(queued.error).toBeNull();

      const viaA = await getCommands(
        companion('commands?clientConnected=true', tokens.bothA, undefined, 'GET'),
      );
      expect(((await viaA.json()) as { commands: unknown[] }).commands).toEqual([]);
      const viaB = await getCommands(
        companion('commands?clientConnected=true', tokens.bothB, undefined, 'GET'),
      );
      const handed = ((await viaB.json()) as { commands: { id: string }[] }).commands;
      expect(handed.map((command) => command.id)).toEqual([queued.data?.id]);

      await db
        .from('companion_commands')
        .delete()
        .eq('id', queued.data?.id ?? '');
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 5: backfill
  // ---------------------------------------------------------------------------

  describe('backfill (acceptance 5)', () => {
    it("the scan answers group C's member with no approval step", async () => {
      const gameId = gameNumber();
      const scan = await postScan(companion('backfill/scan', tokens.c, { gameIds: [gameId] }));
      expect(await scan.json()).toEqual({ ok: true, approved: true, unknown: [gameId] });
    });

    function backfillBody(gameId: number): Record<string, unknown> {
      const body = eogBody({ gameId, puuids: cRoster, startedAt: '2026-08-20T19:00:00.000Z' });
      const { partyId: _dropped, ...rest } = body;
      const participants = (body.participants as Record<string, unknown>[]).map((participant) => ({
        ...participant,
        role: null,
      }));
      return { ...rest, participants, source: 'backfill' };
    }

    it('skips and counts a game with five members of the group, and stores it with six', async () => {
      // The host plus four: five of ten.
      const four = cRoster.slice(1, 5).map((puuid) => ({ group_id: groupIds.c, player_id: id(puuid) }));
      expect((await db.from('group_memberships').insert(four)).error).toBeNull();

      const gameId = gameNumber();
      const skipped = await postEog(backfillBody(gameId), tokens.c);
      expect(skipped).toEqual({
        ok: true,
        phase: 'eog',
        created: false,
        gameId: null,
        lobbyId: null,
        participants: 0,
        rated: false,
        reason: 'not-this-group',
        skippedNotThisGroup: 1,
      });
      const { count: stored } = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('lcu_game_id', gameId);
      expect(stored).toBe(0);
      // Nothing written means nobody joined either.
      expect(await membership(cRoster[5] as string, groupIds.c)).toBeNull();
      // ... and the next scan offers it again.
      const rescan = await postScan(companion('backfill/scan', tokens.c, { gameIds: [gameId] }));
      expect(await rescan.json()).toEqual({ ok: true, approved: true, unknown: [gameId] });

      // A sixth member, and the same game is this group's.
      await db
        .from('group_memberships')
        .insert({ group_id: groupIds.c, player_id: id(cRoster[5] as string) });
      const kept = await postEog(backfillBody(gameId), tokens.c);
      expect(kept).toMatchObject({ created: true, rated: false, reason: 'backfill' });
      expect(kept.skippedNotThisGroup).toBeUndefined();
      const { data } = await db.from('games').select('group_id').eq('lcu_game_id', gameId).single();
      expect(data?.group_id).toBe(groupIds.c);
      for (const puuid of cRoster) expect(await membership(puuid, groupIds.c)).not.toBeNull();

      // An id stored anywhere is the usual no-op, whatever the member count.
      const again = await postEog(backfillBody(gameId), tokens.c);
      expect(again).toMatchObject({ created: false });
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 6: the overlay
  // ---------------------------------------------------------------------------

  describe('the overlay (acceptance 6)', () => {
    async function overlay(query: string): Promise<Record<string, unknown>> {
      const response = await getOverlay(new Request(`http://localhost/api/overlay?${query}`));
      expect(response.status).toBe(200);
      return (await response.json()) as Record<string, unknown>;
    }

    const EMPTY = (puuid: string) => ({
      ok: true,
      viewerPuuid: puuid,
      // M14.29: the empty answer says no fearless is in force.
      fearless: { enabled: false, champions: [], resetAt: null },
      lobby: null,
    });

    it('lists exactly the groups a PUUID is in, oldest membership first', async () => {
      const response = await getOverlayGroups(
        new Request(`http://localhost/api/overlay/groups?puuid=${encodeURIComponent(both)}`),
      );
      const body = overlayGroupsResponseSchema.parse(await response.json());
      expect(body.groups).toEqual([
        { id: groupIds.a, slug: `it-${runId}-a`, name: `it ${runId} a` },
        { id: groupIds.b, slug: `it-${runId}-b`, name: `it ${runId} b` },
      ]);

      const nobody = await getOverlayGroups(
        new Request(`http://localhost/api/overlay/groups?puuid=${encodeURIComponent(stranger)}`),
      );
      expect(await nobody.json()).toEqual({ ok: true, groups: [] });
    });

    it('answers a group the PUUID is in, and the empty answer for one it is not in', async () => {
      const bOnlyPlayer = bOnly[0] as string;
      expect(await overlay(`puuid=${bOnlyPlayer}&group=${groupIds.a}`)).toEqual(EMPTY(bOnlyPlayer));

      const inB = await overlay(`puuid=${bOnlyPlayer}&group=${groupIds.b}`);
      expect((inB.fearless as { champions: unknown[] }).champions.length).toBeGreaterThan(0);

      // No group: the only group, or nothing for a PUUID in several (the 0.2.x panel).
      const alone = await overlay(`puuid=${bOnlyPlayer}`);
      expect(alone).toEqual(inB);
      expect(await overlay(`puuid=${both}`)).toEqual(EMPTY(both));
      expect(await overlay(`puuid=${stranger}`)).toEqual(EMPTY(stranger));
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance 7: a token whose membership is gone
  // ---------------------------------------------------------------------------

  describe('a token whose membership is deleted (acceptance 7)', () => {
    it('is 403 on every companion route', async () => {
      const before = await getMe(companion('me', tokens.leaver, undefined, 'GET'));
      expect(before.status).toBe(200);
      expect(await before.json()).toMatchObject({ puuid: leaver });

      await db.from('group_memberships').delete().eq('group_id', groupIds.a).eq('player_id', id(leaver));

      const me = await getMe(companion('me', tokens.leaver, undefined, 'GET'));
      expect(me.status).toBe(403);
      expect(await me.json()).toEqual({ ok: false, error: NOT_A_MEMBER_ERROR });
      const lobby = await postLobby(
        companion(
          'lobby',
          tokens.leaver,
          lobbyBody({ partyId: party('leaver'), members: [{ puuid: leaver }] }),
        ),
      );
      expect(lobby.status).toBe(403);
      const game = await postGame(
        companion(
          'game',
          tokens.leaver,
          eogBody({ gameId: gameNumber(), puuids: [leaver, ...aOnly.slice(0, 9)] }),
        ),
      );
      expect(game.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // M14.12 (M14.6's open item): GET /api/companion/me names the token's group
  // ---------------------------------------------------------------------------

  describe('GET /api/companion/me names the group (M14.12)', () => {
    it("answers each token's own group, for one player holding a token in each of two groups", async () => {
      const inA = (await mintToken(both, groupIds.a)).token;
      const inB = (await mintToken(both, groupIds.b)).token;
      const { data, error } = await db
        .from('groups')
        .select('id, slug, name')
        .in('id', [groupIds.a, groupIds.b]);
      if (error) throw error;
      const summary = (groupId: string) => data.find((row) => row.id === groupId);

      for (const [token, groupId] of [
        [inA, groupIds.a],
        [inB, groupIds.b],
      ] as const) {
        const me = await getMe(companion('me', token, undefined, 'GET'));
        expect(me.status).toBe(200);
        const json = await me.json();
        const parsed = companionMeResponseSchema.parse(json);
        expect(parsed).toMatchObject({ ok: true, puuid: both, playerId: id(both) });
        expect(parsed.group).toEqual(summary(groupId));
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Balance: the group's ratings
  // ---------------------------------------------------------------------------

  describe('balance', () => {
    it("feeds the balancer the lobby's group's ratings", async () => {
      const partyId = party('balance-b');
      const opened = await postLobby(
        companion('lobby', tokens.b, lobbyBody({ partyId, members: [{ puuid: hostB }, { puuid: both }] })),
      );
      const { lobbyId } = (await opened.json()) as { lobbyId: string };
      expect(await lobbyGroupId(db, lobbyId)).toBe(groupIds.b);

      const pool = await loadGroupPool(db, lobbyId, new Date(), 'UTC', await lobbyGroupId(db, lobbyId));
      // M18.5: the balancer reads the all-time Kustom Rating, `ratings.r`, of the lobby's group.
      const inB = JSON.parse((await ratingRow(both, groupIds.b)) ?? '{}') as { r: number };
      const inA = JSON.parse((await ratingRow(both, groupIds.a)) ?? '{}') as { r: number };
      expect(inA.r).not.toBe(inB.r);
      expect(pool.find((member) => member.puuid === both)?.r).toBe(inB.r);
      await db.from('lobbies').update({ status: 'abandoned' }).eq('id', lobbyId);
    });
  });

  // ---------------------------------------------------------------------------
  // rebuild-ratings, per group
  // ---------------------------------------------------------------------------

  describe('rebuild-ratings folds each group independently', () => {
    it("reproduces a group's live fold and never touches another group's rows", async () => {
      const ratingsA = await groupRatings(groupIds.a);
      const original = await groupRatings(ORIGINAL_GROUP_ID);

      const dry = await rebuildRatings(db, { groupId: groupIds.b, force: true, dryRun: true });
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.report.groupSlug).toBe(`it-${runId}-b`);
      expect(dry.report.rated).toBe(2);
      expect(dry.report.ratingRowsChanged).toBe(0);
      expect(dry.report.gamePlayerRowsChanged).toBe(0);

      const ratingsB = await groupRatings(groupIds.b);
      const run = await rebuildRatings(db, { groupId: groupIds.b, force: true });
      expect(run.ok).toBe(true);
      expect(await groupRatings(groupIds.b)).toBe(ratingsB);
      expect(await groupRatings(groupIds.a)).toBe(ratingsA);
      expect(await groupRatings(ORIGINAL_GROUP_ID)).toBe(original);
    });

    it("refuses on a group's own live lobby and not on another group's", async () => {
      // A has a live lobby from the newcomer case; B has none. Clock an hour ahead so the
      // fifteen-minute game guard is not what answers.
      const later = new Date(Date.now() + 3_600_000);
      const refused = await rebuildRatings(db, { groupId: groupIds.a, dryRun: true, now: later });
      expect(refused).toMatchObject({ ok: false, code: 'guard' });
      const allowed = await rebuildRatings(db, { groupId: groupIds.b, dryRun: true, now: later });
      expect(allowed.ok).toBe(true);
    });
  });
}
