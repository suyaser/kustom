import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadFearless } from '@/lib/fearless/load';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { loadGroupModeState } from './load';

/**
 * M14.40 (S12): with the public anon key, `group_modes.set_by` and `fearless_state.reset_by` are not
 * readable -- with `players_public` either would name a group's admin -- while the rest of both rows
 * still is, the loaders still work, and the service role still reads both. Reads only.
 *
 * **Needs `0029_admin_ids_private.sql` applied.** Until the lead applies it, the file skips with that
 * sentence; without the stack it skips like every other integration file.
 */

const stack = await resolveLocalStack();
const probe =
  stack === null
    ? null
    : await createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } })
        .from('group_modes')
        .select('set_by')
        .limit(0);
const applied = probe !== null && probe.error?.code === '42501';

if (stack === null || !applied) {
  describe.skip('admin ids with the anon key', () => {
    it(
      stack === null
        ? 'needs the local stack: run `pnpm db:start`'
        : 'needs migration 0029_admin_ids_private.sql applied to the local stack',
      () => {
        expect(true).toBe(true);
      },
    );
  });
} else {
  const anon = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });
  const service = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false },
  });

  describe('admin ids with the anon key (M14.40)', () => {
    it('refuses group_modes.set_by and fearless_state.reset_by, by name and through select=*', async () => {
      expect((await anon.from('group_modes').select('set_by').limit(1)).error?.code).toBe('42501');
      expect((await anon.from('group_modes').select('*').limit(1)).error?.code).toBe('42501');
      expect((await anon.from('fearless_state').select('reset_by').limit(1)).error?.code).toBe('42501');
      expect((await anon.from('fearless_state').select('*').limit(1)).error?.code).toBe('42501');
    });

    it('still reads the rest of both rows, as the Tonight loaders do', async () => {
      const mode = await anon
        .from('group_modes')
        .select('group_id, mode, updated_at')
        .eq('group_id', ORIGINAL_GROUP_ID);
      expect(mode.error).toBeNull();
      expect(mode.data).toHaveLength(1);
      expect((await loadGroupModeState(anon, ORIGINAL_GROUP_ID)).since).not.toBeNull();

      const pool = await anon
        .from('fearless_state')
        .select('id, group_id, reset_at, updated_at')
        .eq('group_id', ORIGINAL_GROUP_ID);
      expect(pool.error).toBeNull();
      expect(pool.data).toHaveLength(1);
      await expect(loadFearless(anon, ORIGINAL_GROUP_ID)).resolves.toBeDefined();
    });

    it('the service role still reads both', async () => {
      expect(
        (await service.from('group_modes').select('set_by').eq('group_id', ORIGINAL_GROUP_ID)).error,
      ).toBeNull();
      expect(
        (await service.from('fearless_state').select('reset_by').eq('group_id', ORIGINAL_GROUP_ID)).error,
      ).toBeNull();
    });
  });
}
