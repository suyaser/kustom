import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { type LocalPsql, localPsql } from '@/lib/testing/localDb';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.28 acceptance 1: with the public anon key, `lobbies.lobby_password` is readable neither
 * through PostgREST nor in a Realtime `lobbies` payload, while the rest of the row still is. Since
 * M19.11 (`0044`) there is no `lobbies` payload at all: the table is in no publication (acceptance
 * 3 of M19.11). The service role still reads it (the Discord post, the server's Tonight read).
 *
 * **Needs `0028_lobby_password_private.sql` applied.** Until the lead applies it, the file skips
 * with that sentence; without the stack it skips like every other integration file.
 */

const stack = await resolveLocalStack();
const probe =
  stack === null
    ? null
    : await createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } })
        .from('lobbies')
        .select('lobby_password')
        .limit(0);
const applied = probe !== null && probe.error?.code === '42501';

if (stack === null || !applied) {
  describe.skip('lobby_password with the anon key', () => {
    it(
      stack === null
        ? 'needs the local stack: run `pnpm db:start`'
        : 'needs migration 0028_lobby_password_private.sql applied to the local stack',
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
  const psql = localPsql();
  const party = `it-${randomUUID().slice(0, 8)}-pw`;

  afterAll(async () => {
    await anon.removeAllChannels();
    await service.from('lobbies').delete().eq('lcu_party_id', party);
  });

  describe('lobby_password with the anon key (M14.28, M19.11)', () => {
    /*
     * Until M19.11 this test subscribed to `lobbies` and checked that the INSERT and UPDATE payloads
     * carried the row but not the password. Since `0044_publication_live_only.sql` the table is in
     * no Realtime publication at all, so there is no payload to carry it: the catalog says so, and
     * Realtime refuses an anon subscription to the table outright. (That every write still sends
     * nothing is `lib/live/publication.integration.test.ts`, acceptance 2.)
     */
    it('lobbies is in no Realtime publication, and Realtime refuses an anon subscription to it', async () => {
      expect(psql).not.toBeNull();
      const publications = (psql as LocalPsql)(
        "select pubname from pg_publication_tables where schemaname = 'public' and tablename = 'lobbies'",
      );
      expect(publications).toBe('');

      const inserted = await service
        .from('lobbies')
        .insert({
          group_id: ORIGINAL_GROUP_ID,
          lcu_party_id: party,
          lobby_name: 'it password',
          lobby_password: '4821',
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();

      const answer = await new Promise<{ status?: string; message?: string }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no answer to the lobbies subscription in 30s')),
          30_000,
        );
        const channel = anon.channel(`it-${party}`);
        channel.on('system', {}, (message: { extension?: string; status?: string; message?: string }) => {
          if (message.extension !== 'postgres_changes') return;
          clearTimeout(timer);
          resolve(message);
        });
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lobbies', filter: `lcu_party_id=eq.${party}` },
          () => reject(new Error('a lobbies change reached an anon subscriber')),
        );
        channel.subscribe();
      });
      expect(answer.status).toBe('error');
      expect(answer.message).toContain('table: lobbies');
    }, 60_000);

    it('reads the public columns, refuses the password and *, and the service role still reads it', async () => {
      const columns = await anon.from('lobbies').select('id, status, lobby_name').eq('lcu_party_id', party);
      expect(columns.error).toBeNull();
      expect(columns.data).toEqual([expect.objectContaining({ lobby_name: 'it password' })]);

      const password = await anon.from('lobbies').select('id, lobby_password').eq('lcu_party_id', party);
      expect(password.error?.code).toBe('42501');
      const star = await anon.from('lobbies').select('*').eq('lcu_party_id', party);
      expect(star.error?.code).toBe('42501');

      const server = await service
        .from('lobbies')
        .select('lobby_password')
        .eq('lcu_party_id', party)
        .single();
      expect(server.data?.lobby_password).toBe('4821');
    });
  });
}
