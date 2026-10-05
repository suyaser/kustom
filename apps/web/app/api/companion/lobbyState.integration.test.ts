import { randomUUID } from 'node:crypto';
import { type Database, rosterKey } from '@customs/db';
import { companionLobbyPayloadSchema, ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rollLobby } from '@/lib/admin/roll';
import { mintCompanionToken } from '@/lib/companionAuth';
import { type BalanceOutcome, selectLastPlayedTeams } from '@/lib/ingest/balance';
import { clearLobbyHooks, registerLobbyHook } from '@/lib/ingest/hooks';
import { ingestLobby } from '@/lib/ingest/lobby';
import { ensurePlayers } from '@/lib/ingest/players';
import { IDLE_ABANDON_MS, sweepIdleLobbies } from '@/lib/lobbyState';
import { nightStart } from '@/lib/night';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { snapshotGroupModes } from '@/lib/testing/groupModes';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest, storedRosterKey } from '@/lib/testing/roll';

/**
 * The lobby state machine and the rating fold (M2.5) against the Supabase CLI local stack:
 * the same ingest the route handlers call, the same service-role client, the same SQL.
 *
 * Ingest never balances (2026-10-03): every case that needs teams posts the lobby and then
 * rolls it, the way an admin's press does. The clock is injected, so the two-hour sweep is not
 * waited out. `ingestLobby` takes `now`; the sweep takes `now`; and the one case that has to prove the
 * route runs the sweep inserts a lobby row with an old `updated_at` (the `updated_at` trigger
 * is `before update`, so an insert may set it).
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the lobby state machine against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');
  // M5.11 acceptance (4): the sweep with no companion post at all.
  const { GET: getSweep } = await import('../cron/sweep/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  /** Ten, plus the extras each case needs. Namespaced so reruns and other files never collide. */
  const puuids = testPuuids(runId);
  const spare = `it-${runId}-spare`;
  const watcher = `it-${runId}-watcher`;
  const allPuuids = new Set<string>([...puuids, spare, watcher]);
  const partyIds = new Set<string>();
  const gameIds = new Set<number>();

  let ownerPlayerId = '';
  let ownerToken = '';
  let secondToken = '';

  function party(name: string): string {
    const id = `st-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function gameNumber(): number {
    const id = testGameId() + gameIds.size;
    gameIds.add(id);
    return id;
  }

  interface MemberSpec {
    puuid: string;
    side?: 100 | 200 | null;
    isSpectator?: boolean;
  }

  function body(partyId: string, members: readonly MemberSpec[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs night',
      members: members.map((member, index) => ({
        puuid: member.puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 2000 + index,
        side: member.side === undefined ? (index < 5 ? 100 : 200) : member.side,
        isSpectator: member.isSpectator ?? false,
      })),
    };
  }

  function onTeams(list: readonly string[]): MemberSpec[] {
    return list.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200 }));
  }

  /** The ingest the route calls, with the clock the test wants. */
  function ingest(partyId: string, members: readonly MemberSpec[], now: Date) {
    const payload = companionLobbyPayloadSchema.parse(body(partyId, members));
    return ingestLobby(db, payload, ownerPlayerId, { groupId: ORIGINAL_GROUP_ID, now });
  }

  /** An admin's roll against the stored roster, and what the listeners were told. */
  async function roll(lobbyId: string, now: Date = new Date()): Promise<BalanceOutcome> {
    const rolled = await rollForTest(db, lobbyId, { now, timeZone: TIME_ZONE });
    if (rolled.outcome !== 'rolled') throw new Error(`lobby ${lobbyId} was already rolled`);
    return rolled.balance;
  }

  function request(json: unknown, token: string): Request {
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  }

  async function splitRows(lobbyId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await db
      .from('splits')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('created_at', { ascending: true })
      .order('rank', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function lobbyStatus(lobbyId: string): Promise<string> {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  /** The puuids stored for a lobby, sorted, so a frozen roster can be compared to the cast. */
  async function memberPuuids(lobbyId: string): Promise<string[]> {
    const { data, error } = await db
      .from('lobby_members')
      .select('players!inner(puuid)')
      .eq('lobby_id', lobbyId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.players.puuid).sort();
  }

  /**
   * A lobby that reached `in_game` and has not been written to since: M5.11's stuck row.
   *
   * Inserted rather than driven there, because `lobbies_set_updated_at` is a `before update`
   * trigger — the clock can only be set on the way in. That matters more than it looks: it
   * lets every case below sweep with the **real** `now`, so nothing here can touch a row that
   * is not genuinely two hours stale, on a local stack other agents are using.
   */
  async function stuckInGame(
    partyId: string,
    cast: readonly string[],
    idleMs: number,
    ageMs: number = idleMs,
  ): Promise<string> {
    const now = Date.now();
    const { data, error } = await db
      .from('lobbies')
      .insert({
        group_id: ORIGINAL_GROUP_ID,
        lcu_party_id: partyId,
        status: 'in_game',
        reported_by_player_id: ownerPlayerId,
        lobby_name: 'customs night',
        created_at: new Date(now - ageMs).toISOString(),
        updated_at: new Date(now - idleMs).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const rows = await Promise.all(
      cast.map(async (puuid, index) => ({
        lobby_id: data.id,
        player_id: await playerIdOf(puuid),
        side: index < 5 ? 100 : 200,
        is_spectator: false,
      })),
    );
    const { error: memberError } = await db.from('lobby_members').insert(rows);
    if (memberError) throw new Error(memberError.message);
    return data.id;
  }

  async function playerIdOf(puuid: string): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const id = ids.get(puuid);
    if (id === undefined) throw new Error(`no player for ${puuid}`);
    return id;
  }

  async function mintToken(puuid: string): Promise<string> {
    const playerId = await playerIdOf(puuid);
    const { token, tokenHash } = mintCompanionToken();
    const { error } = await db.from('companion_tokens').insert({
      group_id: ORIGINAL_GROUP_ID,
      player_id: playerId,
      token_hash: tokenHash,
      label: `st-${runId}`,
    });
    if (error) throw new Error(error.message);
    return token;
  }

  /** A finished game with no lobby, purely so somebody has "games tonight". */
  async function recordGame(puuid: string, startedAt: Date): Promise<void> {
    const lcuGameId = gameNumber();
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: ORIGINAL_GROUP_ID,
        lcu_game_id: lcuGameId,
        started_at: startedAt.toISOString(),
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const { error: playerError } = await db.from('game_players').insert({
      group_id: ORIGINAL_GROUP_ID,
      game_id: data.id,
      player_id: await playerIdOf(puuid),
      side: 100,
    });
    if (playerError) throw new Error(playerError.message);
  }

  /** A cast of its own, so no other case's games or splits can order or seed this one. */
  async function freshCast(label: string, count = 10): Promise<string[]> {
    const cast = Array.from(
      { length: count },
      (_, index) => `it-${runId}-${label}${String(index).padStart(2, '0')}`,
    );
    for (const puuid of cast) allPuuids.add(puuid);
    await ensurePlayers(
      db,
      cast.map((puuid) => ({ puuid })),
    );
    return cast;
  }

  /** The ten puuids of a split, as a set, so blue and red can be compared colour-agnostically. */
  function sideOf(assignments: readonly { puuid: string }[]): Set<string> {
    return new Set(assignments.map((assignment) => assignment.puuid));
  }

  function sameFive(a: Set<string>, b: Set<string>): boolean {
    return a.size === b.size && [...a].every((puuid) => b.has(puuid));
  }

  /**
   * Rolled lobbies here record games in the real `customs` group, and since M15.3 each one runs
   * compare-and-clear on its Mode card. Put the card back the way this file found it.
   */
  let restoreGroupModes: () => Promise<void> = async () => {};

  beforeAll(async () => {
    restoreGroupModes = await snapshotGroupModes(db, ORIGINAL_GROUP_ID);
    await ensurePlayers(
      db,
      [...allPuuids].map((puuid) => ({ puuid })),
    );
    ownerPlayerId = await playerIdOf(puuids[0] ?? '');
    ownerToken = await mintToken(puuids[0] ?? '');
    secondToken = await mintToken(puuids[1] ?? '');
  });

  afterAll(async () => {
    await restoreGroupModes();
    await db
      .from('games')
      .delete()
      .in('lcu_game_id', [...gameIds]);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db
      .from('players')
      .delete()
      .in('puuid', [...allPuuids]);
  });

  describe('no auto-balance: an admin rolls (2026-10-03)', () => {
    it('leaves nine people open forever, with nothing to knock about', async () => {
      const id = party('nine');
      const start = new Date();

      const first = await ingest(id, onTeams(puuids.slice(0, 9)), start);
      expect(first).toMatchObject({ status: 'open', memberCount: 9, recheckInMs: null });

      const later = await ingest(id, onTeams(puuids.slice(0, 9)), new Date(start.getTime() + 30_000));
      expect(later).toMatchObject({ status: 'open', recheckInMs: null });
      expect(await splitRows(first.lobbyId)).toHaveLength(0);
    });

    it('leaves ten still people open, however long they sit there, until somebody rolls', async () => {
      const id = party('ten-still');
      const start = new Date();

      const first = await ingest(id, onTeams(puuids), start);
      expect(first).toMatchObject({ status: 'open', memberCount: 10, recheckInMs: null });

      // What used to be the ten-second mark, and well past it: still open, no splits, no knock.
      for (const offset of [10_001, 60_000, 30 * 60_000]) {
        const again = await ingest(id, onTeams(puuids), new Date(start.getTime() + offset));
        expect(again).toMatchObject({ status: 'open', memberCount: 10, recheckInMs: null });
      }
      expect(await splitRows(first.lobbyId)).toHaveLength(0);

      // The press is what balances.
      await roll(first.lobbyId);
      expect(await lobbyStatus(first.lobbyId)).toBe('balanced');
    });

    it('balances nine on teams plus one spectator: a spectator is one of the people here', async () => {
      const id = party('nine-plus-watcher');
      const members: MemberSpec[] = [
        ...onTeams(puuids.slice(0, 9)),
        { puuid: watcher, side: null, isSpectator: true },
      ];

      const first = await ingest(id, members, new Date());
      expect(first).toMatchObject({ status: 'open', memberCount: 10, recheckInMs: null });

      await roll(first.lobbyId);
      expect(await lobbyStatus(first.lobbyId)).toBe('balanced');

      const rows = await splitRows(first.lobbyId);
      expect(rows).toHaveLength(3);
      const chosen = rows.find((row) => row.is_chosen === true);
      const blue = chosen?.blue as { puuid: string }[];
      const red = chosen?.red as { puuid: string }[];
      expect([...blue, ...red].map((entry) => entry.puuid)).toContain(watcher);
    });

    it('rolls into exactly three splits with one chosen', async () => {
      const id = party('ten');

      const first = await ingest(id, onTeams(puuids), new Date());
      expect(await splitRows(first.lobbyId)).toHaveLength(0);

      await roll(first.lobbyId);

      const rows = await splitRows(first.lobbyId);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
      expect(rows.filter((row) => row.is_chosen === true)).toHaveLength(1);
      expect(rows.find((row) => row.is_chosen === true)?.rank).toBe(1);
      expect(new Set(rows.map((row) => row.roster_key))).toEqual(new Set([rosterKey(puuids)]));
      expect(rows.every((row) => typeof row.explanation === 'string' && row.explanation.length > 0)).toBe(
        true,
      );
    });

    it('does nothing at all on an identical post after the roll', async () => {
      const id = party('ten');
      const now = new Date(Date.now() + 60_000);
      const before = await splitRows((await ingest(id, onTeams(puuids), now)).lobbyId);

      const again = await ingest(id, onTeams(puuids), now);
      expect(again).toMatchObject({ status: 'balanced', recheckInMs: null });

      const after = await splitRows(again.lobbyId);
      expect(after).toHaveLength(3);
      expect(after.find((row) => row.is_chosen === true)?.id).toBe(
        before.find((row) => row.is_chosen === true)?.id,
      );
    });

    it('goes back to open when someone is swapped, and stays there until the next roll', async () => {
      const id = party('swap');

      const first = await ingest(id, onTeams(puuids), new Date());
      await roll(first.lobbyId);
      expect(await lobbyStatus(first.lobbyId)).toBe('balanced');

      const swapped = [...puuids.slice(0, 9), spare];
      const reopened = await ingest(id, onTeams(swapped), new Date());
      expect(reopened).toMatchObject({ status: 'open', recheckInMs: null });
      expect(await splitRows(reopened.lobbyId)).toHaveLength(3);

      // Sitting there does not rebalance: the leave-after-a-roll needs another press.
      const later = await ingest(id, onTeams(swapped), new Date(Date.now() + 60_000));
      expect(later.status).toBe('open');
      expect(await splitRows(reopened.lobbyId)).toHaveLength(3);

      await roll(reopened.lobbyId);
      expect(await lobbyStatus(reopened.lobbyId)).toBe('balanced');

      const rows = await splitRows(reopened.lobbyId);
      expect(rows).toHaveLength(6);
      const chosen = rows.filter((row) => row.is_chosen === true);
      expect(chosen).toHaveLength(1);
      // The flag moved to the newer set; the older three are still there as history.
      expect(chosen[0]?.roster_key).toBe(rosterKey(swapped));
    });

    it('produces one balance and three splits when two admins press at the same moment', async () => {
      const id = party('race');

      const created = await ingest(id, onTeams(puuids), new Date());
      const key = await storedRosterKey(db, created.lobbyId);
      const press = () =>
        rollLobby(db, {
          lobbyId: created.lobbyId,
          rosterKey: key,
          now: new Date(),
          timeZone: TIME_ZONE,
          requestOrigin: null,
        });
      const answers = await Promise.all([press(), press()]);

      // Exactly one press balanced. The other either saw the teams already up, or caught the
      // first one between its claim and its splits and was told to wait; never a second balance.
      const rolled = answers.filter((answer) => answer.ok && answer.value.outcome === 'rolled');
      expect(rolled).toHaveLength(1);
      for (const answer of answers) {
        if (answer.ok) continue;
        expect(answer.status).toBe(409);
      }
      expect(await lobbyStatus(created.lobbyId)).toBe('balanced');
      const rows = await splitRows(created.lobbyId);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.is_chosen === true)).toHaveLength(1);
    });
  });

  describe('choosing the ten, and who sits', () => {
    it('sits whoever has played most tonight and puts the spectator in their slot', async () => {
      const id = party('eleven');
      const busy = puuids[3] ?? '';
      // Pinned to an hour into tonight, not an hour before now: run this at 06:20 Cairo and
      // "an hour ago" is last night, the games do not count, and nobody sits.
      const tonight = nightStart(new Date(), TIME_ZONE).getTime();
      await recordGame(busy, new Date(tonight + 60 * 60 * 1000));
      await recordGame(busy, new Date(tonight + 90 * 60 * 1000));

      const members: MemberSpec[] = [...onTeams(puuids), { puuid: watcher, side: null, isSpectator: true }];
      const first = await ingest(id, members, new Date());
      const outcome = await roll(first.lobbyId);

      expect(await lobbyStatus(first.lobbyId)).toBe('balanced');
      const chosen = [...outcome.split.blue, ...outcome.split.red].map((a) => a.puuid);

      expect(chosen).toHaveLength(10);
      expect(chosen).not.toContain(busy);
      expect(chosen).toContain(watcher);
      expect(outcome?.sitters.map((member) => member.puuid)).toEqual([busy]);
      expect(outcome?.seatMoves).toHaveLength(1);
      expect(outcome?.seatMoves[0]?.mover.puuid).toBe(watcher);
      expect(outcome?.seatMoves[0]?.sitter?.puuid).toBe(busy);
      expect(outcome?.tiedOnGames).toBe(false);

      // Nobody was removed from the lobby: sitting out is derived, never stored.
      const { count } = await db
        .from('lobby_members')
        .select('player_id', { count: 'exact', head: true })
        .eq('lobby_id', first.lobbyId);
      expect(count).toBe(11);
    });

    it('runs the night from 06:00 to 06:00, so a 02:00 game counts at 03:00 and not at 07:00', async () => {
      // A whole cast of its own, so no other case's history can order this one.
      const cast = Array.from({ length: 11 }, (_, index) => `it-${runId}-n${String(index).padStart(2, '0')}`);
      for (const puuid of cast) allPuuids.add(puuid);
      await ensurePlayers(
        db,
        cast.map((puuid) => ({ puuid })),
      );

      // A month out, so "tonight" is a night of the test's choosing.
      const hour = 60 * 60 * 1000;
      const nightA = nightStart(new Date(Date.now() + 30 * 24 * hour), TIME_ZONE);
      const at0200 = new Date(nightA.getTime() + 20 * hour);
      const at0300 = new Date(nightA.getTime() + 21 * hour);
      const nightB = nightStart(new Date(nightA.getTime() + 26 * hour), TIME_ZONE);
      const at0700 = new Date(nightB.getTime() + hour);

      // 02:00 is inside the night that started the previous morning, and outside the next one.
      expect(nightStart(at0300, TIME_ZONE).getTime()).toBe(nightA.getTime());
      expect(nightStart(at0700, TIME_ZONE).getTime()).toBe(nightB.getTime());
      expect(nightB.getTime()).toBeGreaterThan(at0200.getTime());

      // The last puuid in sort order, so with nothing counted it is the last to be sat.
      const late = cast[cast.length - 1] ?? '';
      await recordGame(late, at0200);

      const members = onTeams(cast);
      const sameNight = party('night-inside');
      const insideLobby = await ingest(sameNight, members, at0300);
      const inside = await roll(insideLobby.lobbyId, at0300);
      expect(inside.sitters.map((member) => member.puuid)).toEqual([late]);

      const nextNight = party('night-outside');
      const outsideLobby = await ingest(nextNight, members, at0700);
      const outside = await roll(outsideLobby.lobbyId, at0700);
      expect(outside.sitters.map((member) => member.puuid)).not.toContain(late);
      expect(outside.tiedOnGames).toBe(true);
    });
  });

  describe('in_game and the freeze', () => {
    it('moves to in_game on the in_progress post and stops moving the roster', async () => {
      const id = party('in-progress');
      const balanced = await ingest(id, onTeams(puuids), new Date());
      await roll(balanced.lobbyId);
      expect(await lobbyStatus(balanced.lobbyId)).toBe('balanced');

      const response = await postGame(
        request({ phase: 'in_progress', gameId: gameNumber(), partyId: id }, ownerToken),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, lobbyId: balanced.lobbyId });
      expect(await lobbyStatus(balanced.lobbyId)).toBe('in_game');

      // M2.9 regression: a companion that reconnects mid-game and posts three members.
      const partial = await postLobby(request(body(id, onTeams(puuids.slice(0, 3))), ownerToken));
      expect(await partial.json()).toMatchObject({
        status: 'in_game',
        rosterFrozen: true,
        memberCount: 10,
        recheckInMs: null,
      });
    });
  });

  describe('the rating fold', () => {
    it('rates a real game once, however many companions post it', async () => {
      const id = party('rated');
      const lcuGameId = gameNumber();
      const balanced = await ingest(id, onTeams(puuids), new Date());
      await roll(balanced.lobbyId);
      await postGame(request({ phase: 'in_progress', gameId: lcuGameId, partyId: id }, ownerToken));

      const eog = eogBody({ gameId: lcuGameId, puuids, partyId: id, durationS: 900, winningSide: 100 });
      const first = await postGame(request(eog, ownerToken));
      expect(first.status).toBe(200);
      const gameRowId = (await first.json()).gameId as string;

      expect(await lobbyStatus(balanced.lobbyId)).toBe('finished');

      const { data: players } = await db
        .from('game_players')
        .select('player_id, side, mu_before, sigma_before, mu_after, sigma_after')
        .eq('game_id', gameRowId);
      expect(players).toHaveLength(10);
      expect(
        players?.every(
          (row) =>
            row.mu_before !== null &&
            row.sigma_before !== null &&
            row.mu_after !== null &&
            row.sigma_after !== null,
        ),
      ).toBe(true);
      // The winners went up and the losers went down.
      expect(
        players?.filter((row) => row.side === 100).every((row) => (row.mu_after ?? 0) > (row.mu_before ?? 0)),
      ).toBe(true);
      expect(
        players?.filter((row) => row.side === 200).every((row) => (row.mu_after ?? 0) < (row.mu_before ?? 0)),
      ).toBe(true);

      const { data: ratings } = await db
        .from('ratings')
        .select('player_id, mu, sigma, games, wins, updated_at')
        .in(
          'player_id',
          (players ?? []).map((row) => row.player_id),
        );
      expect(ratings).toHaveLength(10);
      expect(ratings?.every((row) => row.games === 1)).toBe(true);
      expect(ratings?.filter((row) => row.wins === 1)).toHaveLength(5);

      const before = JSON.stringify(
        [...(ratings ?? [])].sort((a, b) => (a.player_id < b.player_id ? -1 : 1)),
      );

      // A second companion in the same game posts the same block.
      const second = await postGame(request(eog, secondToken));
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ created: false, participants: 10 });

      const { data: after } = await db
        .from('ratings')
        .select('player_id, mu, sigma, games, wins, updated_at')
        .in(
          'player_id',
          (players ?? []).map((row) => row.player_id),
        );
      expect(JSON.stringify([...(after ?? [])].sort((a, b) => (a.player_id < b.player_id ? -1 : 1)))).toBe(
        before,
      );

      const { count } = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('lcu_game_id', lcuGameId);
      expect(count).toBe(1);
    });

    it.each([
      ['300 seconds exactly is not a game', { durationS: 300 }, false],
      ['301 seconds is', { durationS: 301 }, true],
    ])('%s', async (_label, options, rated) => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-g${String(gameIds.size)}-${i}`);
      for (const puuid of cast) allPuuids.add(puuid);

      const response = await postGame(
        request(eogBody({ gameId: lcuGameId, puuids: cast, ...options }), ownerToken),
      );
      // The caller is not on this scoreboard, so it is posted by one of its own players.
      expect([200, 403]).toContain(response.status);
      const token = await mintToken(cast[0] ?? '');
      const posted = await postGame(request(eogBody({ gameId: lcuGameId, puuids: cast, ...options }), token));
      const gameRowId = (await posted.json()).gameId as string;

      const { data } = await db.from('game_players').select('mu_after').eq('game_id', gameRowId);
      expect(data).toHaveLength(10);
      expect(data?.every((row) => row.mu_after !== null)).toBe(rated);
    });

    it.each([
      ['nine participants', 9, [100, 100, 100, 100, 100, 200, 200, 200, 200]],
      ['six and four', 10, [100, 100, 100, 100, 100, 100, 200, 200, 200, 200]],
    ])('stores %s and does not rate them', async (_label, count, sides) => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: count }, (_, i) => `it-${runId}-u${String(gameIds.size)}-${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const base = eogBody({ gameId: lcuGameId, puuids: cast, durationS: 1_200 });
      const participants = (base.participants as Record<string, unknown>[]).map((participant, index) => ({
        ...participant,
        side: sides[index],
      }));

      const response = await postGame(request({ ...base, participants }, token));
      expect(response.status).toBe(200);
      const gameRowId = (await response.json()).gameId as string;

      const { data } = await db.from('game_players').select('mu_after').eq('game_id', gameRowId);
      expect(data).toHaveLength(count);
      expect(data?.every((row) => row.mu_after === null)).toBe(true);

      const { count: ratingCount } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .in('player_id', await Promise.all(cast.map((puuid) => playerIdOf(puuid))));
      expect(ratingCount).toBe(0);
    });

    it('rates a game whose party id matches no lobby, with lobby_id null', async () => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-o${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const response = await postGame(
        request(
          eogBody({ gameId: lcuGameId, puuids: cast, partyId: `st-${runId}-never-seen`, durationS: 1_500 }),
          token,
        ),
      );
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.lobbyId).toBeNull();

      const { data } = await db
        .from('game_players')
        .select('mu_after')
        .eq('game_id', json.gameId as string);
      expect(data?.every((row) => row.mu_after !== null)).toBe(true);
    });

    it('seeds every unrated player at the same neutral number, whatever their rank', async () => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-s${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const unranked = cast[0] ?? '';
      const platinum = cast[9] ?? '';
      await ensurePlayers(
        db,
        cast.map((puuid) => ({ puuid })),
      );
      await db
        .from('players')
        .update({ rank_tier: 'PLATINUM', rank_division: 'I', rank_updated_at: new Date().toISOString() })
        .eq('puuid', platinum);

      const response = await postGame(
        request(eogBody({ gameId: lcuGameId, puuids: cast, durationS: 1_500 }), token),
      );
      const gameRowId = (await response.json()).gameId as string;

      const { data } = await db
        .from('game_players')
        .select('mu_before, sigma_before, players!inner(puuid)')
        .eq('game_id', gameRowId);
      const seeded = new Map((data ?? []).map((row) => [row.players.puuid, row]));

      // No rank at all: the provisional seed, mu 20.00 and sigma 12.00 — the sigma of a customs
      // history that does not exist yet, not of an unranked player (`provisionalSeed`).
      expect(seeded.get(unranked)?.mu_before).toBeCloseTo(20, 6);
      expect(seeded.get(unranked)?.sigma_before).toBeCloseTo(12, 6);
      // Platinum I, and the same two numbers (2026-09-16). This used to be 28.25 / 8.33 — a
      // 495-point head start on the person beside them, bought by a solo-queue rank neither of
      // them played a custom with. The rank is still on the `players` row; it starts nothing.
      expect(seeded.get(platinum)?.mu_before).toBeCloseTo(20, 6);
      expect(seeded.get(platinum)?.sigma_before).toBeCloseTo(12, 6);
    });
  });

  describe('last teams: not the same five again (M2.7, M21.8)', () => {
    /** The ten as the lookup takes them. */
    async function tenOf(cast: readonly string[]) {
      return Promise.all(cast.map(async (puuid) => ({ puuid, playerId: await playerIdOf(puuid) })));
    }

    /** The lobby's game, played on these sides (M21.8 reads `game_players.side`). */
    async function playGame(lobbyId: string, blue: Set<string>, red: Set<string>): Promise<void> {
      const { data, error } = await db
        .from('games')
        .insert({
          group_id: ORIGINAL_GROUP_ID,
          lobby_id: lobbyId,
          lcu_game_id: gameNumber(),
          started_at: new Date().toISOString(),
          duration_s: 1_800,
          winning_side: 100,
          raw: {},
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const rows = await Promise.all(
        [
          ...[...blue].map((puuid) => [puuid, 100] as const),
          ...[...red].map((puuid) => [puuid, 200] as const),
        ].map(async ([puuid, side]) => ({
          group_id: ORIGINAL_GROUP_ID,
          game_id: data.id,
          player_id: await playerIdOf(puuid),
          side,
        })),
      );
      const players = await db.from('game_players').insert(rows);
      if (players.error) throw new Error(players.error.message);
    }

    it('hands the balancer the teams these ten last played, and split 1 is not a repeat', async () => {
      const cast = await freshCast('ls');
      const id = party('last-split');

      // Night's first game for these ten.
      const openedA = await ingest(id, onTeams(cast), new Date());
      const chosenA = await roll(openedA.lobbyId);

      const blueA = sideOf(chosenA.split.blue);
      const redA = sideOf(chosenA.split.red);

      const ten = await tenOf(cast);
      // M21.8: a roll nobody played is not "last time".
      expect(await selectLastPlayedTeams(db, ten, ORIGINAL_GROUP_ID, null)).toBeNull();

      // They play the roll as rolled.
      await playGame(openedA.lobbyId, blueA, redA);

      // The lookup the balancer is handed: the newest teams these ten played.
      const stored = await selectLastPlayedTeams(db, ten, ORIGINAL_GROUP_ID, null);
      expect(stored).not.toBeNull();
      expect(new Set(stored ?? [])).toEqual(blueA);
      // M13.3: the same ten in another group are another group's history.
      expect(await selectLastPlayedTeams(db, ten, randomUUID(), null)).toBeNull();

      // Game one closes the row; the same party opens the night's next cycle (M2.14).
      await db.from('lobbies').update({ status: 'finished' }).eq('id', openedA.lobbyId);
      const openedB = await ingest(id, onTeams(cast), new Date());
      expect(openedB.created).toBe(true);
      expect(openedB.lobbyId).not.toBe(openedA.lobbyId);

      const chosenB = await roll(openedB.lobbyId);

      // Same ten, so the same key finds the history; a different five, because the repeat
      // carries core's penalty.
      expect(chosenB.rosterKey).toBe(chosenA.rosterKey);
      const blueB = sideOf(chosenB.split.blue);
      expect(sameFive(blueB, blueA)).toBe(false);
      expect(sameFive(blueB, redA)).toBe(false);
      expect(sameFive(sideOf(chosenB.split.red), blueA)).toBe(false);
    });

    it('has no history to avoid once one player is swapped', async () => {
      const cast = await freshCast('ls2');
      const swapped = [...cast.slice(0, 9), spare];
      const id = party('last-split-swap');

      const opened = await ingest(id, onTeams(cast), new Date());
      const chosen = await roll(opened.lobbyId);

      // Change one player and the key changes with them: nothing to repeat, nothing to avoid.
      const changed = await ingest(id, onTeams(swapped), new Date());
      expect(changed.status).toBe('open');
      const chosenAgain = await roll(changed.lobbyId);

      expect(chosenAgain.rosterKey).not.toBe(chosen.rosterKey);
      // These ten never played together, which is the `lastSplit: null` the balancer was called
      // with; the one chosen split for them is the roll's own.
      expect(await selectLastPlayedTeams(db, await tenOf(swapped), ORIGINAL_GROUP_ID, null)).toBeNull();
      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('roster_key', chosenAgain.rosterKey)
        .eq('is_chosen', true);
      expect(count).toBe(1);
    });
  });

  describe('the Discord seam (M3.1 fills it)', () => {
    afterEach(() => {
      clearLobbyHooks();
    });

    it('balances and stores three splits even when a listener throws', async () => {
      const cast = await freshCast('hk');
      const id = party('hook-throws');
      const seen: string[] = [];

      // What a webhook being down looks like from in here.
      registerLobbyHook({
        onBalanced: (event) => {
          seen.push(event.splitId);
          throw new Error('discord is down');
        },
      });

      const opened = await ingest(id, onTeams(cast), new Date());
      const balanced = await roll(opened.lobbyId);

      expect(await lobbyStatus(opened.lobbyId)).toBe('balanced');
      const rows = await splitRows(opened.lobbyId);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.is_chosen === true)).toHaveLength(1);
      // The listener did run, and its throw cost the lobby nothing.
      expect(seen).toEqual([balanced.splitId]);
    });

    it('answers 200 through the companion route with a listener registered, and never calls it', async () => {
      const cast = await freshCast('hk2');
      const id = party('hook-throws-route');
      const seen: string[] = [];
      registerLobbyHook({
        onBalanced: (event) => {
          seen.push(event.splitId);
          throw new Error('discord is down');
        },
      });

      const token = await mintToken(cast[0] ?? '');
      const response = await postLobby(request(body(id, onTeams(cast)), token));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        status: 'open',
        memberCount: 10,
        recheckInMs: null,
      });

      // The same ten again: a companion post never balances, so the hook never hears a thing.
      const again = await postLobby(request(body(id, onTeams(cast)), token));
      expect(await again.json()).toMatchObject({ status: 'open', recheckInMs: null });
      expect(seen).toEqual([]);
    });
  });

  describe('a game whose lobby was given up on', () => {
    it('stores and rates it with lobby_id null rather than linking an abandoned row', async () => {
      const cast = await freshCast('ab');
      const id = party('abandoned-game');
      const lcuGameId = gameNumber();

      const opened = await ingest(id, onTeams(cast), new Date());
      // Two hours of nothing: the sweep gives up on the lobby, and then the block arrives.
      const swept = await sweepIdleLobbies(db, new Date(Date.now() + 2 * 60 * 60 * 1000 + 60_000));
      expect(swept).toBeGreaterThan(0);
      expect(await lobbyStatus(opened.lobbyId)).toBe('abandoned');

      const token = await mintToken(cast[0] ?? '');
      const response = await postGame(
        request(eogBody({ gameId: lcuGameId, puuids: cast, partyId: id, durationS: 1_200 }), token),
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({ ok: true, created: true, participants: 10 });
      // Not linked to the row the sweep abandoned, and rated all the same.
      expect(json.lobbyId).toBeNull();
      expect(await lobbyStatus(opened.lobbyId)).toBe('abandoned');

      const { data } = await db
        .from('game_players')
        .select('mu_after')
        .eq('game_id', json.gameId as string);
      expect(data).toHaveLength(10);
      expect(data?.every((row) => row.mu_after !== null)).toBe(true);
    });

    it('says so in the log when the lobby is already finished and cannot move again', async () => {
      const cast = await freshCast('fin');
      const id = party('already-finished');
      const lcuGameId = gameNumber();
      const token = await mintToken(cast[0] ?? '');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const opened = await ingest(id, onTeams(cast), new Date());
        await db.from('lobbies').update({ status: 'finished' }).eq('id', opened.lobbyId);

        const eog = eogBody({
          gameId: lcuGameId,
          puuids: cast,
          partyId: id,
          durationS: 1_200,
          // Before the row was closed, so it still resolves to the cycle it was played in.
          startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        });
        const response = await postGame(request(eog, token));

        expect(response.status).toBe(200);
        expect((await response.json()).lobbyId).toBe(opened.lobbyId);
        expect(
          warn.mock.calls.some(
            (call) =>
              typeof call[0] === 'string' &&
              call[0].includes(opened.lobbyId) &&
              call[0].includes('finished -> finished'),
          ),
        ).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('the idle sweep', () => {
    it('abandons an idle lobby, keeps a fresh one, and drops a three-hour-old game', async () => {
      const now = Date.now();
      const stale = party('stale');
      const fresh = party('fresh');
      const playing = party('playing');

      // The `updated_at` trigger is `before update`, so an insert may set it.
      const { data, error } = await db
        .from('lobbies')
        .insert([
          {
            group_id: ORIGINAL_GROUP_ID,
            lcu_party_id: stale,
            status: 'open',
            updated_at: new Date(now - (2 * 60 * 60 * 1000 + 60_000)).toISOString(),
          },
          {
            group_id: ORIGINAL_GROUP_ID,
            lcu_party_id: fresh,
            status: 'balanced',
            updated_at: new Date(now - (60 * 60 * 1000 + 59 * 60_000)).toISOString(),
          },
          {
            group_id: ORIGINAL_GROUP_ID,
            lcu_party_id: playing,
            status: 'in_game',
            updated_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          },
        ])
        .select('id, lcu_party_id');
      if (error) throw new Error(error.message);
      const idOf = new Map((data ?? []).map((row) => [row.lcu_party_id, row.id]));

      // Any later companion post runs the sweep; this one is a lobby the caller is in.
      const other = party('sweeper');
      const response = await postLobby(request(body(other, onTeams(puuids.slice(0, 3))), ownerToken));
      expect(response.status).toBe(200);

      expect(await lobbyStatus(idOf.get(stale) ?? '')).toBe('abandoned');
      expect(await lobbyStatus(idOf.get(fresh) ?? '')).toBe('balanced');
      // `in_game` is never `abandoned` — that would unfreeze the record of who played — but
      // it does age out, into `dropped` (M5.11): three hours is not a game, it is a game
      // whose end-of-game block never arrived.
      expect(await lobbyStatus(idOf.get(playing) ?? '')).toBe('dropped');
    });

    it('sweeps nothing when nothing is stale', async () => {
      expect(await sweepIdleLobbies(db, new Date())).toBe(0);
    });
  });

  /**
   * M5.11. The client keeps one party id all night (M2.14) and
   * `lobbies_active_party_idx` allows one live row per party, so an `in_game` row that never
   * got its end-of-game block used to answer every later post of that night with
   * `rosterFrozen: true` and no way to roll — no teams, no split, and
   * nothing to see from inside Discord. `dropped` is the door out.
   */
  describe('a lobby stuck at in_game (M5.11)', () => {
    it('is dropped two hours on, and the party gets a clean cycle with its own teams', async () => {
      const cast = await freshCast('stuck');
      const id = party('stuck');
      const token = await mintToken(cast[0] ?? '');
      const stuckId = await stuckInGame(id, cast, IDLE_ABANDON_MS + 60_000);

      // The night's next lobby post, through the route: the sweep runs first, so this lands
      // on a party with no live row and opens one.
      const response = await postLobby(request(body(id, onTeams(cast)), token));
      expect(response.status).toBe(200);
      const opened = (await response.json()) as { lobbyId: string };
      expect(opened).toMatchObject({ created: true, status: 'open', memberCount: 10, rosterFrozen: false });
      expect(opened.lobbyId).not.toBe(stuckId);

      // The stuck row left the live set and took nothing with it: the ten who played that
      // game are still on it, exactly as `in_game` froze them.
      expect(await lobbyStatus(stuckId)).toBe('dropped');
      expect(await memberPuuids(stuckId)).toEqual([...cast].sort());
      expect(await splitRows(stuckId)).toHaveLength(0);

      // And the new cycle behaves like any other: ten members, a roll, three splits, one chosen.
      await roll(opened.lobbyId);
      expect(await lobbyStatus(opened.lobbyId)).toBe('balanced');
      const splits = await splitRows(opened.lobbyId);
      expect(splits).toHaveLength(3);
      expect(splits.filter((row) => row.is_chosen === true)).toHaveLength(1);
    });

    it('changes nothing for a game that is still being played, at one hour fifty-nine', async () => {
      const cast = await freshCast('inflight');
      const id = party('inflight');
      const token = await mintToken(cast[0] ?? '');
      const liveId = await stuckInGame(id, cast, IDLE_ABANDON_MS - 60_000);

      // A companion that reconnects mid-game and posts three members: the M2.9 answer,
      // unchanged. Two hours is two hours, not "any long game".
      const response = await postLobby(request(body(id, onTeams(cast.slice(0, 3))), token));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        lobbyId: liveId,
        status: 'in_game',
        created: false,
        rosterFrozen: true,
        memberCount: 10,
        recheckInMs: null,
      });
      expect(await lobbyStatus(liveId)).toBe('in_game');
      expect(await memberPuuids(liveId)).toEqual([...cast].sort());
    });

    it('still closes the dropped lobby when the block finally arrives, and rates it', async () => {
      const cast = await freshCast('late');
      const id = party('late-eog');
      const token = await mintToken(cast[0] ?? '');
      const lcuGameId = gameNumber();
      // Opened ten minutes before the game started; nothing written to it since it went
      // `in_game`. That ordering is what makes the block resolve to this row and not to the
      // cycle the group opened afterwards.
      const stuckId = await stuckInGame(id, cast, IDLE_ABANDON_MS + 60_000, IDLE_ABANDON_MS + 11 * 60_000);
      const startedAt = new Date(Date.now() - (IDLE_ABANDON_MS + 5 * 60_000)).toISOString();

      const opened = (await (await postLobby(request(body(id, onTeams(cast)), token))).json()) as {
        lobbyId: string;
      };
      expect(await lobbyStatus(stuckId)).toBe('dropped');

      const response = await postGame(
        request(
          eogBody({ gameId: lcuGameId, puuids: cast, partyId: id, durationS: 1_500, startedAt }),
          token,
        ),
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { lobbyId: string; gameId: string };
      expect(json).toMatchObject({ ok: true, created: true, participants: 10, rated: true });
      // The cycle it was played from, closed by the block that was days late.
      expect(json.lobbyId).toBe(stuckId);
      expect(await lobbyStatus(stuckId)).toBe('finished');
      // The night's next cycle is not touched by a block from the last one.
      expect(await lobbyStatus(opened.lobbyId)).toBe('open');

      const { data } = await db.from('game_players').select('mu_after').eq('game_id', json.gameId);
      expect(data).toHaveLength(10);
      expect(data?.every((row) => row.mu_after !== null)).toBe(true);
    });

    it('is dropped by GET /api/cron/sweep alone, with no companion post', async () => {
      const cast = await freshCast('cron');
      const id = party('cron-sweep');
      const stuckId = await stuckInGame(id, cast, IDLE_ABANDON_MS + 60_000);
      const secret = `sweep-${runId}`;
      const saved = process.env.CRON_SECRET;
      process.env.CRON_SECRET = secret;

      try {
        const response = await getSweep(
          new Request('http://localhost/api/cron/sweep', {
            headers: { authorization: `Bearer ${secret}` },
          }),
        );

        expect(response.status).toBe(200);
        const json = (await response.json()) as { ok: boolean; swept: number };
        expect(json.ok).toBe(true);
        expect(json.swept).toBeGreaterThanOrEqual(1);
      } finally {
        if (saved === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = saved;
      }

      // Nobody posted anything: the scheduler alone is enough to unblock the party, which is
      // the case that matters — everyone closed the client with the game unreported.
      expect(await lobbyStatus(stuckId)).toBe('dropped');
      expect(await memberPuuids(stuckId)).toEqual([...cast].sort());
    });
  });
}
