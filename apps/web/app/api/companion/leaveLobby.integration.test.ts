import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M22.9 against the local stack: a Kustom that says its lobby closed (and no game started) lets
 * its table go at once. The M22.10 ghost: a host closed a pre-game custom and opened nothing, the
 * other host's real lobby stood beside the ghost. After the leave post Tonight shows one lobby.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('a Kustom leaving its lobby against the local Supabase stack', () => {
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

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postLeave } = await import('./lobby/leave/route');
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 22 }, (_, index) => `it-${runId}-lv${index}`);
  const BO = all[0] ?? '';
  const ANA = all[10] ?? '';
  const ZED = all[20] ?? '';
  const boCrew = all.slice(1, 9);
  const anaCrew = all.slice(11, 15);
  const zedCrew = all.slice(15, 19);
  const groups = { g: '', h: '' };
  const idOf = new Map<string, string>();
  const tokens = { bo: '', ana: '', zed: '' };
  const party = (name: string) => `it-${runId}-party-${name}`;

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  async function post(partyId: string, puuids: readonly string[], token: string) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `leave ${partyId.slice(-6)}`,
          members: puuids.map((puuid, index) => ({
            puuid,
            gameName: `P${all.indexOf(puuid)}`,
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
    return (await response.json()) as { lobbyId: string };
  }

  async function leave(partyId: string, token: string) {
    const response = await postLeave(jsonRequest('/api/companion/lobby/leave', { partyId }, token));
    expect(response.status).toBe(200);
    return (await response.json()) as { ok: true; released: boolean };
  }

  async function status(lobbyId: string) {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  async function currentParty(label: string) {
    const { data, error } = await db
      .from('companion_tokens')
      .select('current_party_id')
      .eq('label', `lv-${label}-${runId}`)
      .single();
    if (error) throw new Error(error.message);
    return data.current_party_id;
  }

  async function drawn(groupId = groups.g) {
    const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId });
    return snapshot.lobby?.id ?? null;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    const made = await createTestGroups(db, runId, ['lvg', 'lvh'] as const);
    groups.g = made.lvg;
    groups.h = made.lvh;
    for (const groupId of [groups.g, groups.h]) await pinTestGroupMode(db, groupId, 'normal');
    await setTestMembership(db, groups.g, idOf.get(ANA) ?? '', 'owner');
    await setTestMembership(db, groups.g, idOf.get(BO) ?? '', 'member');
    await setTestMembership(db, groups.h, idOf.get(ZED) ?? '', 'owner');
    for (const [key, puuid, groupId] of [
      ['bo', BO, groups.g],
      ['ana', ANA, groups.g],
      ['zed', ZED, groups.h],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `lv-${key}-${runId}`,
        group_id: groupId,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', all);
  });

  it('the M22.10 ghost: Ana closes her custom and opens nothing, Tonight shows Bo at once; a repeat is a no-op', async () => {
    const real = await post(party('bo'), [BO, ...boCrew], tokens.bo);
    const ghost = await post(party('ana'), [ANA, ...anaCrew], tokens.ana);
    // The newer row is the ghost Tonight draws.
    expect(await drawn()).toBe(ghost.lobbyId);
    expect(await currentParty('ana')).toBe(party('ana'));

    expect(await leave(party('ana'), tokens.ana)).toEqual({ ok: true, released: true });
    expect(await currentParty('ana')).toBeNull();
    expect(await status(ghost.lobbyId)).toBe('abandoned');
    expect(await status(real.lobbyId)).toBe('open');
    expect(await drawn()).toBe(real.lobbyId);

    expect(await leave(party('ana'), tokens.ana)).toEqual({ ok: true, released: false });
    expect(await status(real.lobbyId)).toBe('open');
  });

  it('a leave that arrives after the same Kustom posted its next lobby changes nothing', async () => {
    const first = await post(party('ana2'), [ANA, ...anaCrew], tokens.ana);
    const next = await post(party('ana3'), [ANA, ...anaCrew], tokens.ana);
    expect(await status(first.lobbyId)).toBe('abandoned');
    expect(await leave(party('ana2'), tokens.ana)).toEqual({ ok: true, released: false });
    expect(await status(next.lobbyId)).toBe('open');
    expect(await currentParty('ana')).toBe(party('ana3'));
  });

  it("a leave never touches another group's lobby", async () => {
    const zed = await post(party('zed'), [ZED, ...zedCrew], tokens.zed);
    // Ana names Zed's party: her token is not in it, so nothing is released.
    expect(await leave(party('zed'), tokens.ana)).toEqual({ ok: true, released: false });
    expect(await status(zed.lobbyId)).toBe('open');
    expect(await leave(party('zed'), tokens.zed)).toEqual({ ok: true, released: true });
    expect(await status(zed.lobbyId)).toBe('abandoned');
    expect(await drawn(groups.g)).not.toBeNull();
  });
}
