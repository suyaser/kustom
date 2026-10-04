import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The player page's title read (performance plan, phase 1) keeps the page's 404 rule: a player is
 * named in a group's `<title>` only when they are a member, have a rating row or have played there.
 * Two scratch groups; a member of one is nobody in the other. Skipped without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('player title read against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  const { loadPlayerHead } = await import('./heads');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const runId = randomUUID().slice(0, 8);
  const puuid = `it-${runId}-heads`;
  let groups: Record<'home' | 'away', string> = { home: '', away: '' };

  beforeAll(async () => {
    groups = await createTestGroups(db, runId, ['home', 'away'] as const);
    const { data, error } = await db
      .from('players')
      .insert({ puuid, display_name: 'Lena', game_name: 'Lena', tag_line: 'EUW' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    await setTestMembership(db, groups.home, data.id, 'member');
  });

  afterAll(async () => {
    await deleteTestGroups(db, [groups.home, groups.away]);
    await db.from('players').delete().eq('puuid', puuid);
  });

  describe('loadPlayerHead', () => {
    it('names a member of the group, and nobody in a group they have nothing in', async () => {
      expect(await loadPlayerHead(puuid, groups.home)).toEqual({ puuid, name: 'Lena' });
      expect(await loadPlayerHead(puuid, groups.away)).toBeNull();
      expect(await loadPlayerHead(`it-${runId}-nobody`, groups.home)).toBeNull();
    });
  });
}
