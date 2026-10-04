import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Stats → Records, Champions and 1v1 against the local Supabase stack (M14.17, folding in M13.12),
 * read with the anon key, inside the group:
 *
 * - (M13.12 check 1) nothing from group B's games reaches group A's segments, on any of the three;
 * - (acceptance 5) all time on a 500-game group with real-shaped end-of-game blobs: each segment's
 *   HTML under 1 MB (1.0's `/fun` was 58 MB on real data). Reported in the log.
 *
 * Scratch groups and players of this run only, deleted afterwards. Skipped without the stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('stats segments against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadFunFacts, loadRecordsSegment, loadVersusSegment } = await import('@/lib/stats/load');
  const { RecordsSegment } = await import('./_stats/RecordsSegment');
  const { ChampionsSegment } = await import('./_stats/ChampionsSegment');
  const { VersusSegment } = await import('./_stats/VersusSegment');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();
  const runId = randomUUID().slice(0, 8);
  const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
  const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
  const CHAMPS = [
    'Ahri',
    'Garen',
    'Jinx',
    'Leona',
    'LeeSin',
    'Thresh',
    'Caitlyn',
    'Orianna',
    'Aatrox',
    'KhaZix',
  ];

  let groups: Record<'a' | 'b', string> = { a: '', b: '' };
  const ids: string[] = [];
  const puuids: string[] = [];
  let lcu = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

  const links = {
    player: (puuid: string) => `/g/a/p/${puuid}`,
    game: (id: string) => `/g/a/games/${id}`,
    playerGames: (puuid: string) => `/g/a/games?window=all-time&player=${puuid}`,
    showAll: (id: string) => `/g/a/stats?all=${id}#${id}`,
    showFewer: (id: string) => `/g/a/stats#${id}`,
    expanded: null,
    roasts: false,
  };

  /** An end-of-game block in the verified shape, with the keys the museums and records read. */
  function eogRaw(n: number, blue: number[], red: number[]) {
    const player = (i: number, seat: number) => ({
      puuid: puuids[i],
      championName: CHAMPS[(i + n) % CHAMPS.length],
      detectedTeamPosition: POSITIONS[seat % 5],
      spell1Id: seat % 5 === 1 ? 11 : 4,
      spell2Id: 14,
      stats: {
        firstBloodKill: seat === n % 10,
        firstBloodAssist: seat === (n + 1) % 10,
        doubleKills: (i + n) % 3,
        tripleKills: (i + n) % 7 === 0 ? 1 : 0,
        quadraKills: (i + n) % 29 === 0 ? 1 : 0,
        pentaKills: (i + n) % 97 === 0 ? 1 : 0,
        largestKillingSpree: (i + n) % 8,
        firstTowerKill: seat === (n + 3) % 10,
        objectivesStolen: (i + n) % 41 === 0 ? 1 : 0,
        dragonKills: seat % 5 === 1 ? n % 4 : 0,
        baronKills: seat % 5 === 1 ? n % 2 : 0,
        longestTimeSpentLiving: 200 + ((i * 37 + n) % 900),
        VISION_SCORE: 20,
        TOTAL_DAMAGE_SELF_MITIGATED: 9_000,
        TOTAL_DAMAGE_DEALT_TO_OBJECTIVES: 3_000,
        totalDamageTaken: 20_000,
        padding: 'x'.repeat(1_500),
      },
    });
    return {
      gameMode: 'CLASSIC',
      teams: [
        { teamId: 100, players: blue.map((i, seat) => player(i, seat)) },
        { teamId: 200, players: red.map((i, seat) => player(i, seat + 5)) },
      ],
    };
  }

  async function insertGames(groupId: string, count: number, pool: number[], startMs: number) {
    const rows: Database['public']['Tables']['game_players']['Insert'][] = [];
    for (let from = 0; from < count; from += 100) {
      const batch = Array.from({ length: Math.min(100, count - from) }, (_, k) => {
        const n = from + k;
        const order = pool.map((_, j) => pool[(j + n) % pool.length] as number);
        const blue = order.slice(0, 5);
        const red = order.slice(5, 10);
        lcu += 1;
        return {
          game: {
            group_id: groupId,
            lcu_game_id: lcu,
            started_at: new Date(startMs + n * 3_600_000).toISOString(),
            duration_s: 1_500 + (n % 600),
            winning_side: n % 3 === 0 ? 200 : 100,
            raw: eogRaw(n, blue, red),
          },
          blue,
          red,
          n,
        };
      });
      const { data, error } = await db
        .from('games')
        .insert(batch.map((b) => b.game))
        .select('id, lcu_game_id');
      if (error) throw new Error(error.message);
      for (const b of batch) {
        const id = (data ?? []).find((row) => row.lcu_game_id === b.game.lcu_game_id)?.id as string;
        [...b.blue, ...b.red].forEach((i, seat) => {
          rows.push({
            game_id: id,
            group_id: groupId,
            player_id: ids[i] as string,
            side: seat < 5 ? 100 : 200,
            role: ROLES[seat % 5] ?? 'top',
            champion_id: 1 + ((i + b.n) % 60),
            kills: (i + b.n) % 12,
            deaths: (i * 3 + b.n) % 10,
            assists: (i * 5 + b.n) % 18,
            gold: 8_000 + ((i * 731 + b.n * 97) % 7_000),
            damage_to_champs: 9_000 + ((i * 2_311 + b.n * 503) % 30_000),
            cs: 30 + ((i * 37 + b.n * 11) % 230),
            vision_score: 20,
            damage_self_mitigated: 9_000,
            damage_to_objectives: 3_000,
            mu_before: 25,
            sigma_before: 6,
            mu_after: 25 + (seat < 5 === (b.game.winning_side === 100) ? 0.3 : -0.3),
            sigma_after: 5.9,
          });
        });
      }
    }
    for (let from = 0; from < rows.length; from += 1_000) {
      const { error } = await db.from('game_players').insert(rows.slice(from, from + 1_000));
      if (error) throw new Error(error.message);
    }
  }

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, ['a', 'b'] as const);
    const { data, error } = await db
      .from('players')
      .insert(
        Array.from({ length: 16 }, (_, i) => ({
          puuid: `it-${runId}-ss${i}`,
          display_name: i >= 12 ? `Bonly${i}` : `Agamer${i}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      )
      .select('id, puuid');
    if (error) throw new Error(error.message);
    for (let i = 0; i < 16; i += 1) {
      const row = (data ?? []).find((p) => p.puuid === `it-${runId}-ss${i}`);
      ids.push(row?.id ?? '');
      puuids.push(row?.puuid ?? '');
    }
    const start = Date.parse('2025-01-01T19:00:00Z');
    // A: 500 games of twelve players. B: 200 games where four people only B has play every one.
    await insertGames(groups.a, 500, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], start);
    await insertGames(groups.b, 200, [12, 13, 14, 15, 0, 1, 2, 3, 4, 5], start + 1_800_000);
  }, 180_000);

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    if (ids.length > 0) await db.from('players').delete().in('id', ids.filter(Boolean));
  }, 120_000);

  const options = { window: 'all-time' as const, timeZone: 'Africa/Cairo', groupId: '' };

  async function segments(groupId: string) {
    const opts = { ...options, groupId };
    const records = await loadRecordsSegment(anon, opts);
    const fun = await loadFunFacts(anon, opts);
    const versus = await loadVersusSegment(anon, { ...opts, leftPuuid: puuids[0], rightPuuid: puuids[1] });
    return {
      records: {
        view: records,
        html: renderToStaticMarkup(
          createElement(RecordsSegment, { stats: records.stats, fun: records.fun, links }),
        ),
      },
      champions: { view: fun, html: renderToStaticMarkup(createElement(ChampionsSegment, { fun, links })) },
      versus: {
        view: versus,
        html: renderToStaticMarkup(
          createElement(VersusSegment, { ...versus, links, action: '/g/a/stats/1v1' }),
        ),
      },
    };
  }

  it("counts only the group's own games on every segment (M13.12 check 1)", async () => {
    const a = await segments(groups.a);
    expect(a.records.view.stats.games).toBe(500);
    expect(a.records.view.fun.games).toBe(500);
    expect(a.versus.view.versus.games).toBe(500);
    for (const segment of [a.records, a.champions, a.versus]) expect(segment.html).not.toContain('Bonly');
    const b = await segments(groups.b);
    expect(b.records.view.stats.games).toBe(200);
    expect(b.records.html).toContain('Bonly');
  }, 120_000);

  it('keeps each segment under 1 MB of HTML on a 500-game all-time window (report)', async () => {
    const a = await segments(groups.a);
    for (const [name, segment] of Object.entries(a)) {
      const kb = Buffer.byteLength(segment.html) / 1024;
      console.info(`M14.17: all-time ${name}, 500-game group: ${kb.toFixed(1)} KB of HTML`);
      expect(kb).toBeLessThan(1024);
    }
    // The museums are full: the fixture is not passing on an empty page.
    expect(a.records.view.fun.museum.rows.length).toBeGreaterThan(0);
    expect(a.records.html).toContain('First Blood Museum');
    // Every record links the game it was set in (its date line), never an inline scoreboard.
    expect(a.records.html).toMatch(/href="\/g\/a\/games\/[0-9a-f-]{36}"/);
    expect(a.records.html).not.toContain('Scoreboard');
  }, 120_000);
}
