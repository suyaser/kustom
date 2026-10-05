import type { ModeRow } from '@customs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGroupModeRoute } from '@/app/api/admin/mode/handler';
import { selfLinkRoute } from '@/app/api/me/link/handler';
import { roleTonightRoute } from '@/app/api/me/role-tonight/handler';
import type { AdminAuthResult } from '@/lib/adminAuth';
import type { RebuildResult } from '@/lib/ingest/rebuild';
import { runRebuildCron } from '@/lib/ingest/rebuildCron';
import { sweepIdleLobbies } from '@/lib/lobbyState';
import type { MeAuthResult } from '@/lib/me/identity';
import { missingRow } from '@/lib/mode/state';
import type { ServiceClient } from '@/lib/supabase';
import { LiveChanges } from './bump';

/**
 * M19.9 review: a write that lands and is followed by a throw must still bump, because the retry
 * is a no-op and would never bump. One test per route shape, against fakes so it runs in CI; the
 * shapes that need the database (Roll, Reroll, fearless reset, Start a lobby, the ack, lobby ingest,
 * the eog) are in `liveErrorPaths.integration.test.ts`.
 */

const GROUP = '00000000-0000-4000-8000-00000000000a';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const LOBBY = '22222222-2222-4222-8222-222222222222';
const PUUID = 'puuid-me';

let bumps: string[] = [];
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  bumps = [];
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

/** Reads answer nothing; `bump_group_live` is logged. */
const client = {
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'gte', 'order', 'limit']) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    return chain;
  },
  rpc: async (name: string, args: { p_group: string; p_kind: string }) => {
    bumps.push(`${name}(${args.p_group},${args.p_kind})`);
    return { data: bumps.length, error: null };
  },
} as unknown as ServiceClient;

const json = (path: string, body: unknown) =>
  new Request(`http://localhost/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const meAs = (player: { playerId: string; puuid: string } | null) => ({
  getClient: () => client,
  authorize: async (): Promise<MeAuthResult> => ({
    ok: true,
    me: { userId: 'u', discordId: '42', player },
  }),
  groupRole: () => async () => 'member' as const,
});

describe('a write that lands and then throws still bumps (M19.9)', () => {
  it('role for tonight: the player write lands, the row write throws', async () => {
    const written: string[] = [];
    const route = roleTonightRoute({
      ...meAs({ playerId: PLAYER, puuid: PUUID }),
      store: () => ({
        findPlayerIdByPuuid: async () => PLAYER,
        findLobbyStatus: async () => 'open',
        isMember: async () => true,
        writePreference: async () => {
          written.push('preference');
        },
        writeOverride: async () => {
          throw new Error('row write failed');
        },
      }),
    });
    const response = await route(json('me/role-tonight', { groupId: GROUP, lobbyId: LOBBY, role: 'mid' }));
    expect(response.status).toBe(500);
    expect(written).toEqual(['preference']);
    expect(bumps).toEqual([`bump_group_live(${GROUP},lobby)`]);
  });

  it('self link: the link write throws after landing', async () => {
    const route = selfLinkRoute({
      ...meAs(null),
      store: () => ({
        claimSetPuuids: async () => new Set([PUUID]),
        findPlayerByPuuid: async () => ({ playerId: PLAYER, discordId: null, holdsAdminRole: false }),
        linkIfUnlinked: async () => {
          throw new Error('socket closed after the update');
        },
      }),
    });
    const response = await route(json('me/link', { groupId: GROUP, puuid: PUUID }));
    expect(response.status).toBe(500);
    expect(bumps).toEqual([`bump_group_live(${GROUP},roster)`]);
  });

  it('mode: the card write throws after landing', async () => {
    const admin: AdminAuthResult = {
      ok: true,
      admin: {
        userId: 'u',
        discordId: '1',
        playerId: PLAYER,
        groupId: GROUP,
        puuid: PUUID,
        displayName: null,
        email: null,
        discordName: null,
      },
    };
    const card: ModeRow = { ...missingRow(), standing: 'fearless' };
    const route = setGroupModeRoute({
      getClient: () => client,
      authorize: async () => admin,
      store: {
        read: async () => ({ row: card, exists: true, updatedAt: '2026-10-05T18:00:00.000Z' }),
        write: async () => {
          throw new Error('timeout after commit');
        },
      },
    });
    const response = await route(json('admin/mode', { groupId: GROUP, mode: 'normal' }));
    expect(response.status).toBe(500);
    expect(bumps).toEqual([`bump_group_live(${GROUP},mode)`]);
  });

  it('the idle sweep: the first statement lands, the second throws; the first one’s groups are noted', async () => {
    const A = 'group-a';
    let call = 0;
    const sweeping = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ['update', 'in', 'eq', 'lt', 'delete', 'not']) chain[method] = () => chain;
        chain.select = async () => {
          if (table !== 'lobbies') return { data: [], error: null };
          call += 1;
          return call === 1
            ? { data: [{ id: LOBBY, group_id: A }], error: null }
            : { data: null, error: { message: 'connection reset' } };
        };
        return chain;
      },
    } as unknown as ServiceClient;
    const live = new LiveChanges();
    await expect(sweepIdleLobbies(sweeping, new Date(), live)).rejects.toThrow('connection reset');
    expect([...live.groups]).toEqual([[A, 'lobby']]);
  });

  it('the rebuild cron: a fold that wrote then reran clean, and a fold that threw, are both noted', async () => {
    const report = (changed: number) =>
      ({
        gamePlayerRowsChanged: changed,
        breakdownsFilled: 0,
        ratingRowsChanged: 0,
        prunedRatings: 0,
        rolesChanged: 0,
        dryRun: false,
        problems: [],
        rated: 1,
      }) as never;
    const runs = new Map<string, RebuildResult[]>([
      [
        'fenced',
        [
          { ok: false, code: 'fence', message: 'drift', report: report(3) },
          { ok: true, report: report(0) },
        ],
      ],
    ]);
    const live = new LiveChanges();
    const lines = await runRebuildCron(client, {
      elapsedMs: () => 0,
      startBudgetMs: 1_000,
      findPending: async () => [
        { groupId: 'fenced', pendingGames: 1 },
        { groupId: 'threw', pendingGames: 1 },
        { groupId: 'clean', pendingGames: 1 },
      ],
      rebuild: async (_client, groupId) => {
        if (groupId === 'threw') throw new Error('fold died after writing');
        if (groupId === 'clean') return { ok: true, report: report(0) };
        const next = runs.get(groupId)?.shift();
        if (next === undefined) throw new Error('no more runs');
        return next;
      },
      live,
    });
    expect(lines.map((line) => line.status)).toEqual(['rated', 'failed', 'rated']);
    expect([...live.groups]).toEqual([
      ['fenced', 'ratings'],
      ['threw', 'ratings'],
    ]);
  });
});
