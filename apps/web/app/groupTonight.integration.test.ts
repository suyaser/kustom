import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M13.9 against the local stack: two fixture groups, each with tonight's open lobby, a finished
 * game on the tape and a fearless pool, read **with the anon key** exactly as a phone reads them.
 *
 * - Acceptance 1: `/g/a` and `/g/b` each show only their own lobby, tape and fearless list, and
 *   an unknown slug resolves to nothing (the page's 404).
 * - Acceptance 2: a uuid that is a game resolves to its group's slug (the page's 308); a uuid
 *   that is no game resolves to nothing.
 * - `/`'s membership read: oldest membership first, by slug.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('group pages against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { resolveGroupParam } = await import('@/lib/groups/resolve');
  const { loadLandingMemberships } = await import('@/lib/groups/landing');
  const { TonightView } = await import('./_tonight/TonightView');
  const { PageGroupProvider } = await import('./_shell/PageGroup');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const KEYS = ['a', 'b'] as const;
  type Key = (typeof KEYS)[number];

  /** Real champion ids, a different ten per group, so a pool that leaked would show it. */
  const CHAMPIONS: Record<Key, number[]> = {
    a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    b: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  };

  const puuids = (key: Key) =>
    Array.from({ length: 10 }, (_, index) => `it-${runId}-g${key}${String(index).padStart(2, '0')}`);

  let groupIds: Record<Key, string> = { a: '', b: '' };
  const slugs: Record<Key, string> = { a: `it-${runId}-a`, b: `it-${runId}-b` };
  const openLobby: Record<Key, string> = { a: '', b: '' };
  const finishedLobby: Record<Key, string> = { a: '', b: '' };
  const gameId: Record<Key, string> = { a: '', b: '' };
  const playerIds = new Map<string, string>();

  beforeAll(async () => {
    groupIds = await createTestGroups(db, runId, KEYS);

    const ids = await ensurePlayers(
      db,
      KEYS.flatMap((key) =>
        puuids(key).map((puuid, index) => ({ puuid, gameName: `${key.toUpperCase()}${index}` })),
      ),
    );
    for (const [puuid, id] of ids) playerIds.set(puuid, id);

    // Two moments inside tonight, always: between the night's 06:00 and now.
    const start = tonightStart().getTime();
    const span = Date.now() - start;
    const earlier = new Date(start + span / 3).toISOString();
    const later = new Date(start + (2 * span) / 3).toISOString();

    for (const key of KEYS) {
      const group_id = groupIds[key];
      const ten = puuids(key).map((puuid) => playerIds.get(puuid) ?? '');

      const finished = await db
        .from('lobbies')
        .insert({ group_id, lcu_party_id: `gt-${runId}-${key}-1`, status: 'finished', created_at: earlier })
        .select('id')
        .single();
      if (finished.error) throw new Error(finished.error.message);
      finishedLobby[key] = finished.data.id;

      const game = await db
        .from('games')
        .insert({
          group_id,
          lobby_id: finished.data.id,
          lcu_game_id: Number(`7${Date.now() % 100_000_000}${key === 'a' ? 1 : 2}`),
          started_at: earlier,
          duration_s: 1_800,
          winning_side: 100,
          raw: { gameMode: 'CLASSIC' },
        })
        .select('id')
        .single();
      if (game.error) throw new Error(game.error.message);
      gameId[key] = game.data.id;

      const rows = ten.map((player_id, index) => ({
        group_id,
        game_id: game.data.id,
        player_id,
        side: index < 5 ? 100 : 200,
        champion_id: CHAMPIONS[key][index] ?? null,
      }));
      const seats = await db.from('game_players').insert(rows);
      if (seats.error) throw new Error(seats.error.message);

      const open = await db
        .from('lobbies')
        .insert({ group_id, lcu_party_id: `gt-${runId}-${key}-2`, status: 'open', created_at: later })
        .select('id')
        .single();
      if (open.error) throw new Error(open.error.message);
      openLobby[key] = open.data.id;

      const members = await db
        .from('lobby_members')
        .insert(ten.slice(0, 3).map((player_id) => ({ lobby_id: open.data.id, player_id })));
      if (members.error) throw new Error(members.error.message);
    }
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groupIds));
    const { error } = await db
      .from('players')
      .delete()
      .in(
        'puuid',
        KEYS.flatMap((key) => puuids(key)),
      );
    if (error) throw new Error(`cleanup: deleting the test players failed: ${error.message}`);
  });

  describe('two groups on the same night (acceptance 1)', () => {
    for (const key of KEYS) {
      const other: Key = key === 'a' ? 'b' : 'a';

      it(`group ${key} sees only its own lobby, tape and fearless list`, async () => {
        const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId: groupIds[key] });

        expect(snapshot.lobby?.id).toBe(openLobby[key]);
        expect(snapshot.lobby?.members.map((member) => member.puuid)).toEqual(puuids(key).slice(0, 3));

        expect(snapshot.tape.map((entry) => entry.lobbyId)).toEqual([finishedLobby[key]]);
        expect(snapshot.tape[0]?.result?.gameId).toBe(gameId[key]);

        const pool = snapshot.fearless.champions.map((champion) => champion.id).sort((x, y) => x - y);
        expect(pool).toEqual(CHAMPIONS[key]);
        expect(pool.some((id) => CHAMPIONS[other].includes(id))).toBe(false);
      });

      it(`group ${key}'s page links its tape to its own game page and names nobody from group ${other}`, async () => {
        const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId: groupIds[key] });
        const html = renderToStaticMarkup(
          createElement(
            PageGroupProvider,
            { group: { id: groupIds[key], slug: slugs[key], name: `it ${runId} ${key}` } },
            createElement(TonightView, {
              snapshot,
              viewer: { kind: 'anonymous' },
              group: { id: groupIds[key], slug: slugs[key], name: `it ${runId} ${key}` },
              topPlayers: [],
            }),
          ),
        );

        expect(html).toContain(`href="/g/${slugs[key]}/games/${gameId[key]}"`);
        expect(html).not.toContain(gameId[other]);
        expect(html).not.toContain(`${other.toUpperCase()}0`);
        // Every in-app link stays inside the group (acceptance 4, over the page body).
        for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
          // `/how` is Kustom's own page (the receipt's `More on how it works`), not another group's.
          expect(
            href?.startsWith(`/g/${slugs[key]}`) || href?.startsWith('https://') || href === '/how',
            href,
          ).toBe(true);
        }
      });
    }

    it('resolves each slug to its own group, and an unknown slug to nothing', async () => {
      for (const key of KEYS) {
        expect(await resolveGroupParam(anon, slugs[key])).toEqual({
          kind: 'group',
          group: { id: groupIds[key], slug: slugs[key], name: `it ${runId} ${key}` },
        });
      }
      expect(await resolveGroupParam(anon, `nope-${runId}`)).toEqual({ kind: 'none' });
    });
  });

  describe('the old /g/<gameId> links (acceptance 2)', () => {
    it("resolves a game's uuid to that game's group", async () => {
      expect(await resolveGroupParam(anon, gameId.b)).toEqual({
        kind: 'game',
        gameId: gameId.b,
        slug: slugs.b,
      });
      expect(await resolveGroupParam(anon, gameId.a)).toEqual({
        kind: 'game',
        gameId: gameId.a,
        slug: slugs.a,
      });
    });

    it('resolves a uuid that is no game to nothing', async () => {
      expect(await resolveGroupParam(anon, randomUUID())).toEqual({ kind: 'none' });
    });
  });

  describe("/'s membership read", () => {
    it("lists a player's groups oldest membership first", async () => {
      const player = playerIds.get(puuids('a')[0] ?? '') ?? '';
      await setTestMembership(db, groupIds.b, player, 'member');
      await setTestMembership(db, groupIds.a, player, 'admin');

      const memberships = await loadLandingMemberships(db, player);
      const ours = memberships.filter((membership) => Object.values(slugs).includes(membership.slug));
      expect(ours).toEqual([{ slug: slugs.b }, { slug: slugs.a }]);
    });
  });
}
