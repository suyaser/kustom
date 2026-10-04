import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from './localStack';
import { groupLiveFilter, groupLiveRowSchema } from './schemas/live';
import type { Database } from './types';

/**
 * M19.9 acceptance 1: what `0037_group_live.sql` lets anybody do with the live signal, against the
 * local stack, through PostgREST and Realtime with the public anon key and a **real** member JWT
 * (HS256, signed with the stack's own secret, as in `rls.reads.integration.test.ts`).
 *
 * - an anon client and a signed-in member of group A read every group's `group_live` row, and see
 *   exactly the four columns;
 * - neither can insert, update or delete a row, nor call `bump_group_live`; the service role can;
 * - a Realtime subscriber filtered to A hears nothing of a bump in B; an unfiltered one hears B's
 *   row with only the four public columns.
 *
 * Two scratch groups, one auth user and one player, all removed afterwards. Skipped without the
 * stack; **fails** when the stack is up and 0037 is not applied.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function findDbContainer(): string | null {
  try {
    const config = readFileSync(`${PACKAGE_ROOT}supabase/config.toml`, 'utf8');
    const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
    if (!projectId) return null;
    const name = `supabase_db_${projectId}`;
    const running = execFileSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return running.split('\n').includes(name) ? name : null;
  } catch {
    return null;
  }
}

const stack = await resolveLocalStack();
const container = stack === null ? null : findDbContainer();

function signJwt(secret: string, payload: Record<string, unknown>): string {
  const b64 = (value: string) => Buffer.from(value).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const COLUMNS = ['changed_at', 'group_id', 'kind', 'version'];

if (stack === null || container === null) {
  describe.skip('group_live against the local Supabase stack (M19.9)', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const { url, anonKey, serviceRoleKey } = stack;

  function psql(sql: string): string {
    return execFileSync(
      'docker',
      ['exec', '-i', container as string, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'],
      { input: sql, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  }

  const run = randomUUID().replaceAll('-', '').slice(0, 8);
  const groupA = randomUUID();
  const groupB = randomUUID();
  const authId = randomUUID();
  const playerId = randomUUID();
  const snowflake = `9${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const service = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false } });
  const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });

  function memberToken(): string {
    if (!stack?.jwtSecret)
      throw new Error('no JWT secret: set SUPABASE_LOCAL_JWT_SECRET beside the other three');
    const now = Math.floor(Date.now() / 1000);
    return signJwt(stack.jwtSecret, {
      iss: 'supabase-demo',
      sub: authId,
      aud: 'authenticated',
      role: 'authenticated',
      iat: now,
      exp: now + 600,
    });
  }

  type Caller = 'anon' | 'member';
  async function rest(caller: Caller, path: string, init: RequestInit = {}) {
    const bearer = caller === 'anon' ? anonKey : memberToken();
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, ok: response.ok, body };
  }

  const versions = () =>
    psql(
      `select string_agg(version::text || ':' || kind, ',' order by group_id = '${groupA}' desc) from public.group_live where group_id in ('${groupA}', '${groupB}')`,
    );

  beforeAll(() => {
    if (psql(`select to_regclass('public.group_live') is not null`) !== 't') {
      throw new Error(
        '0037_group_live.sql is not applied to the local stack: run `supabase migration up --local`',
      );
    }
    psql(`
      begin;
      insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
        ('${authId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'live-${run}@example.test', now(), now(), now());
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
        ('${snowflake}', '${authId}', jsonb_build_object('sub', '${snowflake}', 'provider_id', '${snowflake}'), 'discord', now(), now(), now());
      insert into public.groups (id, slug, name) values
        ('${groupA}', 'live-a-${run}', 'Live A ${run}'),
        ('${groupB}', 'live-b-${run}', 'Live B ${run}');
      insert into public.players (id, puuid, discord_id) values ('${playerId}', 'live-${run}', '${snowflake}');
      insert into public.group_memberships (group_id, player_id, role) values ('${groupA}', '${playerId}', 'member');
      commit;
    `);
  });

  afterAll(async () => {
    await anon.removeAllChannels();
    psql(`
      begin;
      delete from public.group_memberships where group_id in ('${groupA}', '${groupB}');
      delete from public.groups where id in ('${groupA}', '${groupB}');
      delete from public.players where id = '${playerId}';
      delete from auth.users where id = '${authId}';
      commit;
    `);
  });

  describe('group_live against the local Supabase stack (M19.9)', () => {
    it('gives every new group its row at version 0 (groups_insert_live)', () => {
      expect(versions()).toBe('0:roster,0:roster');
    });

    it.each<Caller>(['anon', 'member'])(
      'lets %s read every group’s row, exactly the four columns',
      async (caller) => {
        const read = await rest(caller, `group_live?group_id=in.(${groupA},${groupB})&order=group_id`);
        expect(read.status).toBe(200);
        const rows = read.body as Record<string, unknown>[];
        expect(rows.map((row) => row.group_id).sort()).toEqual([groupA, groupB].sort());
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual(COLUMNS);
          expect(groupLiveRowSchema.parse(row)).toMatchObject({ version: 0, kind: 'roster' });
        }
      },
    );

    it.each<Caller>(['anon', 'member'])(
      'refuses %s every write: insert, update, delete and bump_group_live',
      async (caller) => {
        const insert = await rest(caller, 'group_live', {
          method: 'POST',
          body: JSON.stringify({ group_id: randomUUID(), version: 5, kind: 'game' }),
        });
        expect(insert.ok).toBe(false);

        const update = await rest(caller, `group_live?group_id=eq.${groupA}`, {
          method: 'PATCH',
          body: JSON.stringify({ version: 99, kind: 'game' }),
        });
        // Refused outright (no grant), never a silent success.
        expect(update.ok).toBe(false);

        const remove = await rest(caller, `group_live?group_id=eq.${groupB}`, { method: 'DELETE' });
        expect(remove.ok).toBe(false);

        const bump = await rest(caller, 'rpc/bump_group_live', {
          method: 'POST',
          body: JSON.stringify({ p_group: groupA, p_kind: 'game' }),
        });
        expect(bump.ok).toBe(false);

        expect(versions()).toBe('0:roster,0:roster');
      },
    );

    it('lets the service role bump, and refuses a kind outside the list and a group that does not exist', async () => {
      const first = await service.rpc('bump_group_live', { p_group: groupA, p_kind: 'lobby' });
      expect(first.error).toBeNull();
      expect(first.data).toBe(1);
      const second = await service.rpc('bump_group_live', { p_group: groupA, p_kind: 'split' });
      expect(second.data).toBe(2);
      expect(versions()).toBe('2:split,0:roster');

      const badKind = await service.rpc('bump_group_live', { p_group: groupA, p_kind: 'players' });
      expect(badKind.error?.code).toBe('23514');
      const noGroup = await service.rpc('bump_group_live', { p_group: randomUUID(), p_kind: 'lobby' });
      expect(noGroup.error?.code).toBe('23503');
      expect(versions()).toBe('2:split,0:roster');
    });

    /*
     * Event-driven, like `lobbyPassword.integration.test.ts`: "subscribed" does not yet mean
     * "streaming", so each channel is warmed with nudges on A until it hears one, and only then is
     * B bumped. Realtime delivers in WAL order, so once the filtered channel has heard a sentinel
     * bump of A written **after** B's, a B event it never got is one it will never get.
     */
    it('sends a filtered subscriber nothing of another group, and an unfiltered one only the four columns', async () => {
      type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;
      const filtered: Payload[] = [];
      const unfiltered: Payload[] = [];
      let wake: () => void = () => {};
      const until = (label: string, done: () => boolean, timeoutMs: number) =>
        new Promise<void>((resolve, reject) => {
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
      const groupOf = (payload: Payload) => (payload.new as { group_id?: string } | undefined)?.group_id;

      const subscribe = async (attempt: number, filter: string | null, into: Payload[]) => {
        const channel = anon.channel(`it-live-${run}-${filter === null ? 'all' : 'a'}-${attempt}`);
        let ok = false;
        channel.on('system', {}, (message: { extension?: string; status?: string }) => {
          if (message.extension === 'postgres_changes' && message.status === 'ok') {
            ok = true;
            wake();
          }
        });
        channel.on(
          'postgres_changes',
          filter === null
            ? { event: '*', schema: 'public', table: 'group_live' }
            : { event: '*', schema: 'public', table: 'group_live', filter },
          (payload) => {
            into.push(payload);
            wake();
          },
        );
        const subscribed = until('the subscription', () => ok, 30_000);
        channel.subscribe();
        await subscribed;
        return channel;
      };

      const heardA = (events: Payload[]) => () => events.some((event) => groupOf(event) === groupA);
      const warm = async (filter: string | null, into: Payload[]) => {
        let nudges = 0;
        const nudger = setInterval(() => {
          nudges += 1;
          void service.rpc('bump_group_live', { p_group: groupA, p_kind: 'lobby' }).then(() => undefined);
        }, 1_000);
        try {
          for (let attempt = 1; !heardA(into)(); attempt += 1) {
            const channel = await subscribe(attempt, filter, into);
            const last = attempt === 4;
            const heard = await until('a warm-up bump of A', heardA(into), last ? 30_000 : 15_000).then(
              () => true,
              (error: unknown) => {
                if (last) throw error;
                return false;
              },
            );
            if (!heard) await anon.removeChannel(channel);
          }
        } finally {
          clearInterval(nudger);
        }
        return nudges;
      };

      await warm(groupLiveFilter(groupA), filtered);
      await warm(null, unfiltered);

      const bVersion = await service.rpc('bump_group_live', { p_group: groupB, p_kind: 'game' });
      expect(bVersion.error).toBeNull();
      await until('B on the unfiltered channel', () => unfiltered.some((e) => groupOf(e) === groupB), 45_000);

      const sentinel = await service.rpc('bump_group_live', { p_group: groupA, p_kind: 'mode' });
      expect(sentinel.error).toBeNull();
      await until(
        'the sentinel on the filtered channel',
        () => filtered.some((e) => groupOf(e) === groupA && (e.new as { kind?: string }).kind === 'mode'),
        45_000,
      );

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.filter((event) => groupOf(event) !== groupA)).toEqual([]);

      const fromB = unfiltered.filter((event) => groupOf(event) === groupB);
      expect(fromB).toHaveLength(1);
      // The shared stack is busy (other files make and drop groups, so the unfiltered channel also
      // sees their rows come and go): an INSERT or UPDATE carries exactly the four columns, and a
      // DELETE (a group dropped, cascading) carries the key and nothing more.
      for (const event of [...filtered, ...unfiltered]) {
        if (event.eventType === 'DELETE') {
          expect(Object.keys(event.old).every((column) => COLUMNS.includes(column))).toBe(true);
          continue;
        }
        expect(Object.keys(event.new).sort()).toEqual(COLUMNS);
        groupLiveRowSchema.parse(event.new);
      }
      expect(groupLiveRowSchema.parse(fromB[0]?.new)).toMatchObject({
        group_id: groupB,
        kind: 'game',
        version: 1,
      });
    }, 300_000);
  });
}
