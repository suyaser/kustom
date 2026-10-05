import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M21.7 against the local stack: every after-game surface prints the odds of the teams that
 * played, through the one rule (`lib/games/receipt.ts`), read with the anon key as a phone reads
 * them (the result post with the service key, as the route does).
 *
 * One night, one group, the same ten, four games (oldest first):
 *
 * - **A, rolled and played.** Split 62% for blue; red won: `Upset`, exactly as before M21.7.
 * - **B, rolled then swapped.** The same split; two traded sides in the lobby, the kickoff record
 *   (`custom`) priced the real teams at 35% for blue, and blue won. Every surface says 35% and
 *   `Upset`, never the split's 62%; calibration does not count it (acceptance 2).
 * - **D, rolled, played on swapped sides.** The split's two teams on each other's sides (kickoff
 *   `rolled`, `swapped`), pick #2: the bot's teams, so its odds turned round, 38% for blue.
 * - **C, unrolled.** No split; kickoff `unrolled` at 30%. Every surface reads the kickoff odds
 *   (M21.14: the result post, the tape, the poster and /fun too, once compact surfaces printed none).
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('played odds against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { loadTonight, resultOfGame } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadResultSource } = await import('@/lib/discord/assemble');
  const { loadPlayerBoard } = await import('@/lib/board/load');
  const { loadFunFacts } = await import('@/lib/stats/load');
  const { loadGameDetail } = await import('@/lib/games/detail');
  const { loadCalibrationOrNone } = await import('@/lib/tonight/calibration');
  const { receiptUpset } = await import('@/lib/ai/facts');
  const { resultOdds } = await import('@/lib/receipt/copy');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  const puuids = Array.from({ length: 10 }, (_, i) => `it-${runId}-po${String(i).padStart(2, '0')}`);
  const p = (i: number) => puuids[i] as string;
  const LANES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

  /** The split: p0-p4 blue, p5-p9 red, in lane order. */
  const S_BLUE = [0, 1, 2, 3, 4].map(p);
  const S_RED = [5, 6, 7, 8, 9].map(p);
  /** B: p0 and p5 traded after the roll. */
  const B_BLUE = [p(5), p(1), p(2), p(3), p(4)];
  const B_RED = [p(0), p(6), p(7), p(8), p(9)];

  type Key = 'a' | 'b' | 'd' | 'c';
  const lobby: Record<Key, string> = { a: '', b: '', d: '', c: '' };
  const game: Record<Key, string> = { a: '', b: '', d: '', c: '' };
  let group = '';
  let ids: ReadonlyMap<string, string> = new Map();

  const assignments = (side: readonly string[]) =>
    side.map((puuid, i) => ({ puuid, role: LANES[i] ?? 'top' }));

  async function seed(
    key: Key,
    at: string,
    lcuGameId: number,
    options: {
      blue: readonly string[];
      red: readonly string[];
      winner: 100 | 200;
      /** The chosen split's rank (with a rank 1 above it when 2), or `null` for no roll. */
      rank: 1 | 2 | null;
      kickoff: Partial<Database['public']['Tables']['lobbies']['Insert']>;
      rolesOnRows: boolean;
    },
  ): Promise<void> {
    const made = await db
      .from('lobbies')
      .insert({
        group_id: group,
        lcu_party_id: `po-${runId}-${key}`,
        status: 'finished',
        created_at: at,
        kickoff_at: at,
        ...options.kickoff,
      })
      .select('id')
      .single();
    if (made.error) throw new Error(`lobby ${key}: ${made.error.message}`);
    lobby[key] = made.data.id;

    if (options.rank !== null) {
      const split = (rank: number, chosen: boolean, blue: readonly string[], red: readonly string[]) => ({
        lobby_id: made.data.id,
        rank,
        is_chosen: chosen,
        blue: assignments(blue),
        red: assignments(red),
        blue_win_prob: 0.62,
        gap: 30,
        off_role_count: 0,
        explanation: 'Blue favored 62%.',
        roster_key: `po-${runId}`,
        score: 30,
        odds_model: 'kustom',
        created_at: at,
      });
      const rows =
        options.rank === 1
          ? [split(1, true, S_BLUE, S_RED)]
          : [split(1, false, B_BLUE, B_RED), split(2, true, S_BLUE, S_RED)];
      const splits = await db.from('splits').insert(rows);
      if (splits.error) throw new Error(`splits ${key}: ${splits.error.message}`);
    }

    const played = await db
      .from('games')
      .insert({
        group_id: group,
        lobby_id: made.data.id,
        lcu_game_id: lcuGameId,
        started_at: at,
        duration_s: 1_800,
        winning_side: options.winner,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    if (played.error) throw new Error(`game ${key}: ${played.error.message}`);
    game[key] = played.data.id;

    const seat = (puuid: string, side: 100 | 200, index: number) => ({
      game_id: played.data.id,
      group_id: group,
      player_id: ids.get(puuid) as string,
      side,
      role: options.rolesOnRows ? (LANES[index] ?? null) : null,
      r_before: 1200,
      r_after: side === options.winner ? 1210 : 1190,
      k: 16,
      fold_p: 0.5,
      award: 'none',
      rated_games_before: 20,
      kills: 3,
      deaths: 3,
      assists: 3,
      gold: 10_000,
      cs: 150,
      damage_to_champs: 15_000,
    });
    const rows = [
      ...options.blue.map((puuid, i) => seat(puuid, 100, i)),
      ...options.red.map((puuid, i) => seat(puuid, 200, i)),
    ];
    const seats = await db.from('game_players').insert(rows);
    if (seats.error) throw new Error(`seats ${key}: ${seats.error.message}`);
  }

  beforeAll(async () => {
    ({ home: group } = await createTestGroups(db, runId, ['home'] as const));
    ids = await ensurePlayers(
      db,
      puuids.map((puuid, i) => ({ puuid, gameName: `PO${i}` })),
    );
    const start = tonightStart().getTime();
    const span = Date.now() - start;
    const at = (n: number) => new Date(start + (span * n) / 5).toISOString();
    const base = Number(`8${Date.now() % 10_000_000}0`);

    await seed('a', at(1), base + 1, {
      blue: S_BLUE,
      red: S_RED,
      winner: 200,
      rank: 1,
      kickoff: { kickoff_kind: 'rolled', kickoff_blue: S_BLUE, kickoff_red: S_RED, kickoff_swapped: false },
      rolesOnRows: true,
    });
    await seed('b', at(2), base + 2, {
      blue: B_BLUE,
      red: B_RED,
      winner: 100,
      rank: 1,
      kickoff: {
        kickoff_kind: 'custom',
        kickoff_blue: B_BLUE,
        kickoff_red: B_RED,
        kickoff_blue_win_prob: 0.35,
        kickoff_odds_model: 'kustom',
      },
      rolesOnRows: false,
    });
    await seed('d', at(3), base + 3, {
      blue: S_RED,
      red: S_BLUE,
      winner: 100,
      rank: 2,
      kickoff: { kickoff_kind: 'rolled', kickoff_blue: S_RED, kickoff_red: S_BLUE, kickoff_swapped: true },
      rolesOnRows: false,
    });
    await seed('c', at(4), base + 4, {
      blue: S_BLUE,
      red: S_RED,
      winner: 100,
      rank: null,
      kickoff: {
        kickoff_kind: 'unrolled',
        kickoff_blue: S_BLUE,
        kickoff_red: S_RED,
        kickoff_blue_win_prob: 0.3,
        kickoff_odds_model: 'kustom',
      },
      rolesOnRows: true,
    });
  });

  afterAll(async () => {
    await deleteTestGroups(db, [group]);
    const { error } = await db.from('players').delete().in('puuid', puuids);
    if (error) throw new Error(`cleanup: deleting the test players failed: ${error.message}`);
  });

  const close = (value: number | null | undefined, expected: number | null) => {
    if (expected === null) expect(value ?? null).toBeNull();
    else expect(value ?? Number.NaN).toBeCloseTo(expected, 10);
  };

  /** Blue's odds each game must print on a full receipt, and its `Upset`. */
  const FULL: Record<Key, { blue: number; upset: boolean }> = {
    a: { blue: 0.62, upset: true },
    b: { blue: 0.35, upset: true },
    d: { blue: 0.38, upset: true },
    c: { blue: 0.3, upset: true },
  };
  /** What the compact surfaces print (the tape, the poster, /fun): the full receipt's number (M21.14). */
  const COMPACT: Record<Key, number | null> = { a: 0.62, b: 0.35, d: 0.38, c: 0.3 };

  it('the Discord result post: the played odds, and split roles only for a split team', async () => {
    // M21.14: the full receipt's number for every game, the unrolled one's kickoff odds included.
    for (const key of ['a', 'b', 'd', 'c'] as const) {
      const source = await loadResultSource(db, game[key]);
      close(source?.blueWinProb, FULL[key].blue);
    }
    // D's two teams are the split's (swapped sides): everyone keeps a split lane. B's teams are
    // not: nobody gets one.
    const d = await loadResultSource(db, game.d);
    expect(d?.players.find((one) => one.puuid === p(5))?.role).toBe('top');
    expect(d?.players.find((one) => one.puuid === p(4))?.role).toBe('support');
    const b = await loadResultSource(db, game.b);
    expect(b?.players.every((one) => one.role === null)).toBe(true);
  });

  it('the game page (and the AI facts, the same receipt): kind, odds and Upset by the played teams', async () => {
    const kinds: Record<Key, string> = { a: 'rolled', b: 'pre-game', d: 'rolled', c: 'pre-game' };
    for (const key of ['a', 'b', 'd', 'c'] as const) {
      const detail = await loadGameDetail(anon, {
        gameId: game[key],
        groupId: group,
        viewerPuuid: null,
        timeZone: TIME_ZONE,
      });
      if (detail === null) throw new Error(`no detail for ${key}`);
      expect(detail.receipt.kind, key).toBe(kinds[key]);
      const winner = key === 'a' ? 200 : 100;
      expect(receiptUpset(detail.receipt, winner), key).toBe(FULL[key].upset);
      if (detail.receipt.kind === 'rolled') close(detail.receipt.chosen.blueWinProb, FULL[key].blue);
      if (detail.receipt.kind === 'pre-game') close(detail.receipt.kickoffBlueWinProb, FULL[key].blue);
    }
  });

  it("Tonight: the poster's result, the tape and the last game", async () => {
    const snapshot = await loadTonight(anon, {
      nightStart: tonightStart(),
      timeZone: TIME_ZONE,
      groupId: group,
    });
    const tape = new Map(snapshot.tape.map((entry) => [entry.lobbyId, entry]));
    // C is the night's last game: the poster's, not on the tape (lib/tonight/load.test.ts has the
    // tape's unrolled game, M21.14).
    for (const key of ['a', 'b', 'd'] as const) close(tape.get(lobby[key])?.blueWinProb, COMPACT[key]);
    expect(tape.get(lobby.d)?.rank).toBe(2);
    expect(tape.get(lobby.b)?.rank).toBeNull();

    for (const key of ['a', 'b', 'd', 'c'] as const) {
      const { data, error } = await anon
        .from('games')
        .select('id, duration_s, winning_side, started_at')
        .eq('id', game[key])
        .single();
      if (error) throw new Error(error.message);
      const outcome = await resultOfGame(anon, data, lobby[key]);
      close(outcome?.result.blueWinProb, COMPACT[key]);
      expect(outcome?.result.oddsKind, key).toBe(key === 'a' || key === 'd' ? 'rolled' : 'pre-game');
      // The unrolled game's card reads the kickoff odds beside the befores.
      if (key === 'c') close(outcome?.result.kickoffBlueWinProb, 0.3);
      if (key === 'b') close(outcome?.result.kickoffBlueWinProb, 0.35);
      if (key === 'd') expect(outcome?.result.pickRank).toBe(2);
    }
  });

  it("a player's recent games on /p", async () => {
    const board = await loadPlayerBoard(anon, p(1), {
      window: 'all-time',
      groupId: group,
      timeZone: TIME_ZONE,
    });
    const recent = new Map((board?.recent ?? []).map((row) => [row.gameId, row]));
    close(recent.get(game.a)?.blueWinProb, 0.62);
    close(recent.get(game.b)?.blueWinProb, 0.35);
    expect(recent.get(game.b)?.pickRank).toBeNull();
    close(recent.get(game.d)?.blueWinProb, 0.38);
    expect(recent.get(game.d)?.pickRank).toBe(2);
    // C: the kickoff odds, printed as the compact receipt's number.
    close(recent.get(game.c)?.blueWinProb, 0.3);
    expect(recent.get(game.c)?.ratingsBefore).toBeNull();
  });

  it("/fun's Won against the odds: B at 35%, never the split's 62%; the unrolled game in at 30% (M21.14)", async () => {
    const fun = await loadFunFacts(anon, { window: 'all-time', groupId: group, timeZone: TIME_ZONE });
    const keyOf = new Map(Object.entries(game).map(([key, id]) => [id, key]));
    const percents: Record<string, number> = {};
    for (const row of fun.odds.rows) {
      for (const win of row.games) percents[keyOf.get(win.game.id) ?? win.game.id] = win.percent;
    }
    // C: blue won at its kickoff 30%, the longest odds of the night, so the record is C's now.
    expect(percents).toEqual({ a: 38, b: 35, d: 38, c: 30 });
    expect(fun.odds.record?.game.id).toBe(game.c);
    expect(fun.odds.record?.percent).toBe(30);
    expect(resultOdds(0.35, 100).upset).toBe(true);
  });

  it('calibration counts the bot teams (D turned round) and never the changed-teams game', async () => {
    const tonight = await loadCalibrationOrNone(anon, group);
    expect(tonight?.n).toBe(2);
    const detail = await loadGameDetail(anon, {
      gameId: game.b,
      groupId: group,
      viewerPuuid: null,
      timeZone: TIME_ZONE,
    });
    expect(detail?.calibration.n).toBe(2);
  });
}
