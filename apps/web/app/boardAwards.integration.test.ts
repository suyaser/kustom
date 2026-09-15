import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * **The award badge on a board row** (M8.3), against the Supabase CLI local stack.
 *
 * The unit tests either side of this one prove the two halves: `lib/stats/winners.test.ts` that
 * the winners are read out of `awardsView`'s own blocks, and `app/_leaderboard/BoardRow.test.tsx`
 * that a row prints the list it is handed. What only a database can show is the wiring — that
 * `/leaderboard`'s loader, reading through RLS with the anon key, badges the rows **the award
 * lines on `/stats` name**, and that the three windows which hand nothing out are untouched.
 *
 * The fixture is the smallest week that hands an award out: ten friends, six games, one side
 * losing every one of them. Who exactly wins `Most improved` is the weekly fold's business and
 * is not predicted here — the assertion is that the board and `/stats` name the same people,
 * which is the property M8.3 exists to keep.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the board award badges against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadBoard, loadTopPlayers } = await import('@/lib/board/load');
  const { loadStats } = await import('@/lib/stats/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { BoardView } = await import('./_board/BoardView');
  const { CURSED_DUO } = await import('@/lib/stats/copy');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const id = (suffix: string): string => `ia-${runId}-${suffix}`;

  /**
   * Wednesday 2026-02-18, 20:00 Cairo. `Last week` is then Sunday the 8th 06:00 to Sunday the
   * 15th (M5.9, anchored on Sunday by M5.34) — a stretch of the calendar no other fixture in
   * this suite writes into, so the awards this window hands out are this file's own.
   */
  const NOW = new Date('2026-02-18T18:00:00Z');
  const ZONE = 'Africa/Cairo';
  const AT = { now: NOW, timeZone: ZONE } as const;
  const LAST_WEEK = { window: 'last-week', ...AT } as const;

  /** The five who lose every game together — the cursed duo, several times over. */
  const LOSERS = Array.from({ length: 5 }, (_, index) => id(`l${index}`));
  const WINNERS = Array.from({ length: 5 }, (_, index) => id(`w${index}`));
  const EVERYONE = [...LOSERS, ...WINNERS];

  /** Six nights inside the closed week: past `Most improved`'s minimum of six games. */
  const NIGHTS = [
    '2026-02-09T19:00:00Z',
    '2026-02-09T21:00:00Z',
    '2026-02-10T19:00:00Z',
    '2026-02-10T21:00:00Z',
    '2026-02-11T19:00:00Z',
    '2026-02-11T21:00:00Z',
  ];

  const ids = new Map<string, string>();
  const gameIds: string[] = [];

  beforeAll(async () => {
    const { data: container } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    const containerId = container?.id ?? '';
    expect(containerId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert(
        EVERYONE.map((puuid) => ({
          puuid,
          display_name: `Seat ${puuid.slice(-2)}`,
          rank_tier: 'GOLD',
          rank_division: 'IV',
        })),
      )
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) ids.set(row.puuid, row.id);

    const stamp = Date.now() % 1_000_000;
    for (const [index, startedAt] of NIGHTS.entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`8${stamp}${String(index).padStart(2, '0')}`),
          season_id: containerId,
          started_at: startedAt,
          duration_s: 2_000,
          winning_side: 200,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      /**
       * Every seat is **rated** — `mu_after` written — because a window's board counts the games
       * the fold counted, and a row with none is on no board to badge. The numbers themselves
       * are flat: the weekly track is folded from the seeds at read time (M7.3, M7.4).
       */
      await db.from('game_players').insert(
        [...LOSERS, ...WINNERS].map((puuid, seat) => ({
          game_id: gameId,
          player_id: ids.get(puuid) as string,
          side: seat < 5 ? 100 : 200,
          mu_before: 25,
          sigma_before: 8.333,
          mu_after: 25,
          sigma_after: 8.333,
        })),
      );
    }
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    const playerIds = [...ids.values()];
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  const mine = <T extends { puuid: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.puuid.startsWith(`ia-${runId}-`));

  /** The awards as `/stats` prints them: the winners of each block, by puuid. */
  async function statsWinners(): Promise<Map<string, string[]>> {
    const stats = await loadStats(anon, LAST_WEEK);
    const won = new Map<string, string[]>();
    if (stats.awards === null || stats.awards.kind !== 'closed') return won;

    for (const block of stats.awards.blocks) {
      if (!block.won) continue;
      for (const line of block.lines) {
        for (const puuid of line.key.split('|')) {
          const titles = won.get(puuid) ?? [];
          if (!titles.includes(block.label)) titles.push(block.label);
          won.set(puuid, titles);
        }
      }
    }
    return won;
  }

  describe('a closed window', () => {
    it('badges the rows the award lines on /stats name, and only those', async () => {
      const [board, expected] = await Promise.all([
        loadBoard(anon, { ...LAST_WEEK, includeAwards: true }),
        statsWinners(),
      ]);

      // The fixture has to hand something out, or this file proves nothing.
      expect(expected.size).toBeGreaterThan(0);

      for (const row of board.rows) {
        expect(row.awards).toEqual(expected.get(row.puuid) ?? []);
      }
      // And the five who lost every game together are the ones carrying the pair award.
      for (const puuid of LOSERS) {
        expect(board.rows.find((row) => row.puuid === puuid)?.awards).toContain(CURSED_DUO);
      }
    });

    /** A winner nobody can see is not a row: the board is the same length it was. */
    it('adds no row and changes nothing else about the board', async () => {
      const [plain, badged] = await Promise.all([
        loadBoard(anon, LAST_WEEK),
        loadBoard(anon, { ...LAST_WEEK, includeAwards: true }),
      ]);

      expect(badged.rows.map((row) => row.puuid)).toEqual(plain.rows.map((row) => row.puuid));
      expect(badged.rows.map(({ awards, ...rest }) => rest)).toEqual(
        plain.rows.map(({ awards, ...rest }) => rest),
      );
      // Not asked for is not read: the rail's own call comes back with no badge on any row.
      expect(plain.rows.every((row) => row.awards.length === 0)).toBe(true);
    });

    it('prints the words on the page itself', async () => {
      const board = await loadBoard(anon, { ...LAST_WEEK, includeAwards: true });
      const html = renderToStaticMarkup(
        createElement(BoardView, { board: { ...board, rows: mine(board.rows) }, viewerPuuid: null }),
      );

      expect(html).toContain('cn-row-awards');
      expect(html).toContain(CURSED_DUO);
      // A label, never a control: no link and no button anywhere in the run.
      for (const run of html.match(/<p class="cn-row-awards">.*?<\/p>/g) ?? []) {
        expect(run).not.toMatch(/<a |<button|tabindex/);
      }
    });
  });

  describe('the windows that hand nothing out', () => {
    /**
     * `This week`, `This month` and `All time` have no awards (M5.4) — so even asked for them,
     * the loader comes back with none and the board is the one it drew before M8.3.
     */
    it('carry no badge even when the page asks for them', async () => {
      for (const window of ['this-week', 'this-month'] as const) {
        const board = await loadBoard(anon, { window, ...AT, includeAwards: true });
        expect(board.rows.every((row) => row.awards.length === 0)).toBe(true);
      }

      const all = await loadBoard(anon, { window: 'all-time', includeAwards: true });
      expect(all.rows.every((row) => row.awards.length === 0)).toBe(true);
    });

    /** The tonight rail is a snapshot of tonight, not a window's story: it never badges. */
    it('include the tonight rail, which does not ask', async () => {
      const rail = await loadTopPlayers(anon, { ...LAST_WEEK, limit: 5 });

      expect(rail.every((row) => row.awards.length === 0)).toBe(true);
    });
  });
}
