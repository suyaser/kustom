import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * What the two surfaces read about tonight's `create_lobby` (M4.2's control, M4.7's layout),
 * against the local stack.
 *
 * What a component test cannot prove: the row comes back **at all**. `companion_commands` has
 * no RLS policy, the host's name is an embedded `players` join, and a PostgREST embed spelled
 * wrong is a 400 at runtime and a green typecheck — which is exactly the class of bug the
 * player page's `games(started_at)` order already cost this repo a night over.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('tonight’s create_lobby against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { loadLobbyStart } = await import('./lobbyStart');
  const { startLobbySentence, openingOnPcLine } = await import('@/lib/lobbyStart');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  /** 21:40 Cairo on a night in the past: a fixed instant, so the night boundary cannot move. */
  const NOW = new Date('2026-04-14T18:40:00Z');
  const READ = { now: NOW, timeZone: TIME_ZONE } as const;

  let hostId = '';
  const commandIds: string[] = [];

  /** Inserted at an instant inside the night `NOW` is in, because the read is bounded by it. */
  const CREATED_AT = new Date('2026-04-14T18:39:00Z').toISOString();

  beforeAll(async () => {
    const { data, error } = await db
      .from('players')
      .insert({ puuid: `it-${runId}-host`, display_name: 'Hamoodi' })
      .select('id')
      .single();
    expect(error).toBeNull();
    hostId = data?.id ?? '';
  });

  afterAll(async () => {
    if (commandIds.length > 0) await db.from('companion_commands').delete().in('id', commandIds);
    if (hostId !== '') await db.from('players').delete().eq('id', hostId);
  });

  async function queue(kind: 'create_lobby' | 'invite', row: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await db
      .from('companion_commands')
      .insert({
        target_player_id: hostId,
        kind,
        created_at: CREATED_AT,
        payload:
          kind === 'create_lobby'
            ? { lobbyName: 'Customs 14 Apr #1', lobbyPassword: '4821' }
            : { puuid: `it-${runId}-guest`, summonerId: null },
        ...row,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const id = data?.id ?? '';
    commandIds.push(id);
    return id;
  }

  describe('tonight’s create_lobby', () => {
    it('is null on a night nobody pressed the button', async () => {
      expect(await loadLobbyStart(db, READ)).toBeNull();
    });

    it('names the host, carries the payload, and reads as the pending sentence', async () => {
      await queue('create_lobby');

      const start = await loadLobbyStart(db, READ);

      expect(start).toMatchObject({
        status: 'pending',
        error: null,
        hostName: 'Hamoodi',
        lobbyName: 'Customs 14 Apr #1',
        lobbyPassword: '4821',
        // Nothing has been acked, so nothing has been invited and the count is not even asked.
        invited: 0,
      });
      expect(startLobbySentence(start, start?.hostName ?? '')).toBe(openingOnPcLine('Hamoodi'));
    });

    it('counts the fan-out once the create is acked', async () => {
      await db
        .from('companion_commands')
        .update({ status: 'acked' })
        .eq('target_player_id', hostId)
        .eq('kind', 'create_lobby');
      await queue('invite');
      await queue('invite');

      const start = await loadLobbyStart(db, READ);

      expect(start).toMatchObject({ status: 'acked', invited: 2 });
      // Acked says nothing at all: the member list appearing is the answer (product, M4.2).
      expect(startLobbySentence(start, 'Hamoodi')).toBeNull();
    });

    /**
     * The second lobby of a night (the reviewer, 2026-09-10). The fan-out runs off the ack, so
     * a count bounded by the **night** would make this line claim the first lobby's popups —
     * the one number on this card a reader can check against their own client.
     */
    it('counts only its own fan-out when the night has had two lobbies', async () => {
      const later = new Date('2026-04-14T19:10:00Z').toISOString();
      await queue('create_lobby', { created_at: later, status: 'acked' });
      await queue('invite', { created_at: new Date('2026-04-14T19:11:00Z').toISOString() });

      const start = await loadLobbyStart(db, {
        now: new Date('2026-04-14T19:20:00Z'),
        timeZone: TIME_ZONE,
      });

      // The newest create is the one the page is about, and it invited one person — not the
      // three the night has queued in total.
      expect(start).toMatchObject({ status: 'acked', invited: 1 });
    });

    it('is null again on the next night: a stuck row never speaks for tonight', async () => {
      const tomorrow = new Date('2026-04-15T18:40:00Z');

      expect(await loadLobbyStart(db, { now: tomorrow, timeZone: TIME_ZONE })).toBeNull();
    });
  });
}
