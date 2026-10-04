import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.69 against the local stack, through the anon key the pages use: a scratch group with two
 * `Ali`s on the same tag (numbered by first game), two `Sara`s on different tags (tagged) and one
 * `Omar` (untouched). Every board row and every Games filter option prints a unique name.
 *
 * Everything lives in this run's own scratch group and players and is deleted afterwards. Skipped,
 * not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('same-name players against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadBoard } = await import('@/lib/board/load');
  const { loadGamesList } = await import('@/lib/games/list');
  const { renderWebName } = await import('@/lib/tonight/copy');
  const { loadGroupMembers } = await import('@/lib/admin/groupMembers');
  const { loadRosterLabels } = await import('@/lib/names/roster');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const PEOPLE = [
    { key: 'ali-late', name: 'Ali', tag: 'EUW' },
    { key: 'ali-early', name: 'Ali', tag: 'EUW' },
    { key: 'sara-euw', name: 'Sara', tag: 'EUW' },
    { key: 'sara-tr', name: 'Sara', tag: 'TR1' },
    { key: 'omar', name: 'Omar', tag: 'EUW' },
  ] as const;
  const NOW = new Date('2026-06-10T18:00:00Z');
  let group = '';
  const ids = new Map<string, string>();

  beforeAll(async () => {
    group = (await createTestGroups(db, runId, ['names'] as const)).names;
    const { data, error } = await db
      .from('players')
      .insert(
        PEOPLE.map((p) => ({
          puuid: `it-${runId}-${p.key}`,
          display_name: p.name,
          game_name: p.name,
          tag_line: p.tag,
        })),
      )
      .select('id, puuid');
    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.set(row.puuid.replace(`it-${runId}-`, ''), row.id);

    const ratings = await db.from('ratings').insert(
      [...ids.values()].map((player_id) => ({
        player_id,
        group_id: group,
        mu: 25,
        sigma: 6,
        games: 2,
        wins: 1,
      })),
    );
    if (ratings.error) throw new Error(ratings.error.message);

    // `ali-early` plays the first game; everyone plays the last.
    let lcu = 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const games = [
      { at: '2026-05-20T18:00:00Z', who: ['ali-early', 'omar'] },
      // Last week: the later Ali plays without the first one (a lone `Ali (2)` on that board).
      { at: '2026-06-03T18:00:00Z', who: ['ali-late', 'sara-euw'] },
      { at: '2026-06-08T18:00:00Z', who: PEOPLE.map((p) => p.key) },
    ];
    for (const g of games) {
      lcu += 1;
      const inserted = await db
        .from('games')
        .insert({
          group_id: group,
          lcu_game_id: lcu,
          started_at: g.at,
          duration_s: 1_500,
          winning_side: 100,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      const rows = await db.from('game_players').insert(
        g.who.map((key, seat) => ({
          game_id: inserted.data.id,
          group_id: group,
          player_id: ids.get(key) as string,
          side: seat % 2 === 0 ? 100 : 200,
          role: 'mid' as const,
          champion_id: 103,
          mu_before: 25,
          sigma_before: 6,
          mu_after: 25.3,
          sigma_after: 5.9,
        })),
      );
      if (rows.error) throw new Error(rows.error.message);
    }
  });

  afterAll(async () => {
    await deleteTestGroups(db, [group]);
    await db.from('players').delete().like('puuid', `it-${runId}-%`);
  });

  const expected = {
    'ali-early': 'Ali',
    'ali-late': 'Ali (2)',
    'sara-euw': 'Sara #EUW',
    'sara-tr': 'Sara #TR1',
    omar: 'Omar',
  };

  const shown = (row: { name: string | null; nameSuffix?: string | null | undefined }) =>
    row.nameSuffix == null ? renderWebName(row.name) : `${renderWebName(row.name)} ${row.nameSuffix}`;

  it('a lone Ali (2) in a window still reads Ali (2): labels are roster-wide', async () => {
    const board = await loadBoard(anon, {
      window: 'last-week',
      groupId: group,
      now: NOW,
      timeZone: 'Africa/Cairo',
    });
    const late = board.rows.find((row) => row.puuid === `it-${runId}-ali-late`);
    expect(board.rows.some((row) => row.puuid === `it-${runId}-ali-early`)).toBe(false);
    expect(late).toMatchObject({ name: 'Ali', nameSuffix: '(2)' });
  });

  it('the admin Members list carries the same label (service role)', async () => {
    await setTestMembership(db, group, ids.get('ali-late') as string, 'member');
    const members = await loadGroupMembers(db, group);
    expect(members.find((row) => row.puuid === `it-${runId}-ali-late`)).toMatchObject({
      name: 'Ali',
      nameSuffix: '(2)',
    });
  });

  it('every board row prints a unique name: tag first, then first game', async () => {
    const board = await loadBoard(anon, { window: 'all-time', groupId: group, now: NOW });
    const printed = new Map(board.rows.map((row) => [row.puuid.replace(`it-${runId}-`, ''), shown(row)]));
    expect(Object.fromEntries(printed)).toEqual(expected);
    expect(new Set(printed.values()).size).toBe(PEOPLE.length);
  });

  it('every Games player filter option is unique, and the focus name matches its option', async () => {
    const view = await loadGamesList(anon, {
      groupId: group,
      filters: { window: 'all-time', mode: 'sr', player: `it-${runId}-ali-late`, page: 1 },
      viewerPuuid: null,
      timeZone: 'Africa/Cairo',
      now: NOW,
    });
    const options = new Map(view.members.map((m) => [m.puuid.replace(`it-${runId}-`, ''), m.name]));
    expect(Object.fromEntries(options)).toEqual(expected);
    expect(new Set(options.values()).size).toBe(PEOPLE.length);
    expect(view.focusName).toBe('Ali (2)');
  });

  it('a busy clashing pair (over 1000 scoreboard rows) is ordered by the true first game', async () => {
    // Its own scratch group: Zed A plays 1100 games, inserted newest first, and its very first game is
    // the group's earliest; Zed B (same tag) first plays fifty games in. A scan capped at 1000 rows
    // would miss Zed A's first game and hand it the `(2)`.
    const busy = (await createTestGroups(db, runId, ['busy'] as const)).busy;
    try {
      const { data: zeds, error } = await db
        .from('players')
        .insert([
          { puuid: `it-${runId}-zed-a`, display_name: 'Zed', tag_line: 'EUW' },
          { puuid: `it-${runId}-zed-b`, display_name: 'Zed', tag_line: 'EUW' },
        ])
        .select('id, puuid');
      if (error) throw new Error(error.message);
      const zedA = zeds?.find((z) => z.puuid.endsWith('zed-a'))?.id as string;
      const zedB = zeds?.find((z) => z.puuid.endsWith('zed-b'))?.id as string;
      await setTestMembership(db, busy, zedA, 'member');
      await setTestMembership(db, busy, zedB, 'member');

      const base = 6_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
      const start = Date.parse('2026-01-01T18:00:00Z');
      const COUNT = 1_100;
      // Newest first, so the earliest game is the last row written.
      const games = Array.from({ length: COUNT }, (_, i) => ({
        group_id: busy,
        lcu_game_id: base + i,
        started_at: new Date(start + (COUNT - i) * 3_600_000).toISOString(),
        duration_s: 1_500,
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
      }));
      const inserted = await db.from('games').insert(games).select('id, started_at');
      if (inserted.error) throw new Error(inserted.error.message);
      const rows = (inserted.data ?? []).map((game) => ({
        game_id: game.id,
        group_id: busy,
        player_id: zedA,
        side: 100,
        role: 'mid' as const,
        champion_id: 103,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = await db.from('game_players').insert(rows.slice(i, i + 500));
        if (chunk.error) throw new Error(chunk.error.message);
      }
      // Zed B's first game: later than Zed A's first, earlier than Zed A's 100th, so a capped scan
      // (the newest 1000 rows) would think Zed B played first.
      const middle = (inserted.data ?? [])[COUNT - 50];
      const zedBRow = await db.from('game_players').insert({
        game_id: middle?.id as string,
        group_id: busy,
        player_id: zedB,
        side: 200,
        role: 'mid',
        champion_id: 103,
      });
      if (zedBRow.error) throw new Error(zedBRow.error.message);

      const labels = await loadRosterLabels(anon, busy);
      expect(labels.has(`it-${runId}-zed-a`)).toBe(false);
      expect(labels.get(`it-${runId}-zed-b`)).toEqual({ base: 'Zed', suffix: '(2)' });
    } finally {
      await deleteTestGroups(db, [busy]);
    }
  });
}
