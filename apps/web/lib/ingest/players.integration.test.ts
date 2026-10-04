import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveLocalStack } from '../testing/localStack';
import { ensurePlayers } from './players';

// A rename drops every cached slice that prints a name (performance plan, phase 2).
const { invalidateNames } = vi.hoisted(() => ({ invalidateNames: vi.fn() }));
vi.mock('../cache/tags', () => ({ invalidateNames }));

/**
 * `ensurePlayers` against the Supabase CLI local stack: the display-name rule of M1.7.
 *
 * On creation `display_name` is the reported `gameName`. On a later report it follows the
 * `gameName` only while nobody has overridden it — an admin's name survives a Riot ID change,
 * and clearing that name (the admin form posts `""`, which stores null) puts the row back on
 * automatic.
 *
 * Skipped, not failed, without the stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('ensurePlayers against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids: string[] = [];

  function puuid(name: string): string {
    const value = `it-names-${runId}-${name}`;
    puuids.push(value);
    return value;
  }

  async function row(target: string) {
    const { data, error } = await db
      .from('players')
      .select('game_name, tag_line, display_name')
      .eq('puuid', target)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  afterAll(async () => {
    const { error } = await db.from('players').delete().in('puuid', puuids);
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  });

  describe('ensurePlayers and the server cache', () => {
    it('drops the cached names on a rename or a moved tag line, and only then', async () => {
      const target = puuid('cache');
      await ensurePlayers(db, [{ puuid: target, gameName: 'Dana', tagLine: 'EUW' }]);
      invalidateNames.mockClear();

      await ensurePlayers(db, [{ puuid: target, gameName: 'Dana', tagLine: 'EUW' }]);
      expect(invalidateNames).not.toHaveBeenCalled();

      await ensurePlayers(db, [{ puuid: target, gameName: 'Dana2', tagLine: 'EUW' }]);
      expect(invalidateNames).toHaveBeenCalledTimes(1);

      await ensurePlayers(db, [{ puuid: target, gameName: 'Dana2', tagLine: 'TR1' }]);
      expect(invalidateNames).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensurePlayers display names (M1.7)', () => {
    it('fills the display name from the game name when the row is created', async () => {
      const target = puuid('created');

      await ensurePlayers(db, [{ puuid: target, gameName: 'Alice', tagLine: 'EUW' }]);

      expect(await row(target)).toEqual({
        game_name: 'Alice',
        tag_line: 'EUW',
        display_name: 'Alice',
      });
    });

    it('leaves it null for a PUUID first seen without a name, then fills it on the first report that has one', async () => {
      // A PUUID first seen in an eog block: `companionGameParticipantSchema` carries no name.
      const target = puuid('nameless');

      await ensurePlayers(db, [{ puuid: target }]);
      expect(await row(target)).toMatchObject({ game_name: null, display_name: null });

      await ensurePlayers(db, [{ puuid: target, gameName: 'Carol' }]);
      expect(await row(target)).toMatchObject({ game_name: 'Carol', display_name: 'Carol' });
    });

    it('writes nothing at all when the same identity is reported again', async () => {
      const target = puuid('unchanged');
      const input = { puuid: target, gameName: 'Dave', tagLine: 'EUW', summonerId: '42' };

      await ensurePlayers(db, [input]);
      const { data: before } = await db.from('players').select('*').eq('puuid', target).single();

      await ensurePlayers(db, [input]);
      const { data: after } = await db.from('players').select('*').eq('puuid', target).single();

      expect(after).toEqual(before);
    });

    it('follows a Riot ID change while nobody has overridden the name', async () => {
      const target = puuid('renamed');

      await ensurePlayers(db, [{ puuid: target, gameName: 'Eve' }]);
      await ensurePlayers(db, [{ puuid: target, gameName: 'EveTheSecond' }]);

      expect(await row(target)).toMatchObject({
        game_name: 'EveTheSecond',
        display_name: 'EveTheSecond',
      });
    });

    it("keeps an admin's name through a Riot ID change", async () => {
      const target = puuid('overridden');

      await ensurePlayers(db, [{ puuid: target, gameName: 'Frank' }]);
      // What `/admin/players` does: set the display name and nothing else.
      await db.from('players').update({ display_name: 'Frankie' }).eq('puuid', target);

      await ensurePlayers(db, [{ puuid: target, gameName: 'FrankReborn' }]);

      expect(await row(target)).toMatchObject({
        game_name: 'FrankReborn',
        display_name: 'Frankie',
      });
    });

    it('goes back on automatic when the override is cleared to null', async () => {
      const target = puuid('cleared');

      await ensurePlayers(db, [{ puuid: target, gameName: 'Grace' }]);
      await db.from('players').update({ display_name: 'G' }).eq('puuid', target);
      // Clearing the admin field posts "" and stores null.
      await db.from('players').update({ display_name: null }).eq('puuid', target);

      // The very next report refills it, even though the game name did not move.
      await ensurePlayers(db, [{ puuid: target, gameName: 'Grace' }]);

      expect(await row(target)).toMatchObject({ game_name: 'Grace', display_name: 'Grace' });
    });

    it('never blanks a stored name with a report that carries none', async () => {
      const target = puuid('silent-report');

      await ensurePlayers(db, [{ puuid: target, gameName: 'Heidi' }]);
      await ensurePlayers(db, [{ puuid: target }]);

      expect(await row(target)).toMatchObject({ game_name: 'Heidi', display_name: 'Heidi' });
    });
  });
}
