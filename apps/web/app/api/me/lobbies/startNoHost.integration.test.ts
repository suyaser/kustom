import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUserLike } from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { NO_COMPANION_AROUND, readHostPresence } from '@/lib/lobbyStart';
import { authorizeMe, type MeAuthResult, supabaseMeLookup } from '@/lib/me/identity';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `Start a lobby` with no host up (M14.66), on a group of its own: the 409 names who to ask
 * (`Ask Yasser or Omar to open it.`), or says `whoever hosts` with none or more than three, and
 * the same read gives Tonight its `hostNames` / `hostSeenRecently`.
 *
 * The clock is 2019, like `start.integration.test.ts`, so the press's reads see only this file's
 * rows. Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('start a lobby with no host, against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';

  const { startLobbyRoute } = await import('./start/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const NOW = new Date('2019-06-09T20:00:00.000Z');
  const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const ON = { create_lobby: true, invite: true, switch_side: false } as const;

  const runId = randomUUID().slice(0, 8);
  const presserDiscordId = `8${runId.replace(/\D/g, '') || '1'}00001`;
  // Oldest player first is the order the names print in, so they are created in this order.
  const HOSTS = ['Yasser', 'Omar', 'Ali', 'Hana'] as const;
  const puuidOf = (name: string): string => `nh-${runId}-${name.toLowerCase()}`;
  const puuids = ['presser', ...HOSTS].map(puuidOf);

  let groupId = '';
  const playerIds = new Map<string, string>();
  const tokenIds: string[] = [];

  function press() {
    return startLobbyRoute({
      getClient: () => db,
      authorize: async (_request: Request, client: typeof db): Promise<MeAuthResult> =>
        authorizeMe({
          resolveSessionUser: async (): Promise<SessionUserLike> => ({
            id: randomUUID(),
            email: `${presserDiscordId}@example.invalid`,
            identities: [
              { id: presserDiscordId, provider: 'discord', identity_data: { full_name: 'tester' } },
            ],
          }),
          lookupPlayerByDiscordId: supabaseMeLookup(client),
        }),
      start: { now: NOW, password: () => '4821', gate: ON },
    })(
      new Request('http://localhost/api/me/lobbies/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId }),
      }),
    );
  }

  /** Give `names` an unrevoked token in the group, last seen 30 minutes before NOW (not up). */
  async function hosts(names: readonly string[]): Promise<void> {
    const revoked = await db
      .from('companion_tokens')
      .update({ revoked_at: NOW.toISOString() })
      .in('id', tokenIds);
    if (revoked.error) throw new Error(revoked.error.message);
    for (const name of names) {
      const { tokenHash } = mintCompanionToken();
      const { data, error } = await db
        .from('companion_tokens')
        .insert({
          group_id: groupId,
          player_id: playerIds.get(name) ?? '',
          token_hash: tokenHash,
          label: `nh ${runId} ${name}`,
          last_seen_at: minutesBefore(30),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      tokenIds.push(data.id);
    }
  }

  async function refusal(): Promise<{ status: number; body: unknown }> {
    const response = await press();
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    groupId = (await createTestGroups(db, runId, ['nohost'] as const)).nohost;
    for (const name of ['presser', ...HOSTS]) {
      const ids = await ensurePlayers(db, [{ puuid: puuidOf(name) }]);
      const playerId = ids.get(puuidOf(name)) ?? '';
      playerIds.set(name, playerId);
      const update = name === 'presser' ? { discord_id: presserDiscordId } : { display_name: name };
      const { error } = await db.from('players').update(update).eq('id', playerId);
      if (error) throw new Error(error.message);
    }
    await setTestMembership(db, groupId, playerIds.get('presser') ?? '', 'member');
  });

  afterAll(async () => {
    await deleteTestGroups(db, [groupId]);
    await db.from('players').delete().in('puuid', puuids);
  });

  it('names the hosts: two read `Yasser or Omar`', async () => {
    await hosts(['Yasser', 'Omar']);
    expect(await refusal()).toEqual({
      status: 409,
      body: { ok: false, error: "Nobody's Kustom is running right now. Ask Yasser or Omar to open it." },
    });
  });

  it('names one host and three hosts', async () => {
    await hosts(['Omar']);
    expect((await refusal()).body).toEqual({
      ok: false,
      error: "Nobody's Kustom is running right now. Ask Omar to open it.",
    });
    await hosts(['Yasser', 'Omar', 'Ali']);
    expect((await refusal()).body).toEqual({
      ok: false,
      error: "Nobody's Kustom is running right now. Ask Yasser, Omar or Ali to open it.",
    });
  });

  it('says `whoever hosts` with more than three hosts, and with none', async () => {
    await hosts(['Yasser', 'Omar', 'Ali', 'Hana']);
    expect(await refusal()).toEqual({ status: 409, body: { ok: false, error: NO_COMPANION_AROUND } });
    expect(NO_COMPANION_AROUND).toBe("Nobody's Kustom is running right now. Ask whoever hosts to open it.");

    await hosts([]);
    expect(await refusal()).toEqual({ status: 409, body: { ok: false, error: NO_COMPANION_AROUND } });
  });

  it('gives Tonight the names and whether a host was seen in the last ten minutes', async () => {
    await hosts(['Yasser', 'Omar']);
    expect(await readHostPresence(db, { groupId, now: NOW })).toEqual({
      hostNames: ['Yasser', 'Omar'],
      hostSeenRecently: false,
    });

    const seen = await db
      .from('companion_tokens')
      .update({ last_seen_at: minutesBefore(9) })
      .eq('id', tokenIds[tokenIds.length - 1] ?? '');
    if (seen.error) throw new Error(seen.error.message);
    expect(await readHostPresence(db, { groupId, now: NOW })).toEqual({
      hostNames: ['Yasser', 'Omar'],
      hostSeenRecently: true,
    });
  });
}
