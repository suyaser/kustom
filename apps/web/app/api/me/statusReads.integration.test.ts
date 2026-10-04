import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUserLike } from '@/lib/adminAuth';
import { NOT_IN_THIS_GROUP } from '@/lib/me/copy';
import { READ_NOT_LINKED, READ_SIGN_IN_REQUIRED } from '@/lib/me/readRoute';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { startStatusResponseSchema } from './lobbies/start/status/schema';
import { recapStatusResponseSchema } from './recap/status/schema';

/**
 * M19.16's two status reads against the Supabase CLI local stack: `GET /api/me/lobbies/start/status`
 * and `GET /api/me/recap/status`. Only the GoTrue user is faked; the player, the membership, the
 * command and the line are real rows, so "a member gets it, a non-member is 403" is an assertion
 * about `group_memberships`, not about a mock. Signed out goes through the real route exports with
 * no cookie at all.
 *
 * Scratch groups of its own (`createTestGroups`), deleted after; the start clock is a fixed 2019
 * instant, so the night window sees only this file's command. Skipped without the stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('M19.16 status reads against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { startStatusRoute } = await import('./lobbies/start/status/handler');
  const { GET: startStatusExport } = await import('./lobbies/start/status/route');
  const { recapStatusRoute } = await import('./recap/status/handler');
  const { GET: recapStatusExport } = await import('./recap/status/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** 22:00 Cairo, a Sunday in 2019 (the night started at 04:00Z), as in `start.integration.test.ts`. */
  const NOW = new Date('2019-06-09T20:00:00.000Z');
  const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

  const runId = randomUUID().slice(0, 8);
  const digits = runId.replace(/\D/g, '') || '1';
  const discord = { member: `8${digits}00001`, outsider: `8${digits}00002`, nobody: `8${digits}00003` };

  let A = '';
  let B = '';
  const playerIds: string[] = [];
  let memberId = '';
  let hostId = '';
  let commandId = '';
  const gameIds = { published: '', hidden: '', pending: '', none: '', other: '' };

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  const as = (discordId: string) => ({
    getClient: () => db,
    resolveSessionUser: async () => sessionUser(discordId),
  });

  const startGet = (groupId: string) =>
    new Request(`http://localhost/api/me/lobbies/start/status?groupId=${groupId}`);
  const recapGet = (groupId: string, gameId: string) =>
    new Request(`http://localhost/api/me/recap/status?groupId=${groupId}&gameId=${gameId}`);

  async function insertPlayer(key: string, discordId: string | null, displayName: string): Promise<string> {
    const { data, error } = await db
      .from('players')
      .insert({ puuid: `ss-${runId}-${key}`, display_name: displayName, discord_id: discordId })
      .select('id')
      .single();
    if (error) throw new Error(`player ${key}: ${error.message}`);
    playerIds.push(data.id);
    return data.id;
  }

  async function insertGame(groupId: string, offset: number): Promise<string> {
    const { data, error } = await db
      .from('games')
      .insert({
        group_id: groupId,
        lcu_game_id: 9_300_000_000_000 + Math.floor(Math.random() * 1_000_000) * 10 + offset,
        duration_s: 1800,
        started_at: new Date(Date.now() - 40 * 60_000).toISOString(),
        winning_side: 100,
        raw: { gameMode: 'CLASSIC' },
      })
      .select('id')
      .single();
    if (error) throw new Error(`game: ${error.message}`);
    return data.id;
  }

  async function insertLine(groupId: string, gameId: string, status: 'published' | 'hidden' | 'pending') {
    const stamp = new Date().toISOString();
    const { error } = await db.from('ai_lines').insert({
      group_id: groupId,
      kind: 'game',
      subject: gameId,
      game_id: gameId,
      status,
      text: status === 'pending' ? null : '{P0} carried.',
      token_map: {},
      facts: [],
      fact_hash: '0'.repeat(64),
      model: 'test',
      prompt_version: 'test',
      published_at: status === 'pending' ? null : stamp,
      hidden_at: status === 'hidden' ? stamp : null,
    });
    if (error) throw new Error(`line ${status}: ${error.message}`);
  }

  beforeAll(async () => {
    ({ A, B } = await createTestGroups(db, runId, ['A', 'B'] as const));
    memberId = await insertPlayer('member', discord.member, 'Member');
    hostId = await insertPlayer('host', null, 'Hosty');
    const outsiderId = await insertPlayer('outsider', discord.outsider, 'Outsider');
    await setTestMembership(db, A, memberId, 'member');
    await setTestMembership(db, A, hostId, 'member');
    await setTestMembership(db, B, outsiderId, 'member');
    // Both groups Premium with AI lines on (the default), so the recap gate is open.
    const premium = await db.from('groups').update({ premium: true }).in('id', [A, B]);
    if (premium.error) throw new Error(`premium: ${premium.error.message}`);

    const command = await db
      .from('companion_commands')
      .insert({
        group_id: A,
        kind: 'create_lobby',
        target_player_id: hostId,
        status: 'pending',
        created_at: minutesBefore(1),
        expires_at: new Date(NOW.getTime() + 59_000).toISOString(),
      })
      .select('id')
      .single();
    if (command.error) throw new Error(`command: ${command.error.message}`);
    commandId = command.data.id;

    gameIds.published = await insertGame(A, 1);
    gameIds.hidden = await insertGame(A, 2);
    gameIds.pending = await insertGame(A, 3);
    gameIds.none = await insertGame(A, 4);
    gameIds.other = await insertGame(B, 5);
    await insertLine(A, gameIds.published, 'published');
    await insertLine(A, gameIds.hidden, 'hidden');
    await insertLine(A, gameIds.pending, 'pending');
    await insertLine(B, gameIds.other, 'published');
  }, 60_000);

  afterAll(async () => {
    // Games cascade their lines; the groups' commands, memberships and games go with the groups.
    await deleteTestGroups(db, [A, B]);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  describe('GET /api/me/lobbies/start/status', () => {
    const route = (discordId: string) => startStatusRoute({ ...as(discordId), now: () => NOW });

    it('a member gets the pending press and whose PC it went to', async () => {
      const response = await route(discord.member)(startGet(A));
      expect(response.status).toBe(200);
      const body = startStatusResponseSchema.parse(await response.json());
      expect(body).toEqual({ status: 'pending', host: { name: 'Hosty' } });
    });

    it('follows the row: sent, acked as done, failed', async () => {
      for (const [row, answer] of [
        ['sent', 'sent'],
        ['acked', 'done'],
        ['failed', 'failed'],
      ] as const) {
        const update = await db.from('companion_commands').update({ status: row }).eq('id', commandId);
        if (update.error) throw new Error(update.error.message);
        const body = await (await route(discord.member)(startGet(A))).json();
        expect(body).toEqual({ status: answer, host: { name: 'Hosty' } });
      }
    });

    /**
     * fix-start-pending: the row expires at NOW + 59 s and nothing sweeps it (no companion polls in
     * this file, nobody presses again). Past that instant the poll answers `failed`, the word the
     * sweep will write, instead of `pending` for the rest of the night; an acked row stays `done`.
     */
    it('answers failed once a pending or sent press is past its expires_at, with no sweep', async () => {
      const later = startStatusRoute({ ...as(discord.member), now: () => new Date(NOW.getTime() + 59_000) });
      for (const row of ['pending', 'sent'] as const) {
        const update = await db.from('companion_commands').update({ status: row }).eq('id', commandId);
        if (update.error) throw new Error(update.error.message);
        const justBefore = startStatusRoute({
          ...as(discord.member),
          now: () => new Date(NOW.getTime() + 58_999),
        });
        expect(await (await justBefore(startGet(A))).json()).toEqual({
          status: row,
          host: { name: 'Hosty' },
        });
        const body = startStatusResponseSchema.parse(await (await later(startGet(A))).json());
        expect(body).toEqual({ status: 'failed', host: { name: 'Hosty' } });
      }
      // The read wrote nothing: the row is still what it was.
      const { data } = await db.from('companion_commands').select('status').eq('id', commandId).single();
      expect(data?.status).toBe('sent');

      const acked = await db.from('companion_commands').update({ status: 'acked' }).eq('id', commandId);
      if (acked.error) throw new Error(acked.error.message);
      expect(await (await later(startGet(A))).json()).toEqual({ status: 'done', host: { name: 'Hosty' } });
    });

    it('null and null when nobody pressed tonight (another night, another group)', async () => {
      // The next night: this file's press is last night's.
      const tomorrow = startStatusRoute({
        ...as(discord.member),
        now: () => new Date(NOW.getTime() + 24 * 60 * 60_000),
      });
      expect(await (await tomorrow(startGet(A))).json()).toEqual({ status: null, host: null });
      // Group B's member asks about B, which has no press.
      expect(await (await route(discord.outsider)(startGet(B))).json()).toEqual({ status: null, host: null });
    });

    it('403 for a linked player who is not a member of the group', async () => {
      const response = await route(discord.outsider)(startGet(A));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: NOT_IN_THIS_GROUP });
    });

    it('403 for a session that matches no player', async () => {
      const response = await route(discord.nobody)(startGet(A));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: READ_NOT_LINKED });
    });

    it('401 signed out, through the real export', async () => {
      const response = await startStatusExport(startGet(A));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: READ_SIGN_IN_REQUIRED });
    });
  });

  describe('GET /api/me/recap/status', () => {
    const route = (discordId: string) => recapStatusRoute(as(discordId));
    const landed = async (discordId: string, groupId: string, gameId: string) => {
      const response = await route(discordId)(recapGet(groupId, gameId));
      expect(response.status).toBe(200);
      return recapStatusResponseSchema.parse(await response.json()).landed;
    };

    it('a member: true only for a published line', async () => {
      expect(await landed(discord.member, A, gameIds.published)).toBe(true);
      expect(await landed(discord.member, A, gameIds.hidden)).toBe(false);
      expect(await landed(discord.member, A, gameIds.pending)).toBe(false);
      expect(await landed(discord.member, A, gameIds.none)).toBe(false);
    });

    it("another group's game is false, even with a published line", async () => {
      expect(await landed(discord.member, A, gameIds.other)).toBe(false);
    });

    it('false while the gate is closed (AI lines off, then Premium off), true again when it opens', async () => {
      const set = async (values: { premium?: boolean; ai_lines_enabled?: boolean }) => {
        const update = await db.from('groups').update(values).eq('id', A);
        if (update.error) throw new Error(update.error.message);
      };
      try {
        await set({ ai_lines_enabled: false });
        expect(await landed(discord.member, A, gameIds.published)).toBe(false);
        await set({ ai_lines_enabled: true, premium: false });
        expect(await landed(discord.member, A, gameIds.published)).toBe(false);
      } finally {
        await set({ ai_lines_enabled: true, premium: true });
      }
      expect(await landed(discord.member, A, gameIds.published)).toBe(true);
    });

    it('403 for a linked player who is not a member of the group', async () => {
      const response = await route(discord.outsider)(recapGet(A, gameIds.published));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: NOT_IN_THIS_GROUP });
    });

    it('403 for a session that matches no player', async () => {
      const response = await route(discord.nobody)(recapGet(A, gameIds.published));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: READ_NOT_LINKED });
    });

    it('400 for a gameId that is not a uuid', async () => {
      const response = await route(discord.member)(recapGet(A, 'not-a-game'));
      expect(response.status).toBe(400);
    });

    it('401 signed out, through the real export', async () => {
      const response = await recapStatusExport(recapGet(A, gameIds.published));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: READ_SIGN_IN_REQUIRED });
    });
  });
}
