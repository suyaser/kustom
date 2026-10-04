import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups } from '@/lib/testing/groups';
import { kustomSeat, rOf } from '@/lib/testing/kustomSeat';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.79's loader against the local stack, through the anon key: the week board's rows with their
 * most-played role, first nights (no game in the group before the week), first picks (no earlier
 * game in the group locked the champion), the nights and the week number. One scratch group,
 * deleted afterwards. Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the week notes loader, against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { createPublicClient } = await import('@/lib/publicClient');
  const { loadWeekNotes, weekFromParam } = await import('./weekNotesLoad');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const TZ = 'Africa/Cairo';
  const NOW = new Date('2026-06-20T12:00:00Z');
  /** The week under test: Sunday 7 June to Saturday 13 June 2026. */
  const WEEK = '2026-06-07';
  let groupId = '';
  const ids: Record<'vet' | 'newbie' | 'third', string> = { vet: '', newbie: '', third: '' };
  const puuid = (key: string) => `it-${runId}-wn-${key}`;

  type Seat = { player: keyof typeof ids; side: 100 | 200; role: 'mid' | 'adc' | 'top'; champion: number };

  async function game(startedAt: string, seats: readonly Seat[], delta: number) {
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000),
        started_at: startedAt,
        duration_s: 1_500,
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const rows = await db.from('game_players').insert(
      seats.map((seat) => ({
        game_id: data.id,
        group_id: groupId,
        player_id: ids[seat.player],
        side: seat.side,
        role: seat.role,
        champion_id: seat.champion,
        mu_before: 25,
        sigma_before: 6,
        mu_after: seat.side === 100 ? 25 + delta : 25 - delta,
        sigma_after: 5.9,
        ...kustomSeat(rOf(25), rOf(seat.side === 100 ? 25 + delta : 25 - delta)),
      })),
    );
    if (rows.error) throw new Error(rows.error.message);
  }

  beforeAll(async () => {
    ({ wn: groupId } = await createTestGroups(db, runId, ['wn'] as const));
    for (const [key, name] of [
      ['vet', 'Lena'],
      ['newbie', 'Nadia'],
      ['third', 'Theo'],
    ] as const) {
      const { data, error } = await db
        .from('players')
        .insert({ puuid: puuid(key), display_name: name })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      ids[key] = data.id;
    }
    // The week before: Lena on Ahri, Theo on Annie. Week 1 of the group.
    await game(
      '2026-06-03T18:00:00Z',
      [
        { player: 'vet', side: 100, role: 'mid', champion: 103 },
        { player: 'third', side: 200, role: 'top', champion: 1 },
      ],
      0.5,
    );
    // Tuesday 9 June: Nadia's first game (Jinx), Lena on Ahri again.
    await game(
      '2026-06-09T18:00:00Z',
      [
        { player: 'vet', side: 100, role: 'mid', champion: 103 },
        { player: 'newbie', side: 200, role: 'adc', champion: 222 },
      ],
      0.5,
    );
    // Thursday 11 June: all three.
    await game(
      '2026-06-11T18:00:00Z',
      [
        { player: 'vet', side: 100, role: 'mid', champion: 103 },
        { player: 'newbie', side: 200, role: 'adc', champion: 222 },
        { player: 'third', side: 100, role: 'top', champion: 1 },
      ],
      0.5,
    );
  });

  afterAll(async () => {
    await deleteTestGroups(db, [groupId]);
    await db
      .from('players')
      .delete()
      .in('puuid', [puuid('vet'), puuid('newbie'), puuid('third')]);
  });

  const group = () => ({ id: groupId, name: `Week notes ${runId}` });

  it('reads the week: week 2, two nights, roles, the first night and the first pick', async () => {
    const week = weekFromParam(WEEK, TZ, NOW);
    expect(week).not.toBeNull();
    const model = await loadWeekNotes(anon, group(), week as NonNullable<typeof week>, TZ);
    expect(model?.week).toBe('WEEK 2');
    expect(model?.counts).toBe('2\u00A0rated games · 2\u00A0nights');
    expect(model?.range).toBe('Sunday 7 Jun to Saturday 13 Jun');
    expect(model?.buffs.medals.map((medal) => [medal.name, medal.role])).toEqual([
      ['Lena', 'mid'],
      ['Theo', 'top'],
    ]);
    expect(model?.news.tiles.slice(0, 2)).toEqual([
      { label: 'FIRST NIGHT', value: 'Nadia', sub: 'joined on Tuesday · settling 2/10' },
      { label: 'FIRST PICKS FOR THE GROUP', value: 'Jinx', sub: 'champions nobody here had played before' },
    ]);
    // Never a PUUID, anywhere in what the card paints.
    expect(JSON.stringify(model)).not.toContain(`it-${runId}`);
  });

  it('is null for a closed week the group did not play', async () => {
    const week = weekFromParam('2026-05-24', TZ, NOW);
    expect(await loadWeekNotes(anon, group(), week as NonNullable<typeof week>, TZ)).toBeNull();
  });
}
