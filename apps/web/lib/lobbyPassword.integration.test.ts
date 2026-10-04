import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M14.28 acceptance 1: with the public anon key, `lobbies.lobby_password` is readable neither
 * through PostgREST nor in a Realtime `lobbies` payload, while the rest of the row still is and the
 * events still fire. The service role still reads it (the Discord post, the server's Tonight read).
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
  const party = `it-${randomUUID().slice(0, 8)}-pw`;
  // A second row whose only job is to prove the Realtime stream is live before the row under test
  // is written (see the test's comment).
  const warm = `${party}-warm`;

  afterAll(async () => {
    await anon.removeAllChannels();
    await service.from('lobbies').delete().in('lcu_party_id', [party, warm]);
  });

  type LobbyPayload = RealtimePostgresChangesPayload<Record<string, unknown>>;
  const partyOf = (event: LobbyPayload) => (event.new as { lcu_party_id?: string } | undefined)?.lcu_party_id;

  /**
   * Event-driven waits. Every payload for one of this file's rows lands in `events` and wakes the
   * one pending `until`; nothing here sleeps on a fixed clock. The timeout is only a backstop for a
   * stream that never delivers, and it says what was seen when it fires.
   */
  const events: LobbyPayload[] = [];
  let wake: () => void = () => {};
  function until(label: string, done: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wake = () => {};
        const seen = events.map((event) => `${event.eventType} ${partyOf(event)}`).join(', ') || 'nothing';
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}; saw ${seen}`));
      }, timeoutMs);
      const check = () => {
        if (!done()) return;
        clearTimeout(timer);
        wake = () => {};
        resolve();
      };
      wake = check;
      check();
    });
  }

  describe('lobby_password with the anon key (M14.28)', () => {
    /*
     * Under full-suite load this used to fail while passing alone (2026-10-04). It waited for the
     * `postgres_changes` "ok" system message, wrote the row, then polled a fixed 10 seconds for
     * two events. Two things break that on a loaded shared stack:
     *
     * - "ok" means the subscription is registered, not that Realtime is already streaming changes
     *   for it, and delivery can take longer than 10 seconds: a write in that gap is lost or late.
     * - The old subscription took every `lobbies` change in the original group, which other files
     *   write in bulk. The Realtime container logs `MessagePerSecondRateLimitReached` during full
     *   runs, and a tenant over that limit stops delivering for a while.
     *
     * So the subscription is filtered to this file's two rows (the payload under test is the
     * same whatever the filter), a warm-up row is nudged until its own event arrives -- proof the
     * stream is live, resubscribing on a fresh channel if a channel stays silent -- and only then
     * is the row under test written and the test waits for its INSERT and UPDATE events
     * themselves, with a generous backstop.
     */
    it('is in no Realtime payload, and the events still fire', async () => {
      const subscribe = async (attempt: number) => {
        const channel = anon.channel(`it-${party}-${attempt}`);
        let subscribed = false;
        channel.on('system', {}, (message: { extension?: string; status?: string }) => {
          if (message.extension === 'postgres_changes' && message.status === 'ok') {
            subscribed = true;
            wake();
          }
        });
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lobbies', filter: `lcu_party_id=in.(${party},${warm})` },
          (payload) => {
            const of = partyOf(payload);
            if (of === party || of === warm) {
              events.push(payload);
              wake();
            }
          },
        );
        const subscribedWait = until('the postgres_changes subscription', () => subscribed, 30_000);
        channel.subscribe();
        await subscribedWait;
        return channel;
      };

      const warmed = await service
        .from('lobbies')
        .insert({
          group_id: ORIGINAL_GROUP_ID,
          lcu_party_id: warm,
          lobby_name: 'it warm-up 0',
          lobby_password: '1111',
        })
        .select('id')
        .single();
      expect(warmed.error).toBeNull();

      const warmSeen = () => events.some((event) => partyOf(event) === warm);
      let nudges = 0;
      const nudger = setInterval(() => {
        nudges += 1;
        // A supabase-js builder only sends when it is awaited or then-ed: `void` alone sends nothing.
        void service
          .from('lobbies')
          .update({ lobby_name: `it warm-up ${nudges}` })
          .eq('lcu_party_id', warm)
          .then(() => undefined);
      }, 1_000);
      try {
        for (let attempt = 1; !warmSeen(); attempt += 1) {
          const channel = await subscribe(attempt);
          const last = attempt === 4;
          const heard = await until('a warm-up event', warmSeen, last ? 30_000 : 15_000).then(
            () => true,
            (error: unknown) => {
              if (last) throw error;
              return false;
            },
          );
          if (!heard) await anon.removeChannel(channel);
        }
      } finally {
        clearInterval(nudger);
      }

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
      const updated = await service.from('lobbies').update({ status: 'balanced' }).eq('lcu_party_id', party);
      expect(updated.error).toBeNull();

      const mine = () => events.filter((event) => partyOf(event) === party);
      await until('the INSERT and UPDATE events', () => mine().length >= 2, 45_000);

      expect(mine().map((event) => event.eventType)).toEqual(['INSERT', 'UPDATE']);
      for (const event of mine()) {
        expect(event.new).toHaveProperty('lobby_name', 'it password');
        expect(event.new).not.toHaveProperty('lobby_password');
      }
      // The warm-up row carries a password too: none of its payloads may show it either.
      for (const event of events) expect(event.new).not.toHaveProperty('lobby_password');
    }, 300_000);

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
