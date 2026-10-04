import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from './localStack';

/**
 * What `0022_rls_read_policies.sql` lets a signed-in session read (M14.5), exercised through
 * PostgREST with **real JWTs**: HS256 tokens signed with the local stack's own JWT secret, carrying
 * `role: authenticated` and an `auth.users` id as `sub`, exactly the shape GoTrue issues. PostgREST
 * verifies them and Postgres sees `auth.uid()`; nothing is injected with `set role`.
 *
 * The cast, in two scratch groups A and B (every row this file writes is its own and is removed
 * afterwards; the stack's existing data is never read or touched):
 *
 *   memberA   member of A            reads its own A row, no other row, no invite
 *   memberA2  member of A            the "another member" memberA must not see
 *   adminA    admin of A             reads A's members (with roles) and A's invite, nothing of B
 *   adminB    admin of B             the mirror image
 *   unpaired  a Discord session with no players row: reads nothing
 *
 * Setup runs through `psql` in the stack's database container because it needs `auth.users` and
 * `auth.identities` rows (the identity is what `current_player_id()` follows), which PostgREST
 * does not expose and GoTrue's admin API refuses on this CLI (see apps/web/lib/testing/authUsers.ts).
 *
 * Skipped, not failed, when the stack or its container is not there. **Fails** when the stack is
 * up but 0022 has not been applied to it, so a pending migration cannot pass as a green run.
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

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** An HS256 JWT, the way GoTrue signs a session's access token on the local stack. */
function signJwt(secret: string, payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

interface RestResult {
  status: number;
  ok: boolean;
  body: unknown;
}

function rows(body: unknown): Record<string, unknown>[] {
  return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
}

if (stack === null || container === null) {
  describe.skip('0022 read policies against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const { url, anonKey } = stack;
  const jwtSecret = stack.jwtSecret;

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
  const inviteA = randomBytes(16).toString('base64url');
  const inviteB = randomBytes(16).toString('base64url');

  type Person = 'memberA' | 'memberA2' | 'adminA' | 'adminB' | 'unpaired';
  const people: Person[] = ['memberA', 'memberA2', 'adminA', 'adminB', 'unpaired'];
  const authId = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>;
  const playerId = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>;
  // Snowflake-shaped and unique to this run, so no existing players row can match one.
  const snowflake = Object.fromEntries(
    people.map((p, i) => [p, `9${Date.now()}${i}${Math.floor(Math.random() * 1e6)}`]),
  ) as Record<Person, string>;

  function sessionToken(person: Person): string {
    if (!jwtSecret) throw new Error('no JWT secret: set SUPABASE_LOCAL_JWT_SECRET beside the other three');
    const now = Math.floor(Date.now() / 1000);
    return signJwt(jwtSecret, {
      iss: 'supabase-demo',
      sub: authId[person],
      aud: 'authenticated',
      role: 'authenticated',
      iat: now,
      exp: now + 600,
    });
  }

  type Caller = Person | 'anon' | { forged: Person };

  async function rest(caller: Caller, path: string, init: RequestInit = {}): Promise<RestResult> {
    let bearer: string;
    if (caller === 'anon') bearer = anonKey;
    else if (typeof caller === 'object') {
      // Signed with the wrong secret: the token, not the claim inside it, decides who you are.
      const now = Math.floor(Date.now() / 1000);
      bearer = signJwt('not-the-stack-secret-not-the-stack-secret', {
        sub: authId[caller.forged],
        aud: 'authenticated',
        role: 'authenticated',
        iat: now,
        exp: now + 600,
      });
    } else bearer = sessionToken(caller);

    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
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

  const scratchGroups = `'${groupA}', '${groupB}'`;

  beforeAll(() => {
    const applied = psql(
      `select to_regprocedure('public.current_player_id()') is not null
          and to_regprocedure('public.is_group_admin(uuid)') is not null`,
    );
    if (applied !== 't') {
      throw new Error(
        '0022_rls_read_policies.sql is not applied to the local stack: run `supabase migration up` in packages/db',
      );
    }
    if (!jwtSecret) {
      throw new Error(
        'the local stack gave no JWT_SECRET; set SUPABASE_LOCAL_JWT_SECRET beside the other three',
      );
    }

    const userRows = people
      .map(
        (p) =>
          `('${authId[p]}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-${run}-${p}@example.test', now(), now(), now())`,
      )
      .join(',\n');
    const identityRows = people
      .map(
        (p) =>
          `('${snowflake[p]}', '${authId[p]}', jsonb_build_object('sub', '${snowflake[p]}', 'provider_id', '${snowflake[p]}'), 'discord', now(), now(), now())`,
      )
      .join(',\n');
    // `unpaired` signed in with Discord but has no players row.
    const paired = people.filter((p) => p !== 'unpaired');
    const playerRows = paired
      .map((p) => `('${playerId[p]}', 'rls-${run}-${p}', '${snowflake[p]}')`)
      .join(',\n');

    psql(`
      begin;
      insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
      ${userRows};
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
      ${identityRows};
      insert into public.groups (id, slug, name) values
        ('${groupA}', 'rls-a-${run}', 'RLS A ${run}'),
        ('${groupB}', 'rls-b-${run}', 'RLS B ${run}');
      insert into public.group_invites (group_id, code) values
        ('${groupA}', '${inviteA}'),
        ('${groupB}', '${inviteB}');
      insert into public.players (id, puuid, discord_id) values
      ${playerRows};
      insert into public.group_memberships (group_id, player_id, role) values
        ('${groupA}', '${playerId.memberA}',  'member'),
        ('${groupA}', '${playerId.memberA2}', 'member'),
        ('${groupA}', '${playerId.adminA}',   'admin'),
        ('${groupB}', '${playerId.adminB}',   'admin');
      commit;
    `);
  });

  afterAll(() => {
    // Memberships first: group_memberships.group_id does not cascade from groups.
    psql(`
      begin;
      delete from public.group_memberships where group_id in (${scratchGroups});
      delete from public.groups where id in (${scratchGroups});
      delete from public.players where puuid like 'rls-${run}-%';
      delete from auth.users where id in (${people.map((p) => `'${authId[p]}'`).join(', ')});
      commit;
    `);
  });

  describe('0022 read policies against the local Supabase stack', () => {
    describe('group_memberships', () => {
      it('lets a member read their own membership and nobody else’s', async () => {
        const all = await rest('memberA', 'group_memberships?select=group_id,player_id,role');
        expect(all.status).toBe(200);
        expect(rows(all.body)).toEqual([{ group_id: groupA, player_id: playerId.memberA, role: 'member' }]);

        const other = await rest('memberA', `group_memberships?player_id=eq.${playerId.memberA2}`);
        expect(other.status).toBe(200);
        expect(rows(other.body)).toEqual([]);

        const admin = await rest('memberA', `group_memberships?player_id=eq.${playerId.adminA}`);
        expect(rows(admin.body)).toEqual([]);
      });

      it('lets an admin of A read every member of A with roles, and nothing of B', async () => {
        const inA = await rest(
          'adminA',
          `group_memberships?select=player_id,role&group_id=eq.${groupA}&order=player_id`,
        );
        expect(inA.status).toBe(200);
        const expected = [
          { player_id: playerId.memberA, role: 'member' },
          { player_id: playerId.memberA2, role: 'member' },
          { player_id: playerId.adminA, role: 'admin' },
        ].sort((a, b) => (a.player_id < b.player_id ? -1 : 1));
        expect(rows(inA.body)).toEqual(expected);

        const inB = await rest('adminA', `group_memberships?group_id=eq.${groupB}`);
        expect(inB.status).toBe(200);
        expect(rows(inB.body)).toEqual([]);

        // Unfiltered, the admin sees exactly A's three rows (their own included) and no other group's.
        const all = await rest('adminA', 'group_memberships?select=group_id');
        expect(rows(all.body).map((r) => r.group_id)).toEqual([groupA, groupA, groupA]);
      });

      it('gives the admin of B the mirror image', async () => {
        const inB = await rest('adminB', `group_memberships?select=player_id&group_id=eq.${groupB}`);
        expect(rows(inB.body)).toEqual([{ player_id: playerId.adminB }]);
        const inA = await rest('adminB', `group_memberships?group_id=eq.${groupA}`);
        expect(rows(inA.body)).toEqual([]);
      });

      it('shows a signed-in session with no paired player nothing', async () => {
        const result = await rest('unpaired', 'group_memberships');
        expect(result.status).toBe(200);
        expect(rows(result.body)).toEqual([]);
      });

      it('refuses anon outright', async () => {
        const result = await rest('anon', `group_memberships?group_id=eq.${groupA}`);
        expect(result.ok).toBe(false);
        expect(rows(result.body)).toEqual([]);
      });
    });

    describe('group_invites', () => {
      it('lets an admin of A read A’s invite and not B’s', async () => {
        const result = await rest(
          'adminA',
          `group_invites?select=group_id,code&group_id=in.(${groupA},${groupB})`,
        );
        expect(result.status).toBe(200);
        expect(rows(result.body)).toEqual([{ group_id: groupA, code: inviteA }]);
      });

      it('gives the admin of B only B’s', async () => {
        const result = await rest('adminB', `group_invites?select=code&group_id=in.(${groupA},${groupB})`);
        expect(rows(result.body)).toEqual([{ code: inviteB }]);
      });

      it('shows a member of A no invite, not even their own group’s', async () => {
        const result = await rest('memberA', 'group_invites');
        expect(result.status).toBe(200);
        expect(rows(result.body)).toEqual([]);
      });

      it('shows an unpaired session no invite', async () => {
        const result = await rest('unpaired', 'group_invites');
        expect(rows(result.body)).toEqual([]);
      });

      it('refuses anon outright', async () => {
        const result = await rest('anon', `group_invites?group_id=eq.${groupA}`);
        expect(result.ok).toBe(false);
        expect(rows(result.body)).toEqual([]);
      });
    });

    describe('what did not open', () => {
      it('refuses a token signed with the wrong secret, whatever its sub claims', async () => {
        const result = await rest({ forged: 'adminA' }, `group_invites?group_id=eq.${groupA}`);
        expect(result.status).toBe(401);
        expect(rows(result.body)).toEqual([]);
      });

      it('grants no write to authenticated, admin or not', async () => {
        const promote = await rest('memberA', `group_memberships?player_id=eq.${playerId.memberA}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: 'admin' }),
        });
        expect(promote.ok).toBe(false);

        const join = await rest('adminA', 'group_memberships', {
          method: 'POST',
          body: JSON.stringify({ group_id: groupB, player_id: playerId.adminA, role: 'admin' }),
        });
        expect(join.ok).toBe(false);

        const rotate = await rest('adminA', `group_invites?group_id=eq.${groupA}`, {
          method: 'PATCH',
          body: JSON.stringify({ code: randomBytes(16).toString('base64url') }),
        });
        expect(rotate.ok).toBe(false);

        const remove = await rest('adminA', `group_invites?group_id=eq.${groupA}`, { method: 'DELETE' });
        expect(remove.ok).toBe(false);

        expect(
          psql(`
            select string_agg(m.role, ',' order by m.player_id)
            from public.group_memberships m where m.group_id in (${scratchGroups})`),
        ).toBe(
          [
            [playerId.memberA, 'member'],
            [playerId.memberA2, 'member'],
            [playerId.adminA, 'admin'],
            [playerId.adminB, 'admin'],
          ]
            .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1))
            .map((pair) => pair[1])
            .join(','),
        );
        expect(psql(`select code from public.group_invites where group_id = '${groupA}'`)).toBe(inviteA);
      });

      it('leaves anon unable to call either helper', async () => {
        const who = await rest('anon', 'rpc/current_player_id', { method: 'POST', body: '{}' });
        expect(who.ok).toBe(false);
        const admin = await rest('anon', 'rpc/is_group_admin', {
          method: 'POST',
          body: JSON.stringify({ p_group_id: groupA }),
        });
        expect(admin.ok).toBe(false);
      });

      it('lets a session ask the helpers only about itself', async () => {
        const who = await rest('memberA', 'rpc/current_player_id', { method: 'POST', body: '{}' });
        expect(who.body).toBe(playerId.memberA);
        const nobody = await rest('unpaired', 'rpc/current_player_id', { method: 'POST', body: '{}' });
        expect(nobody.body).toBeNull();

        const ask = (person: Person, group: string) =>
          rest(person, 'rpc/is_group_admin', { method: 'POST', body: JSON.stringify({ p_group_id: group }) });
        expect((await ask('adminA', groupA)).body).toBe(true);
        expect((await ask('adminA', groupB)).body).toBe(false);
        expect((await ask('memberA', groupA)).body).toBe(false);
        expect((await ask('unpaired', groupA)).body).toBe(false);
      });

      it('leaves the public views exactly as public as they were', async () => {
        const members = await rest('anon', `group_members_public?select=player_id&group_id=eq.${groupA}`);
        expect(members.status).toBe(200);
        expect(rows(members.body)).toHaveLength(3);
        const group = await rest('anon', `groups_public?select=slug&id=eq.${groupA}`);
        expect(rows(group.body)).toEqual([{ slug: `rls-a-${run}` }]);
        // groups and players stay closed to a session too: 0022 opened two tables, no more.
        expect((await rest('adminA', 'groups')).ok).toBe(false);
        expect((await rest('adminA', 'players')).ok).toBe(false);
      });
    });
  });
}
