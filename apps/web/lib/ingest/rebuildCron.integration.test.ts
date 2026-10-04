import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The daily rebuild cron (M14.63) against the local stack: a backfilled game in group B is rated
 * after one run, and nothing happens while a lobby is live there.
 *
 * Runs in two groups of its own. The cron's finder reads every group, so this file checks what it
 * found for its groups and folds **only those** (`findPending` narrowed to them): another group on
 * the shared stack, the original one included, is never folded by this test.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the rebuild cron against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';

  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { findGroupsWithUnratedBackfill, runRebuildCron } = await import('./rebuildCron');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const base = testGameId();
  const backfillGameId = base + 1;
  const aramGameId = base + 2;
  const allGameIds = [backfillGameId, aramGameId];

  let groupA = '';
  let groupB = '';
  const tokens: Record<string, string> = {};
  let lobbyId = '';

  function backfillBody(gameId: number, extraRaw: Record<string, unknown> = {}) {
    const body = eogBody({
      gameId,
      puuids,
      partyId: null,
      winningSide: 100,
      startedAt: '2026-08-01T19:00:00.000Z',
      durationS: 1_800,
      raw: extraRaw,
    }) as Record<string, unknown>;
    const { partyId: _dropped, ...rest } = body;
    return {
      ...rest,
      source: 'backfill',
      participants: (body.participants as Record<string, unknown>[]).map((p) => ({ ...p, role: null })),
    };
  }

  async function post(groupId: string, body: unknown) {
    return postGame(
      new Request('http://localhost/api/companion/game', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[groupId]}` },
        body: JSON.stringify(body),
      }),
    );
  }

  async function muAfters(lcuGameId: number): Promise<(number | null)[]> {
    const { data: game } = await db.from('games').select('id').eq('lcu_game_id', lcuGameId).single();
    const { data, error } = await db
      .from('game_players')
      .select('mu_after')
      .eq('game_id', game?.id ?? '')
      .order('player_id');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.mu_after);
  }

  /** The cron as the route runs it, folding only this file's groups. */
  async function runOnce() {
    return runRebuildCron(db, {
      elapsedMs: () => 0,
      startBudgetMs: 30_000,
      findPending: async (client) =>
        (await findGroupsWithUnratedBackfill(client)).filter(
          (group) => group.groupId === groupA || group.groupId === groupB,
        ),
    });
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    const groups = await createTestGroups(db, runId, ['crona', 'cronb'] as const);
    groupA = groups.crona;
    groupB = groups.cronb;
    for (const groupId of [groupA, groupB]) {
      // Backfill stores a new game only where six of the ten are members (M13.3).
      for (const puuid of puuids) await setTestMembership(db, groupId, ids.get(puuid) ?? '', 'member');
      const { token, tokenHash } = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        group_id: groupId,
        player_id: ids.get(puuids[0] as string) ?? '',
        token_hash: tokenHash,
        label: `it-${runId}-cron`,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[groupId] = token;
    }

    // B: a Rift backfill, stored unrated. A: an ARAM backfill, which the fold never rates and
    // so must never make A look like it is waiting.
    const rift = await post(groupB, backfillBody(backfillGameId));
    expect(await rift.json()).toMatchObject({ created: true, rated: false, reason: 'backfill' });
    const aram = await post(groupA, backfillBody(aramGameId, { gameMode: 'ARAM' }));
    expect(aram.status).toBe(200);

    // Both landed just now, which the fold's own 15-minute guard would refuse; age them so the
    // only guard in play below is the lobby.
    const aged = await db
      .from('games')
      .update({ created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .in('lcu_game_id', allGameIds);
    if (aged.error) throw new Error(aged.error.message);
  });

  afterAll(async () => {
    const problems: string[] = [];
    const attempt = async (what: string, step: () => PromiseLike<unknown>) => {
      try {
        const result = (await step()) as { error?: { message?: string } | null } | null;
        if (result?.error) problems.push(`${what}: ${result.error.message ?? 'failed'}`);
      } catch (thrown) {
        problems.push(`${what}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    };
    await attempt('deleting this run’s games', () => db.from('games').delete().in('lcu_game_id', allGameIds));
    await attempt('deleting the test groups', () => deleteTestGroups(db, [groupA, groupB]));
    await attempt('deleting this run’s players', () => db.from('players').delete().in('puuid', puuids));
    if (problems.length > 0) throw new Error(`rebuild cron cleanup: ${problems.join('; ')}`);
  });

  it('finds B waiting with one game, and not A (an ARAM backfill is never rated)', async () => {
    const found = (await findGroupsWithUnratedBackfill(db)).filter(
      (group) => group.groupId === groupA || group.groupId === groupB,
    );
    expect(found).toEqual([{ groupId: groupB, pendingGames: 1 }]);
  });

  it('does nothing while a lobby is live in B', async () => {
    const { data, error } = await db
      .from('lobbies')
      .insert({ group_id: groupB, lcu_party_id: `it-${runId}-cron-party`, status: 'open' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    lobbyId = data.id;

    const lines = await runOnce();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ groupId: groupB, status: 'blocked', ratedGames: null });
    expect(await muAfters(backfillGameId)).toEqual(Array(10).fill(null));
  });

  it('rates the backfilled game after one run once nothing is live, and then has nothing to do', async () => {
    const closed = await db.from('lobbies').update({ status: 'abandoned' }).eq('id', lobbyId);
    if (closed.error) throw new Error(closed.error.message);

    const lines = await runOnce();
    expect(lines).toEqual([
      { groupId: groupB, status: 'rated', ratedGames: 1, pendingGames: 1, reason: null },
    ]);
    const after = await muAfters(backfillGameId);
    expect(after).toHaveLength(10);
    for (const mu of after) expect(typeof mu).toBe('number');

    const { data: ratings } = await db.from('ratings').select('player_id').eq('group_id', groupB);
    expect(ratings).toHaveLength(10);
    // A's ARAM was walked past: no ratings there.
    const { data: aRatings } = await db.from('ratings').select('player_id').eq('group_id', groupA);
    expect(aRatings).toHaveLength(0);

    expect(await runOnce()).toEqual([]);
  });
}
