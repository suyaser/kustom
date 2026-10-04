import { randomUUID } from 'node:crypto';
import { config } from '@customs/core';
import { type Database, storedScoreParts } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePlayers } from '@/lib/ingest/players';
import { testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * M18.13 against the local stack: the roll path reads **the night's previous game in the lobby's
 * group** for teammate variety, hands its pairs to core, and stores every split's `score_parts`
 * (0045) beside `score`.
 *
 * - Only the newest game since 06:00 local, not after `now`, of this group: not last night's, not
 *   an earlier one tonight, not another group's, not one stamped after the roll.
 * - Each stored row parses through `storedScoreParts` and adds up to `score`.
 * - The chosen split splits up the previous game's teammates where it can: ten flexible players
 *   at 1200 make every gap 0, so variety is the only term left.
 *
 * Its own scratch groups, so no other file's games are "the previous game". Skipped, not failed,
 * without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('teammate variety against the local Supabase stack', () => {
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
  const { loadRecentTeammates } = await import('./balance');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  /** 23:00 in Cairo (UTC+3 in September); the night started at 06:00 local, 03:00Z. */
  const NOW = new Date('2026-09-20T20:00:00.000Z');
  const runId = randomUUID().slice(0, 8);
  /** p0..p9 play tonight's lobby; q0..q3 only played the previous game. */
  const puuids = testPuuids(runId, 14);
  const p = (i: number) => puuids[i] as string;
  const q = (i: number) => puuids[10 + i] as string;
  const lobbyTen = puuids.slice(0, 10);
  const partyId = `variety-${runId}`;
  const base = testGameId();

  let groups: Record<'home' | 'other', string> = { home: '', other: '' };
  let ids: ReadonlyMap<string, string> = new Map();

  async function insertGame(
    groupId: string,
    offset: number,
    startedAt: string,
    blue: string[],
    red: string[],
  ): Promise<void> {
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: base + offset,
        started_at: startedAt,
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(`game insert: ${error.message}`);
    const rows = [
      ...blue.map((puuid) => [puuid, 100] as const),
      ...red.map((puuid) => [puuid, 200] as const),
    ].map(([puuid, side]) => ({
      game_id: data.id,
      group_id: groupId,
      player_id: ids.get(puuid) as string,
      side,
    }));
    const players = await db.from('game_players').insert(rows);
    if (players.error) throw new Error(`game_players insert: ${players.error.message}`);
  }

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, ['home', 'other'] as const);
    ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    // Flexible: nobody is ever off-role, so the off-role term is 0 on every split.
    await db
      .from('players')
      .update({ main_role: null, secondary_role: null })
      .in('id', [...ids.values()]);

    // Last night (before 06:00 Cairo today): p0..p4 together. Not tonight, so not read.
    await insertGame(
      groups.home,
      0,
      '2026-09-20T02:00:00.000Z',
      [p(0), p(1), p(2), p(3), p(4)],
      lobbyTen.slice(5),
    );
    // Earlier tonight: p5..p9 together. Not the previous game, so not read.
    await insertGame(groups.home, 1, '2026-09-20T17:00:00.000Z', lobbyTen.slice(5), [
      p(0),
      p(1),
      p(2),
      p(3),
      p(4),
    ]);
    // The previous game: two trios of tonight's ten, with four who are not in the lobby.
    await insertGame(
      groups.home,
      2,
      '2026-09-20T18:30:00.000Z',
      [p(0), p(1), p(2), q(0), q(1)],
      [p(3), p(4), p(5), q(2), q(3)],
    );
    // Another group's game, later: never this group's previous game.
    await insertGame(groups.other, 3, '2026-09-20T19:00:00.000Z', lobbyTen.slice(0, 5), lobbyTen.slice(5));
    // Stamped after the roll: not "previous".
    await insertGame(groups.home, 4, '2026-09-20T21:00:00.000Z', lobbyTen.slice(0, 5), lobbyTen.slice(5));
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', puuids);
  });

  it("reads only the night's previous game of this group", async () => {
    const pairs = await loadRecentTeammates(db, groups.home, NOW, TIME_ZONE);
    expect(config.balance.varietyWindowGames).toBe(1);
    const sorted = (xs: string[]) => [...xs].sort();
    const expected = [
      ...[
        [p(0), p(1)],
        [p(0), p(2)],
        [p(1), p(2)],
        [p(0), q(0)],
        [p(0), q(1)],
        [p(1), q(0)],
        [p(1), q(1)],
        [p(2), q(0)],
        [p(2), q(1)],
        [q(0), q(1)],
      ],
      ...[
        [p(3), p(4)],
        [p(3), p(5)],
        [p(4), p(5)],
        [p(3), q(2)],
        [p(3), q(3)],
        [p(4), q(2)],
        [p(4), q(3)],
        [p(5), q(2)],
        [p(5), q(3)],
        [q(2), q(3)],
      ],
    ].map((pair) => sorted(pair).join(' '));
    expect(pairs.map((pair) => [...pair].join(' ')).sort()).toEqual(expected.sort());
  });

  it('has nothing at the first roll of a night', async () => {
    // 07:00 Cairo: the night began an hour ago and nothing has been played in it yet.
    expect(
      await loadRecentTeammates(db, groups.home, new Date('2026-09-20T04:00:00.000Z'), TIME_ZONE),
    ).toEqual([]);
  });

  it('stores score_parts on every split and splits the previous trios up', async () => {
    const owner = ids.get(p(0)) as string;
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'variety',
      members: lobbyTen.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 7000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    });
    const opened = await ingestLobby(db, payload, owner, { groupId: groups.home, now: NOW });
    expect(opened.status).toBe('open');

    const rolled = await rollForTest(db, opened.lobbyId, { now: NOW, timeZone: TIME_ZONE });
    if (rolled.outcome !== 'rolled') throw new Error('the lobby did not balance');

    const { data, error } = await db
      .from('splits')
      .select('rank, score, gap, off_role_count, score_parts')
      .eq('lobby_id', opened.lobbyId)
      .order('rank');
    if (error) throw new Error(error.message);
    expect(data).toHaveLength(config.balance.splitsReturned);
    for (const row of data ?? []) {
      const parts = storedScoreParts(row.score_parts);
      if (parts === null) throw new Error(`rank ${row.rank} stored no parts`);
      expect(parts.gap + parts.offRole + parts.repeat + parts.variety).toBe(row.score);
      expect(parts.offRole).toBe(0);
      // M18.14: charged beyond the lobby's floor of 2 (see below).
      expect(parts.variety).toBe(
        Math.min(config.balance.varietyCap, config.balance.varietyPerPair * (parts.repeatedPairs - 2)),
      );
    }
    // Two trios of the previous game: each must leave at least one pair together, so every split
    // keeps at least 2 (the floor), and the best split keeps exactly that: 2 pairs, charged
    // nothing (M18.14), with a gap of 0.
    const chosen = storedScoreParts(data?.[0]?.score_parts);
    expect(chosen).toMatchObject({ gap: 0, repeatedPairs: 2, variety: 0 });
    expect(rolled.balance.split.scoreParts).toEqual(chosen);

    // 0045's check refuses a shape the receipt could not read; null stays legal (older rows).
    const bad = await db
      .from('splits')
      .update({ score_parts: { gap: 'x' } })
      .eq('lobby_id', opened.lobbyId);
    expect(bad.error?.code).toBe('23514');
    const negative = await db
      .from('splits')
      .update({ score_parts: { gap: 0, offRole: 0, repeat: 0, variety: 0, repeatedPairs: -1 } })
      .eq('lobby_id', opened.lobbyId);
    expect(negative.error?.code).toBe('23514');
    const cleared = await db.from('splits').update({ score_parts: null }).eq('lobby_id', opened.lobbyId);
    expect(cleared.error).toBeNull();
  });
}
