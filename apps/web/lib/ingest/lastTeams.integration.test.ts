import { randomUUID } from 'node:crypto';
import { balance, type Role, type Split, whyLower } from '@customs/core';
import type { Database } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePlayers } from '@/lib/ingest/players';
import { testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * M21.8 against the local stack: the balancer's "last game's teams again" and the fill guard
 * follow the teams that were **played**, not the split the bot suggested.
 *
 * The roster is role-locked (two mains per role) with Ratings picked so that, by gap alone, the
 * teams P are the best split and SA the next; P's repeat (+200) drops it to second but no lower.
 *
 * 1. Two nights ago the ten played P with no roll.
 * 2. Last night's roll avoids P and suggests SA; the receipt's runner-up is P, "last game's teams
 *    again". The room ignores SA and plays P again by hand.
 * 3. Tonight's roll reads P as the last teams (not SA): it suggests SA again, P is again the
 *    runner-up for the repeat. The old input (the last chosen split, SA) would have put P first.
 * 4. They play SA as rolled; the next roll's splits are byte-identical to the old input's (the
 *    last chosen split and the played teams are the same teams).
 * 5. The fill guard counts everybody in the hand-swapped game, and the refold releases a stored
 *    `false` there and keeps the one in the game played as rolled.
 *
 * Its own scratch group. Skipped, not failed, without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('last teams against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { ingestLobby } = await import('./lobby');
  const { loadGroupPool, loadRecentTeammates, selectLastPlayedTeams, toBalancePlayer } = await import(
    './balance'
  );
  const { releaseFillFlags, roleInferenceFlags, selectReleasedFillFlags } = await import('./roles');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const TWO_NIGHTS_AGO = '2026-09-18T18:00:00.000Z';
  const LAST_NIGHT = new Date('2026-09-19T17:00:00.000Z');
  const LAST_NIGHT_GAME = '2026-09-19T17:30:00.000Z';
  const TONIGHT = new Date('2026-09-20T17:00:00.000Z');
  const TONIGHT_GAME = '2026-09-20T17:30:00.000Z';
  const LATER = new Date('2026-09-20T19:00:00.000Z');

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId, 10);
  const p = (i: number) => puuids[i] as string;
  const partyId = `last-teams-${runId}`;
  const base = testGameId();
  const LANES: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];
  const mainOf = (i: number) => LANES[Math.floor(i / 2)] as Role;
  const RATINGS = [1150, 1040, 1240, 1210, 1050, 1490, 1220, 1110, 1400, 1240];

  /** P: the best split by gap. SA: the next one. Both role-locked (nobody off-role). */
  const P_BLUE = [p(0), p(2), p(4), p(6), p(8)];
  const P_RED = [p(1), p(3), p(5), p(7), p(9)];
  const SA_BLUE = [p(0), p(3), p(4), p(6), p(8)];
  const SA_RED = [p(1), p(2), p(5), p(7), p(9)];

  let group = '';
  let ids: ReadonlyMap<string, string> = new Map();
  let games = 0;
  const lobbies: Record<'a' | 'b', string> = { a: '', b: '' };
  const gameIds: Record<'a' | 'b', string> = { a: '', b: '' };

  const key = (side: readonly { puuid: string }[] | readonly string[]) =>
    side
      .map((x) => (typeof x === 'string' ? x : x.puuid))
      .sort()
      .join(' ');
  /** The split has these teams, on either side. */
  const isTeams = (split: Split | undefined, blue: readonly string[]) =>
    split !== undefined && (key(split.blue) === key(blue) || key(split.red) === key(blue));

  async function insertGame(lobbyId: string | null, startedAt: string, blue: string[], red: string[]) {
    games += 1;
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: group,
        lobby_id: lobbyId,
        lcu_game_id: base + games,
        started_at: startedAt,
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(`game insert: ${error.message}`);
    const rows = [...blue.map((x) => [x, 100] as const), ...red.map((x) => [x, 200] as const)].map(
      ([puuid, side]) => ({
        game_id: data.id,
        group_id: group,
        player_id: ids.get(puuid) as string,
        side,
        role: mainOf(puuids.indexOf(puuid)),
      }),
    );
    const players = await db.from('game_players').insert(rows);
    if (players.error) throw new Error(`game_players insert: ${players.error.message}`);
    return data.id;
  }

  async function openLobby(now: Date): Promise<string> {
    const owner = ids.get(p(0)) as string;
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'last teams',
      members: puuids.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 8000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    });
    const opened = await ingestLobby(db, payload, owner, { groupId: group, now });
    expect(opened.status).toBe('open');
    return opened.lobbyId;
  }

  async function roll(lobbyId: string, now: Date) {
    const rolled = await rollForTest(db, lobbyId, { now, timeZone: TIME_ZONE });
    if (rolled.outcome !== 'rolled') throw new Error('the lobby did not balance');
    return rolled.balance;
  }

  async function finish(lobbyId: string) {
    const { error } = await db.from('lobbies').update({ status: 'finished' }).eq('id', lobbyId);
    if (error) throw new Error(error.message);
  }

  const ten = () => puuids.map((puuid) => ({ puuid, playerId: ids.get(puuid) as string }));

  /** The balancer's own inputs for this lobby, with the repeat input given. */
  async function coreFor(lobbyId: string, now: Date, lastSplit: readonly string[] | null) {
    const pool = await loadGroupPool(db, lobbyId, now, TIME_ZONE, group);
    return balance({
      players: pool.map(toBalancePlayer),
      duos: [],
      lastSplit,
      recentTeammates: await loadRecentTeammates(db, group, now, TIME_ZONE),
    });
  }

  beforeAll(async () => {
    ({ home: group } = await createTestGroups(db, runId, ['home'] as const));
    ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    for (const [index, puuid] of puuids.entries()) {
      const { error } = await db
        .from('players')
        .update({ main_role: mainOf(index), secondary_role: null })
        .eq('puuid', puuid);
      if (error) throw new Error(error.message);
    }
    const { error } = await db.from('ratings').insert(
      puuids.map((puuid, index) => ({
        group_id: group,
        player_id: ids.get(puuid) as string,
        r: RATINGS[index] as number,
        games: 20,
      })),
    );
    if (error) throw new Error(`ratings insert: ${error.message}`);
    // Two nights ago: P, no lobby, no roll.
    await insertGame(null, TWO_NIGHTS_AGO, P_BLUE, P_RED);
  });

  afterAll(async () => {
    await deleteTestGroups(db, [group]);
    await db.from('players').delete().in('puuid', puuids);
  });

  it("last night's roll avoids the teams they played, and the receipt says so", async () => {
    expect(await selectLastPlayedTeams(db, ten(), group, null)).toEqual([...P_BLUE].sort());
    lobbies.a = await openLobby(LAST_NIGHT);
    const rolled = await roll(lobbies.a, LAST_NIGHT);
    expect(isTeams(rolled.splits[0], SA_BLUE)).toBe(true);
    expect(isTeams(rolled.splits[1], P_BLUE)).toBe(true);
    expect(whyLower(rolled.splits[0] as Split, rolled.splits[1] as Split)).toEqual({ kind: 'repeat' });

    // The room ignores SA and plays P again, by hand.
    gameIds.a = await insertGame(lobbies.a, LAST_NIGHT_GAME, P_BLUE, P_RED);
    await finish(lobbies.a);
  });

  it('M21.8: after the hand-swapped game the played teams are the repeat, the ignored split is not', async () => {
    // The input is the played teams, not last night's chosen split.
    expect(await selectLastPlayedTeams(db, ten(), group, null)).toEqual([...P_BLUE].sort());

    lobbies.b = await openLobby(TONIGHT);
    const rolled = await roll(lobbies.b, TONIGHT);
    // SA again (it was never played), and P is the runner-up for the repeat: reason 3 names the
    // teams they played.
    expect(isTeams(rolled.splits[0], SA_BLUE)).toBe(true);
    expect(rolled.splits[0]?.scoreParts?.repeat).toBe(0);
    expect(isTeams(rolled.splits[1], P_BLUE)).toBe(true);
    expect(rolled.splits[1]?.scoreParts?.repeat).toBe(200);
    expect(whyLower(rolled.splits[0] as Split, rolled.splits[1] as Split)).toEqual({ kind: 'repeat' });

    // Exactly core's answer for the played teams; the pre-M21.8 input (the ignored SA) would
    // have suggested P, the teams they had just played twice.
    const played = await coreFor(lobbies.b, TONIGHT, P_BLUE);
    expect(rolled.splits).toEqual(played.splits);
    const old = await coreFor(lobbies.b, TONIGHT, SA_BLUE);
    expect(isTeams(old.splits[0], P_BLUE)).toBe(true);
  });

  it('a rolled-and-played night gives byte-identical splits to the old input', async () => {
    // They play SA as rolled.
    gameIds.b = await insertGame(lobbies.b, TONIGHT_GAME, SA_BLUE, SA_RED);
    await finish(lobbies.b);

    const { data: chosen, error } = await db
      .from('splits')
      .select('blue')
      .eq('lobby_id', lobbies.b)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    const chosenBlue = (chosen.blue as { puuid: string }[]).map((x) => x.puuid);

    const next = await openLobby(LATER);
    const rolled = await roll(next, LATER);
    // The old input was the last chosen split's blue; the new one is the same teams.
    const oldInput = await coreFor(next, LATER, chosenBlue);
    expect(rolled.splits).toEqual(oldInput.splits);
    expect(rolled.explanation).toBe(oldInput.explanations[0]);
  });

  it('the fill guard counts everybody in the hand-swapped game, and the refold releases it', async () => {
    // p0 as a support main for the guard's sake: their top seat is off-role.
    const rows = (blue: string[]) =>
      puuids.map((puuid, index) => ({
        playerId: ids.get(puuid) as string,
        puuid,
        mainRole: (index === 0 ? 'support' : mainOf(index)) as Role,
        secondaryRole: null,
        side: blue.includes(puuid) ? 100 : 200,
        role: mainOf(index),
      }));
    // Lobby A's split is SA; they played P: the bot chose none of those seats.
    expect(await roleInferenceFlags(db, lobbies.a, rows(P_BLUE))).toEqual(new Map());
    // Lobby B's split is SA and they played it: p0 was filled.
    expect(await roleInferenceFlags(db, lobbies.b, rows(SA_BLUE))).toEqual(
      new Map([[ids.get(p(0)) as string, false]]),
    );

    // History as the old guard wrote it: p0 filled in both games.
    const { error } = await db
      .from('game_players')
      .update({ counts_for_role_inference: false })
      .eq('player_id', ids.get(p(0)) as string)
      .in('game_id', [gameIds.a, gameIds.b]);
    if (error) throw new Error(error.message);

    const released = await selectReleasedFillFlags(db, group);
    expect(released).toEqual([{ gameId: gameIds.a, playerId: ids.get(p(0)) as string }]);
    expect(await releaseFillFlags(db, released)).toBe(1);
    // Idempotent: the refold runs once.
    expect(await selectReleasedFillFlags(db, group)).toEqual([]);
    const { data } = await db
      .from('game_players')
      .select('game_id, counts_for_role_inference')
      .eq('player_id', ids.get(p(0)) as string)
      .in('game_id', [gameIds.a, gameIds.b]);
    const flags = new Map((data ?? []).map((row) => [row.game_id, row.counts_for_role_inference]));
    expect(flags.get(gameIds.a)).toBe(true);
    expect(flags.get(gameIds.b)).toBe(false);
  });
}
