import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M22.12 against the local stack: two lobbies, B forked with Mirror pending, then A ends and B is
 * the only lobby left. Nothing has folded B's `lobby_modes` row onto `group_modes` yet (no mode
 * write since), so the next Roll would lock Mirror: Tonight and the mode panel must show Mirror too
 * (`cardSourceOf`), both when A ends because its host moved into B and when a finished A runs out
 * its 20 minutes with nothing written.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the survivor lobby card against the local Supabase stack', () => {
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
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { setGroupModeRoute } = await import('@/app/api/admin/mode/handler');
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { authorizeAdmin, supabaseAdminLookup } = await import('@/lib/adminAuth');
  const { mintCompanionToken } = await import('@/lib/companionAuth');
  const { supabaseGroupRole } = await import('@/lib/groups/membership');
  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { eogBody, testGameId } = await import('@/lib/testing/fixtures');
  const { createTestGroups, deleteTestGroups, pinTestGroupMode, setTestMembership } = await import(
    '@/lib/testing/groups'
  );
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { loadModePanelView } = await import('@/lib/mode/panelView');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createClient<Database>(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 20 }, (_, index) => `it-${runId}-sv${index}`);
  const anaTen = all.slice(0, 10);
  const boTen = all.slice(10, 20);
  const ANA = anaTen[0] ?? '';
  const BO = boTen[0] ?? '';
  const anaDiscord = `8${runId.replace(/\D/g, '') || '1'}0512`;
  const keys = ['moved', 'timeout'] as const;
  type Key = (typeof keys)[number];
  const groups: Record<Key, string> = { moved: '', timeout: '' };
  const tokens: Record<Key, { ana: string; bo: string }> = {
    moved: { ana: '', bo: '' },
    timeout: { ana: '', bo: '' },
  };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const party = (key: Key, name: string) => `it-${runId}-sv-${key}-${name}`;

  const session = {
    id: randomUUID(),
    email: `${runId}-sv@example.invalid`,
    identities: [{ id: anaDiscord, provider: 'discord', identity_data: {} }],
  };

  const jsonRequest = (path: string, body: unknown, bearer?: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    });

  async function card(groupId: string, body: Record<string, unknown>) {
    const response = await setGroupModeRoute({
      getClient: () => db,
      timeZone: 'Africa/Cairo',
      authorize: async (_request: Request, client: typeof db, id: string | null) =>
        authorizeAdmin({
          resolveSessionUser: async () => session,
          lookupPlayerByDiscordId: supabaseAdminLookup(client),
          lookupGroupRole: supabaseGroupRole(client),
          groupId: id,
        }),
    })(jsonRequest('/api/admin/mode', { groupId, ...body }));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  }

  async function post(partyId: string, ten: readonly string[], token: string): Promise<string> {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `survivor ${partyId.slice(-1)}`,
          members: ten.map((puuid, index) => ({
            puuid,
            gameName: `S${all.indexOf(puuid)}`,
            tagLine: 'EUW',
            summonerId: 8_000 + all.indexOf(puuid),
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        token,
      ),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { lobbyId: string }).lobbyId;
  }

  async function eog(partyId: string, ten: readonly string[], token: string): Promise<void> {
    const gameId = testGameId();
    gameIds.push(gameId);
    const started = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, token),
    );
    expect(started.status).toBe(200);
    const ended = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId, puuids: ten, startedAt: new Date().toISOString() }),
        token,
      ),
    );
    expect(ended.status).toBe(200);
  }

  /** The stored state the bug is about: the group's card empty, B's own row still holding Mirror. */
  async function expectUnfolded(key: Key): Promise<void> {
    const group = await db.from('group_modes').select('pending_rule').eq('group_id', groups[key]).single();
    if (group.error) throw new Error(group.error.message);
    expect(group.data.pending_rule).toBeNull();
    const forks = await db
      .from('lobby_modes')
      .select('lcu_party_id, pending_rule')
      .eq('group_id', groups[key]);
    if (forks.error) throw new Error(forks.error.message);
    expect(forks.data).toEqual([{ lcu_party_id: party(key, 'b'), pending_rule: 'mirror' }]);
  }

  /** Tonight and the panel, read as the page reads them, at `now`. */
  async function expectMirrorShown(key: Key, now?: Date): Promise<void> {
    const snapshot = await loadTonight(anon, {
      nightStart: tonightStart(),
      timeZone: 'Africa/Cairo',
      groupId: groups[key],
      ...(now === undefined ? {} : { now }),
    });
    expect(snapshot.lobbies?.map((table) => table.partyId)).toEqual([party(key, 'b')]);
    expect(snapshot.modeRow?.pending).toEqual({ id: 'mirror' });
    const panel = await loadModePanelView(anon, groups[key], tonightStart(), null, now);
    expect(panel.liveTables).toBe(1);
    expect(panel.view.pending).toEqual({ id: 'mirror' });
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    const created = await createTestGroups(db, runId, keys);
    const anaId = idOf.get(ANA) ?? '';
    const linked = await db.from('players').update({ discord_id: anaDiscord }).eq('id', anaId);
    if (linked.error) throw new Error(linked.error.message);
    for (const key of keys) {
      groups[key] = created[key] ?? '';
      await pinTestGroupMode(db, groups[key], 'normal');
      await setTestMembership(db, groups[key], anaId, 'owner');
      for (const puuid of all.slice(1))
        await setTestMembership(db, groups[key], idOf.get(puuid) ?? '', 'member');
      for (const [who, puuid] of [
        ['ana', ANA],
        ['bo', BO],
      ] as const) {
        const minted = mintCompanionToken();
        const inserted = await db.from('companion_tokens').insert({
          player_id: idOf.get(puuid) ?? '',
          token_hash: minted.tokenHash,
          label: `sv-${key}-${who}-${runId}`,
          group_id: groups[key],
          last_seen_at: new Date().toISOString(),
        });
        if (inserted.error) throw new Error(inserted.error.message);
        tokens[key][who] = minted.token;
      }
    }
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', all);
  });

  it("A ends because its host moved into B: Tonight and the panel show B's Mirror before any mode write", async () => {
    const key = 'moved';
    const a = await post(party(key, 'a'), anaTen, tokens[key].ana);
    const b = await post(party(key, 'b'), boTen, tokens[key].bo);
    await card(groups[key], { mode: 'mirror', lobbyId: b });
    // Ana's Kustom joins B (she takes a seat there): the lobby post lets A go.
    expect(await post(party(key, 'b'), [...boTen.slice(0, 9), ANA], tokens[key].ana)).toBe(b);
    const ended = await db.from('lobbies').select('status').eq('id', a).single();
    expect(ended.data?.status).toBe('abandoned');
    await expectUnfolded(key);
    await expectMirrorShown(key);
  });

  it("a finished A runs out its 20 minutes with nothing written: Tonight and the panel show B's Mirror", async () => {
    const key = 'timeout';
    await post(party(key, 'a'), anaTen, tokens[key].ana);
    const b = await post(party(key, 'b'), boTen, tokens[key].bo);
    await card(groups[key], { mode: 'mirror', lobbyId: b });
    await eog(party(key, 'a'), anaTen, tokens[key].ana);
    await expectUnfolded(key);
    await expectMirrorShown(key, new Date(Date.now() + 21 * 60_000));
  });
}
