import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensurePlayers } from '../ingest/players';
import { testGameId } from '../testing/fixtures';
import { resolveLocalStack } from '../testing/localStack';
import { claimablePuuids, claimSetPuuids } from './claimable';
import { LINK_NOT_CLAIMABLE, LINK_TAKEN } from './copy';
import { linkSelf, supabaseSelfLinkStore } from './selfLink';

/**
 * M14.34 against the local stack: `That's me` offers tonight's lobby **plus the ten of any game
 * of the group that ended in the last 12 hours**, unlinked only, and `POST /api/me/link`'s store
 * asks the same set again before it writes.
 *
 * Everything here lives in this file's own two groups (`it-<run>-claim-a`, `-b`) with
 * `it-<run>-…` PUUIDs and Discord ids, and the cleanup removes every row it made. Skipped, not
 * failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('claimable (M14.34) against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = (tag: string): string[] =>
    Array.from({ length: 10 }, (_, index) => `it-${runId}-${tag}${String(index).padStart(2, '0')}`);
  const HOUR = 60 * 60 * 1000;
  const DURATION_S = 1_800;
  const TZ = 'UTC';

  /** Ended 11 hours ago: claimable. */
  const recent = ten('r');
  /** Ended 13 hours ago: not. */
  const stale = ten('s');
  /** Played a month ago, written (backfilled) just now: not. `created_at` is not the end. */
  const backfilled = ten('k');
  /** Group B's game, an hour ago: claimable from B, never from A. */
  const otherGroup = ten('o');
  /** Tonight's lobby in A, no game yet: M3.6's rule, unchanged. */
  const lobby = ten('l').slice(0, 3);
  const allPuuids = [...recent, ...stale, ...backfilled, ...otherGroup, ...lobby];

  const groups = { a: '', b: '' };
  const now = new Date();

  async function insertGame(groupId: string, puuids: readonly string[], endedAgoMs: number): Promise<void> {
    const startedAt = new Date(now.getTime() - endedAgoMs - DURATION_S * 1000).toISOString();
    const { data: game, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: testGameId(),
        started_at: startedAt,
        duration_s: DURATION_S,
        winning_side: 100,
        raw: {},
        source: endedAgoMs > 24 * HOUR ? 'backfill' : 'eog',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    const seats = await db.from('game_players').insert(
      puuids.map((puuid, index) => ({
        game_id: game.id,
        group_id: groupId,
        player_id: ids.get(puuid) ?? '',
        side: index < 5 ? 100 : 200,
      })),
    );
    if (seats.error) throw new Error(seats.error.message);
  }

  function visitor(tag: string) {
    return { userId: randomUUID(), discordId: `it-${runId}-discord-${tag}`, player: null };
  }

  beforeAll(async () => {
    for (const key of ['a', 'b'] as const) {
      const { data, error } = await db
        .from('groups')
        .insert({ slug: `it-${runId}-claim-${key}`, name: `claim ${key}` })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      groups[key] = data.id;
    }

    await insertGame(groups.a, recent, 11 * HOUR);
    await insertGame(groups.a, stale, 13 * HOUR);
    await insertGame(groups.a, backfilled, 30 * 24 * HOUR);
    await insertGame(groups.b, otherGroup, 1 * HOUR);

    const { data: lobbyRow, error } = await db
      .from('lobbies')
      .insert({ group_id: groups.a, lcu_party_id: `it-${runId}-party`, status: 'open' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const ids = await ensurePlayers(
      db,
      lobby.map((puuid) => ({ puuid })),
    );
    const members = await db
      .from('lobby_members')
      .insert(lobby.map((puuid) => ({ lobby_id: lobbyRow.id, player_id: ids.get(puuid) ?? '' })));
    if (members.error) throw new Error(members.error.message);

    // M14.26: recent[1] owns group B, recent[2] is an admin of A, recent[3] a member of A, and
    // recent[4] an owner who already linked. All unlinked but recent[4].
    const staff = await ensurePlayers(
      db,
      [recent[1], recent[2], recent[3], recent[4]].map((puuid) => ({ puuid: puuid ?? '' })),
    );
    const roles = await db.from('group_memberships').insert([
      { group_id: groups.b, player_id: staff.get(recent[1] ?? '') ?? '', role: 'owner' },
      { group_id: groups.a, player_id: staff.get(recent[2] ?? '') ?? '', role: 'admin' },
      { group_id: groups.a, player_id: staff.get(recent[3] ?? '') ?? '', role: 'member' },
      { group_id: groups.a, player_id: staff.get(recent[4] ?? '') ?? '', role: 'owner' },
    ]);
    if (roles.error) throw new Error(roles.error.message);
    const ownerLinked = await db
      .from('players')
      .update({ discord_id: `it-${runId}-discord-linked-owner` })
      .eq('puuid', recent[4] ?? '');
    if (ownerLinked.error) throw new Error(ownerLinked.error.message);

    // One of the recent ten is already somebody's: never offered, never stolen.
    const linked = await db
      .from('players')
      .update({ discord_id: `it-${runId}-discord-owner` })
      .eq('puuid', recent[9] ?? '');
    if (linked.error) throw new Error(linked.error.message);
  });

  afterAll(async () => {
    const both = [groups.a, groups.b].filter((id) => id !== '');
    await db.from('games').delete().in('group_id', both);
    await db.from('lobbies').delete().in('group_id', both);
    await db.from('ratings').delete().in('group_id', both);
    await db.from('group_memberships').delete().in('group_id', both);
    await db.from('players').delete().in('puuid', allPuuids);
    await db.from('groups').delete().in('id', both);
  });

  describe('the claim set (M14.34)', () => {
    it('offers a game that ended 11 hours ago, not 13, not a backfilled old game, not a linked player', async () => {
      const offered = new Set(await claimablePuuids(db, { now, timeZone: TZ, groupId: groups.a }));

      for (const puuid of [recent[0], recent[3], ...recent.slice(5, 9)])
        expect(offered.has(puuid ?? '')).toBe(true);
      // M14.26: an owner (of another group) and an admin, unlinked, are never offered; nor a linked owner.
      for (const puuid of [recent[1], recent[2], recent[4]]) expect(offered.has(puuid ?? '')).toBe(false);
      expect(offered.has(recent[9] ?? '')).toBe(false);
      for (const puuid of stale) expect(offered.has(puuid)).toBe(false);
      for (const puuid of backfilled) expect(offered.has(puuid)).toBe(false);
      // M3.6's rule still stands beside it.
      for (const puuid of lobby) expect(offered.has(puuid)).toBe(true);
    });

    it("never offers another group's game, and offers it in that group", async () => {
      const fromA = new Set(await claimablePuuids(db, { now, timeZone: TZ, groupId: groups.a }));
      const fromB = new Set(await claimablePuuids(db, { now, timeZone: TZ, groupId: groups.b }));
      for (const puuid of otherGroup) {
        expect(fromA.has(puuid)).toBe(false);
        expect(fromB.has(puuid)).toBe(true);
      }
      for (const puuid of recent) expect(fromB.has(puuid)).toBe(false);
    });

    it('keeps the linked player in the raw set, so the route answers taken rather than not-allowed', async () => {
      const set = await claimSetPuuids(db, { now, timeZone: TZ, groupId: groups.a });
      expect(set.has(recent[9] ?? '')).toBe(true);
    });

    it('moves with the clock: the 11-hour game closes once it is past 12 hours', async () => {
      const later = new Date(now.getTime() + 2 * HOUR);
      const offered = new Set(await claimablePuuids(db, { now: later, timeZone: TZ, groupId: groups.a }));
      for (const puuid of recent) expect(offered.has(puuid)).toBe(false);
    });
  });

  describe("POST /api/me/link's store re-asks the set (M14.34)", () => {
    const store = (groupId: string) => supabaseSelfLinkStore(db, { now, timeZone: TZ, groupId });

    it('links a player from an 11-hour-old game, once, and then offers them to nobody', async () => {
      const result = await linkSelf(store(groups.a), visitor('r0'), recent[0] ?? '');
      expect(result.ok).toBe(true);

      const { data } = await db
        .from('players')
        .select('discord_id')
        .eq('puuid', recent[0] ?? '')
        .single();
      expect(data?.discord_id).toBe(`it-${runId}-discord-r0`);
      expect(await claimablePuuids(db, { now, timeZone: TZ, groupId: groups.a })).not.toContain(recent[0]);

      const again = await linkSelf(store(groups.a), visitor('thief'), recent[0] ?? '');
      expect(again).toEqual({ ok: false, status: 409, error: LINK_TAKEN });
    });

    it('refuses a 13-hour-old game, a backfilled one and another group, writing nothing', async () => {
      for (const puuid of [stale[0], backfilled[0], otherGroup[0]]) {
        const result = await linkSelf(store(groups.a), visitor(`x-${puuid}`), puuid ?? '');
        expect(result).toEqual({ ok: false, status: 403, error: LINK_NOT_CLAIMABLE });
      }
      const { data } = await db
        .from('players')
        .select('discord_id')
        .in('puuid', [stale[0] ?? '', backfilled[0] ?? '', otherGroup[0] ?? '']);
      expect((data ?? []).every((row) => row.discord_id === null)).toBe(true);
    });

    it('refuses an unlinked owner (of any group) and an unlinked admin with the 403, writing nothing (M14.26)', async () => {
      for (const puuid of [recent[1], recent[2]]) {
        const result = await linkSelf(store(groups.a), visitor(`staff-${puuid}`), puuid ?? '');
        expect(result).toEqual({ ok: false, status: 403, error: LINK_NOT_CLAIMABLE });
      }
      const { data } = await db
        .from('players')
        .select('discord_id')
        .in('puuid', [recent[1] ?? '', recent[2] ?? '']);
      expect(data).toHaveLength(2);
      expect((data ?? []).every((row) => row.discord_id === null)).toBe(true);
    });

    it('links a member, and answers a linked owner with taken (M14.26)', async () => {
      const member = await linkSelf(store(groups.a), visitor('member'), recent[3] ?? '');
      expect(member.ok).toBe(true);
      const owner = await linkSelf(store(groups.a), visitor('owner-thief'), recent[4] ?? '');
      expect(owner).toEqual({ ok: false, status: 409, error: LINK_TAKEN });
      const { data } = await db
        .from('players')
        .select('discord_id')
        .eq('puuid', recent[4] ?? '')
        .single();
      expect(data?.discord_id).toBe(`it-${runId}-discord-linked-owner`);
    });

    it('never steals a player who is already linked', async () => {
      const result = await linkSelf(store(groups.a), visitor('steal'), recent[9] ?? '');
      expect(result).toEqual({ ok: false, status: 409, error: LINK_TAKEN });
      const { data } = await db
        .from('players')
        .select('discord_id')
        .eq('puuid', recent[9] ?? '')
        .single();
      expect(data?.discord_id).toBe(`it-${runId}-discord-owner`);
    });
  });
}
