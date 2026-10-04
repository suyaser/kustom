import { randomBytes } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteTestGroups } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import type { ServiceClient } from '../supabase';
import { supabasePlayerInGroup } from './membership';

/**
 * M19.12: the one-query player-and-membership read against real PostgREST. What the unit test can
 * only assert by the select string is proved here: the non-`!inner` embed keeps a linked non-member's
 * player row (with `[]`) apart from no player row at all, and the filter scopes the embed to the asked
 * group, so a membership elsewhere is not a role here.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('player and membership in one query', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const db = createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
  const lookup = supabasePlayerInGroup(db as unknown as ServiceClient);
  const run = randomBytes(3).toString('hex');
  const discord = (n: number) => `8${run.replace(/[a-f]/g, '1')}${String(n).padStart(6, '0')}`;
  const groupIds: string[] = [];
  const ids = new Map<string, string>();

  beforeAll(async () => {
    const groups = await db
      .from('groups')
      .insert([
        { slug: `pig-${run}-a`, name: 'PIG A' },
        { slug: `pig-${run}-b`, name: 'PIG B' },
      ])
      .select('id, slug');
    if (groups.error) throw groups.error;
    for (const g of groups.data) groupIds.push(g.id);
    const [a, b] = groups.data.map((g) => g.id) as [string, string];
    const people = ['owner', 'admin', 'member', 'stranger', 'elsewhere'] as const;
    const players = await db
      .from('players')
      .insert(
        people.map((name, n) => ({
          puuid: `pig-${run}-${name}`,
          game_name: name,
          tag_line: 'EUW',
          discord_id: discord(n),
        })),
      )
      .select('id, puuid');
    if (players.error) throw players.error;
    for (const row of players.data) ids.set(row.puuid.slice(`pig-${run}-`.length), row.id);
    const memberships = await db.from('group_memberships').insert([
      { group_id: a, player_id: ids.get('owner') as string, role: 'owner' },
      { group_id: a, player_id: ids.get('admin') as string, role: 'admin' },
      { group_id: a, player_id: ids.get('member') as string, role: 'member' },
      { group_id: b, player_id: ids.get('elsewhere') as string, role: 'owner' },
    ]);
    if (memberships.error) throw memberships.error;
  });

  afterAll(async () => {
    await deleteTestGroups(db, groupIds);
    await db.from('players').delete().like('puuid', `pig-${run}-%`);
  });

  describe('player and membership in one query', () => {
    it('no player row for the Discord id: null (unlinked)', async () => {
      expect(await lookup(discord(99), groupIds[0] as string)).toBeNull();
    });

    it('a linked non-member: the player, role null', async () => {
      expect(await lookup(discord(3), groupIds[0] as string)).toEqual({
        player: { playerId: ids.get('stranger'), puuid: `pig-${run}-stranger` },
        role: null,
      });
    });

    it('a member of another group only: no role in this one', async () => {
      expect((await lookup(discord(4), groupIds[0] as string))?.role).toBeNull();
      expect((await lookup(discord(4), groupIds[1] as string))?.role).toBe('owner');
    });

    it('each role in the asked group', async () => {
      expect(await lookup(discord(0), groupIds[0] as string)).toEqual({
        player: { playerId: ids.get('owner'), puuid: `pig-${run}-owner` },
        role: 'owner',
      });
      expect((await lookup(discord(1), groupIds[0] as string))?.role).toBe('admin');
      expect((await lookup(discord(2), groupIds[0] as string))?.role).toBe('member');
      // The owner of A is a stranger to B.
      expect((await lookup(discord(0), groupIds[1] as string))?.role).toBeNull();
    });

    it('a group id that is not a uuid: the player, no role, no error', async () => {
      expect((await lookup(discord(0), 'not-a-uuid'))?.role).toBeNull();
    });
  });
}
