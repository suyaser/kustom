import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '@customs/db';
import { groupLiveFilter } from '@customs/db/schemas';
import {
  createClient,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminAuthResult } from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import { eogBody, lobbyBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { localPsql, publishedTables } from '@/lib/testing/localDb';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M19.11 (`0044_publication_live_only.sql`): the player and lobby tables are out of the anon
 * Realtime publication.
 *
 * - **(1)** `pg_publication_tables` for `supabase_realtime` is exactly `group_live`, `group_modes`
 *   and `fearless_state`.
 * - **(2)** an anon client subscribed, unfiltered, to each removed table receives nothing while a
 *   lobby post, a roll, a game start and an eog land through the real route handlers -- and a
 *   second anon client on the group's `group_live` row hears every one of them, so the silence is
 *   not a dead socket.
 * - **(4)** nothing in `apps/web` outside the tests subscribes to a removed table.
 * - **The column-list finding.** Realtime ignores a publication's column list (wal2json, see the
 *   migration's header), so `group_modes` and `fearless_state` are published whole and the admin
 *   ids stay out of anon payloads by column privilege (0029). An anon subscriber to both, filtered
 *   to the group, receives a mode change and a fearless reset with no `set_by`, `pending_set_by` or
 *   `reset_by` key.
 *
 * (3) is `lib/lobbyPassword.integration.test.ts`. Skipped without the stack; **fails** when the
 * stack is up and 0044 is not applied.
 */

const REMOVED = ['lobbies', 'lobby_members', 'splits', 'games', 'game_players', 'ratings'] as const;
/** M22.4 (0051) adds lobby_modes: name-free like group_modes, its admin ids kept out by column privilege. */
const PUBLISHED = ['public.fearless_state', 'public.group_live', 'public.group_modes', 'public.lobby_modes'];

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every `.ts`/`.tsx` under `apps/web` that ships or runs (no tests, no build output, no deps). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

describe('apps/web subscribes to no removed table (M19.11 acceptance 4)', () => {
  it('no source file that subscribes to postgres_changes names a removed table', () => {
    const files = sourceFiles(WEB_ROOT);
    expect(files.length).toBeGreaterThan(50);
    const subscribers = files.filter((path) => readFileSync(path, 'utf8').includes('postgres_changes'));
    // TonightLive is the one subscriber in the app; if it ever moves, this list says where.
    expect(subscribers.map((path) => path.slice(WEB_ROOT.length))).toContain('app/_tonight/TonightLive.tsx');
    const named = new RegExp(`['"\`](${REMOVED.join('|')})['"\`]`, 'g');
    const offenders = subscribers.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(named)].map(
        (match) => `${path.slice(WEB_ROOT.length)}: ${match[0]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

const stack = await resolveLocalStack();
const psql = stack === null ? null : localPsql();

if (stack === null || psql === null) {
  describe.skip('the Realtime publication against the local Supabase stack (M19.11)', () => {
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

  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { rollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/roll/handler');
  const { setGroupModeRoute } = await import('@/app/api/admin/mode/handler');
  const { fearlessResetRoute } = await import('@/app/api/admin/fearless/reset/handler');
  const { lobbyRosterKey } = await import('@/lib/ingest/lobby');
  const { ensurePlayers } = await import('@/lib/ingest/players');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Two anon clients, so a refused subscription on one can never take the other's socket down.
  const anonRemoved = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });
  const anonLive = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `pub-${runId}-p${index}`);
  const ids = new Map<string, string>();
  const id = (puuid: string): string => {
    const value = ids.get(puuid);
    if (value === undefined) throw new Error(`no player for ${puuid}`);
    return value;
  };
  let A = '';
  let token = '';
  const partyId = `pub-${runId}-party`;
  const gameId = testGameId();

  function companion(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }
  function json(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  function asAdmin(puuid: string) {
    return {
      authorize: async (_r: Request, _c: unknown, groupId: string | null): Promise<AdminAuthResult> => ({
        ok: true,
        admin: {
          userId: randomUUID(),
          discordId: `9${runId}`,
          playerId: id(puuid),
          groupId: groupId ?? A,
          puuid,
          displayName: null,
          email: null,
          discordName: null,
        },
      }),
    };
  }

  type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;
  const removedEvents: Payload[] = [];
  const removedSystem: { table: string; status: string | undefined; message: string | undefined }[] = [];
  const liveEvents: Payload[] = [];
  const modeEvents: Payload[] = [];
  let wake: () => void = () => {};
  function until(label: string, done: () => boolean, timeoutMs = 45_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wake = () => {};
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      const check = () => {
        if (!done()) return;
        clearTimeout(timer);
        wake = () => {};
        resolve();
      };
      wake = check;
      check();
    });
  }
  const kindOf = (event: Payload) => (event.new as { kind?: string }).kind;

  /** The group's live row (and its Mode card tables), proven live with `roster` nudges. */
  async function openLive(): Promise<void> {
    const sawNudge = () => liveEvents.some((event) => kindOf(event) === 'roster');
    const nudger = setInterval(() => {
      void db.rpc('bump_group_live', { p_group: A, p_kind: 'roster' }).then(() => undefined);
    }, 1_000);
    try {
      for (let attempt = 1; !sawNudge(); attempt += 1) {
        const channel = anonLive.channel(`it-pub-live-${runId}-${attempt}`);
        let ok = false;
        channel.on('system', {}, (message: { extension?: string; status?: string }) => {
          if (message.extension === 'postgres_changes' && message.status === 'ok') {
            ok = true;
            wake();
          }
        });
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_live', filter: groupLiveFilter(A) },
          (event) => {
            liveEvents.push(event);
            wake();
          },
        );
        for (const table of ['group_modes', 'fearless_state'] as const) {
          channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table, filter: groupLiveFilter(A) },
            (event) => {
              modeEvents.push(event);
              wake();
            },
          );
        }
        const subscribed = until('the live subscription', () => ok, 30_000);
        channel.subscribe();
        await subscribed;
        const last = attempt === 4;
        const heard = await until('a warm-up bump', sawNudge, last ? 30_000 : 15_000).then(
          () => true,
          (error: unknown) => {
            if (last) throw error;
            return false;
          },
        );
        if (!heard) await anonLive.removeChannel(channel);
      }
    } finally {
      clearInterval(nudger);
    }
  }

  /**
   * One channel per removed table, unfiltered. Realtime answers each with a `system` message for
   * the `postgres_changes` extension: `ok` (registered) or `error` (it refuses a table outside the
   * publication, which is what v2.73 does). Either way it must deliver nothing.
   */
  async function openRemoved(): Promise<RealtimeChannel[]> {
    const channels: RealtimeChannel[] = [];
    for (const table of REMOVED) {
      const channel = anonRemoved.channel(`it-pub-removed-${runId}-${table}`);
      let answered = false;
      channel.on('system', {}, (message: { extension?: string; status?: string; message?: string }) => {
        if (message.extension !== 'postgres_changes') return;
        removedSystem.push({ table, status: message.status, message: message.message });
        answered = true;
        wake();
      });
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (event) => {
        removedEvents.push(event);
        wake();
      });
      const done = until(`an answer for ${table}`, () => answered, 30_000).catch(() => undefined);
      channel.subscribe();
      await done;
      channels.push(channel);
    }
    return channels;
  }

  /** A sentinel bump of A, waited for: every change committed before it has been decoded. */
  async function drain(): Promise<void> {
    const before = liveEvents.length;
    const { error } = await db.rpc('bump_group_live', { p_group: A, p_kind: 'roster' });
    expect(error).toBeNull();
    await until('the sentinel', () => liveEvents.slice(before).some((event) => kindOf(event) === 'roster'));
  }

  beforeAll(async () => {
    const groups = await createTestGroups(db, runId, ['a']);
    A = groups.a;
    const players = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, playerId] of players) ids.set(puuid, playerId);
    for (const puuid of ten) await setTestMembership(db, A, id(puuid), 'member');
    await setTestMembership(db, A, id(ten[0] as string), 'owner');
    const minted = mintCompanionToken();
    token = minted.token;
    const inserted = await db.from('companion_tokens').insert({
      group_id: A,
      player_id: id(ten[0] as string),
      token_hash: minted.tokenHash,
      label: 'publication test',
      last_seen_at: new Date().toISOString(),
    });
    expect(inserted.error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    await anonRemoved.removeAllChannels();
    await anonLive.removeAllChannels();
    await deleteTestGroups(db, [A]);
    await db.from('players').delete().in('puuid', ten);
  });

  describe('the Realtime publication against the local Supabase stack (M19.11)', () => {
    it('is exactly group_live, group_modes, lobby_modes (0051) and fearless_state (acceptance 1)', () => {
      expect(publishedTables(psql)).toEqual(PUBLISHED);
    });

    it('an unfiltered anon subscriber to each removed table hears nothing of a lobby post, a roll, a game start and an eog (acceptance 2)', async () => {
      await openLive();
      await openRemoved();
      const liveBefore = liveEvents.length;

      const lobby = await postLobby(
        companion(
          'lobby',
          lobbyBody({
            partyId,
            members: ten.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200 })),
          }),
        ),
      );
      expect(lobby.status).toBe(200);
      const { lobbyId } = (await lobby.json()) as { lobbyId: string };

      const roll = await rollRoute(
        lobbyId,
        asAdmin(ten[0] as string),
      )(json(`admin/lobbies/${lobbyId}/roll`, { groupId: A, rosterKey: lobbyRosterKey(ten) }));
      expect(roll.status).toBe(200);

      const started = await postGame(companion('game', { phase: 'in_progress', gameId, partyId }));
      expect(started.status).toBe(200);

      const eog = await postGame(
        companion(
          'game',
          eogBody({
            gameId,
            puuids: ten,
            partyId,
            startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
          }),
        ),
      );
      expect(eog.status).toBe(200);
      expect(await eog.json()).toMatchObject({ created: true, rated: true });

      // Every write above landed in all six tables (the database says so), and the live row heard
      // each step: the stream was up the whole time.
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', gameId).single();
      expect(game).not.toBeNull();
      await drain();
      expect(liveEvents.slice(liveBefore).map(kindOf)).toEqual(
        expect.arrayContaining(['lobby', 'split', 'game']),
      );
      // A second sentinel: Realtime polls the WAL in batches, give a late batch one more round.
      await drain();

      expect(removedEvents.map((event) => `${event.table} ${event.eventType}`)).toEqual([]);
      // Realtime v2.73 refuses the subscription outright ("Unable to subscribe to changes with
      // given parameters ... [schema: public, table: lobbies, filters: []]"). Asserted so a Realtime
      // that starts accepting one is looked at, though it would still have to deliver nothing.
      expect(removedSystem.map((answer) => `${answer.table} ${answer.status}`).sort()).toEqual(
        REMOVED.map((table) => `${table} error`).sort(),
      );
    }, 300_000);

    it('group_modes and fearless_state still fire for anon, with no admin id in the payload', async () => {
      const before = modeEvents.length;
      // Whichever mode the group is not on, so the route really writes.
      const { data: current } = await db.from('group_modes').select('mode').eq('group_id', A).single();
      const next = current?.mode === 'fearless' ? 'normal' : 'fearless';
      const mode = await setGroupModeRoute(asAdmin(ten[0] as string))(
        json('admin/mode', { groupId: A, mode: next }),
      );
      expect(mode.status).toBe(200);
      const reset = await fearlessResetRoute(asAdmin(ten[0] as string))(
        json('admin/fearless/reset', { groupId: A }),
      );
      expect(reset.status).toBe(200);

      const tables = () => new Set(modeEvents.slice(before).map((event) => event.table));
      expect(await mode.json()).toMatchObject({ changed: true });
      await until('a group_modes and a fearless_state event', () => tables().size === 2);
      // The server wrote the ids (the service role sees them) ...
      const { data: written } = await db.from('group_modes').select('set_by').eq('group_id', A).single();
      expect(written?.set_by).toBe(id(ten[0] as string));
      // ... and no anon payload carries one.
      for (const event of modeEvents.slice(before)) {
        expect(event.new).not.toHaveProperty('set_by');
        expect(event.new).not.toHaveProperty('pending_set_by');
        expect(event.new).not.toHaveProperty('reset_by');
      }
    }, 120_000);
  });
}
