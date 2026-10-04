import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from './localStack';
import { ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * M16.2, `0031_premium_flag.sql`: the Premium flag, its stamp and the monthly cap; no client role
 * can write (or read) them.
 *
 * 1. **A scratch database** inside the stack's container (like `newGroupsStartNormal`): replay every
 *    migration before 0031, give it existing groups, apply 0031, and check every existing group
 *    reads off with a $2.00 cap, the trigger stamps `premium_changed_at` only when the flag flips,
 *    the cap's range holds, `groups_public` does not carry the columns, and `anon` and
 *    `authenticated` are refused an update. Runs whether or not the stack has applied 0031; the
 *    scratch database is dropped afterwards.
 * 2. **The stack itself, through PostgREST**, skipped until 0031 is in
 *    `supabase_migrations.schema_migrations`: the anon key and a real signed `authenticated` JWT
 *    both fail to update or read the flag on a scratch group, which still reads off afterwards and
 *    is deleted.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const MIGRATION = '0031_premium_flag.sql';
const VERSION = '0031';

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

const container = findDbContainer();

function psql(database: string, sql: string, singleTransaction = false): string {
  const args = ['exec', '-i', container as string, 'psql', '-U', 'postgres', '-d', database];
  args.push('-v', 'ON_ERROR_STOP=1', '-At', '-q');
  if (singleTransaction) args.push('--single-transaction');
  return execFileSync('docker', args, {
    input: sql,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** The error text of a statement that must fail. */
function psqlError(database: string, sql: string): string {
  try {
    psql(database, sql);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error(`expected a failure from: ${sql}`);
}

function migration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8');
}

if (container === null) {
  describe.skip('0031: the Premium flag', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('0031 against a scratch database', () => {
    const scratch = `m16_2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ids = {
      other: 'e0000000-0000-0000-0000-000000000002',
      born: 'e0000000-0000-0000-0000-000000000003',
    };
    const row = (id: string) =>
      psql(
        scratch,
        `select premium || '|' || coalesce(premium_changed_at::text, '-') || '|' || ai_monthly_cap_usd
         from public.groups where id = '${id}'`,
      );
    const stamp = (id: string) =>
      psql(scratch, `select coalesce(premium_changed_at::text, '-') from public.groups where id = '${id}'`);

    beforeAll(() => {
      psql('postgres', `create database ${scratch}`);
      psql(
        scratch,
        `create schema if not exists auth;
         create table if not exists auth.users (id uuid primary key);
         create table if not exists auth.identities (user_id uuid, provider text, provider_id text);
         create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
         create publication supabase_realtime;
         grant usage on schema public to anon, authenticated, service_role;
         alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
         alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`,
      );
      const earlier = readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < MIGRATION)
        .sort();
      for (const name of earlier) psql(scratch, migration(name), true);
      psql(
        scratch,
        `insert into public.groups (id, slug, name) values ('${ids.other}', 'other-group', 'Other')`,
      );
      psql(scratch, migration(MIGRATION));
    }, 180_000);

    afterAll(() => {
      psql('postgres', `drop database if exists ${scratch} with (force)`);
    });

    it('reads every existing group off, never changed, with a $2.00 cap', () => {
      expect(row(ORIGINAL_GROUP_ID)).toBe('false|-|2.00');
      expect(row(ids.other)).toBe('false|-|2.00');
      expect(psql(scratch, 'select count(*) from public.groups where premium')).toBe('0');
    });

    it('stamps premium_changed_at when the flag flips, and only then', () => {
      psql(scratch, `update public.groups set premium = true where id = '${ids.other}'`);
      const first = stamp(ids.other);
      expect(first).not.toBe('-');

      // The same value again (the script run twice): the stamp stays.
      psql(scratch, `update public.groups set premium = true where id = '${ids.other}'`);
      expect(stamp(ids.other)).toBe(first);

      // A cap change alone does not move it, and a caller cannot write it.
      psql(
        scratch,
        `update public.groups set ai_monthly_cap_usd = 5, premium_changed_at = '2000-01-01' where id = '${ids.other}'`,
      );
      expect(stamp(ids.other)).toBe(first);
      expect(row(ids.other)).toBe(`true|${first}|5.00`);

      psql(scratch, `update public.groups set premium = false where id = '${ids.other}'`);
      const second = stamp(ids.other);
      expect(second).not.toBe(first);
      expect(row(ids.other)).toBe(`false|${second}|5.00`);
    });

    it('stamps a group born on, and leaves a group born off unstamped', () => {
      psql(
        scratch,
        `insert into public.groups (id, slug, name, premium, premium_changed_at)
         values ('${ids.born}', 'born-group', 'Born', true, '2000-01-01')`,
      );
      expect(stamp(ids.born)).not.toMatch(/^2000|^-$/);
      expect(
        psql(
          scratch,
          `insert into public.groups (slug, name, premium_changed_at) values ('born-off', 'Off', '2000-01-01')
           returning coalesce(premium_changed_at::text, '-')`,
        ),
      ).toBe('-');
    });

    it('keeps the cap between $0 and $100', () => {
      for (const cap of ['-0.01', '100.01']) {
        expect(
          psqlError(
            scratch,
            `update public.groups set ai_monthly_cap_usd = ${cap} where id = '${ids.other}'`,
          ),
        ).toMatch(/groups_ai_monthly_cap_usd_range/);
      }
      psql(scratch, `update public.groups set ai_monthly_cap_usd = 0 where id = '${ids.other}'`);
      psql(scratch, `update public.groups set ai_monthly_cap_usd = 100 where id = '${ids.other}'`);
    });

    it('refuses anon and authenticated an update or a read of groups', () => {
      for (const role of ['anon', 'authenticated']) {
        expect(
          psqlError(
            scratch,
            `begin; set local role ${role}; update public.groups set premium = true; rollback;`,
          ),
        ).toMatch(/permission denied for table groups/);
        expect(
          psqlError(scratch, `begin; set local role ${role}; select premium from public.groups; rollback;`),
        ).toMatch(/permission denied for table groups/);
      }
      expect(psql(scratch, `select count(*) from public.groups where premium and id <> '${ids.born}'`)).toBe(
        '0',
      );
    });

    it('does not put the columns in groups_public', () => {
      expect(
        psql(
          scratch,
          `select string_agg(column_name, ',' order by column_name) from information_schema.columns
           where table_schema = 'public' and table_name = 'groups_public'`,
        ),
      ).toBe('id,name,ratings_since,slug');
    });
  });

  const applied =
    psql(
      'postgres',
      `select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}'`,
    ) === '1';
  const stack = applied ? await resolveLocalStack() : null;

  describe.skipIf(!applied || stack === null)(
    '0031 on the local stack (skipped until 0031 is applied)',
    () => {
      const slug = `it-m16-2-${randomUUID().slice(0, 8)}`;
      let groupId = '';

      function bearerFor(caller: 'anon' | 'authenticated'): string {
        const { anonKey, jwtSecret } = stack as NonNullable<typeof stack>;
        if (caller === 'anon') return anonKey;
        if (!jwtSecret)
          throw new Error('no JWT secret: set SUPABASE_LOCAL_JWT_SECRET beside the other three');
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(
          JSON.stringify({
            iss: 'supabase-demo',
            sub: randomUUID(),
            aud: 'authenticated',
            role: 'authenticated',
            iat: now,
            exp: now + 600,
          }),
        ).toString('base64url');
        const signature = createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
        return `${header}.${body}.${signature}`;
      }

      async function rest(caller: 'anon' | 'authenticated', path: string, init: RequestInit = {}) {
        const { url, anonKey } = stack as NonNullable<typeof stack>;
        const response = await fetch(`${url}/rest/v1/${path}`, {
          ...init,
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${bearerFor(caller)}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
        });
        return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
      }

      beforeAll(() => {
        groupId = psql(
          'postgres',
          `insert into public.groups (slug, name) values ('${slug}', 'M16.2 scratch') returning id`,
        );
      });

      afterAll(() => {
        psql('postgres', `delete from public.groups where slug = '${slug}'`);
      });

      it.each(['anon', 'authenticated'] as const)(
        'refuses %s an update of premium or the cap',
        async (caller) => {
          for (const patch of [
            { premium: true },
            { ai_monthly_cap_usd: 50 },
            { premium_changed_at: '2000-01-01' },
          ]) {
            const result = await rest(caller, `groups?id=eq.${groupId}`, {
              method: 'PATCH',
              body: JSON.stringify(patch),
            });
            expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(400);
          }
          expect(
            psql(
              'postgres',
              `select premium || '|' || coalesce(premium_changed_at::text, '-') || '|' || ai_monthly_cap_usd
           from public.groups where id = '${groupId}'`,
            ),
          ).toBe('false|-|2.00');
        },
      );

      it.each(['anon', 'authenticated'] as const)('refuses %s a read of the flag', async (caller) => {
        expect((await rest(caller, `groups?select=premium&id=eq.${groupId}`)).status).toBeGreaterThanOrEqual(
          400,
        );
        expect(
          (await rest(caller, `groups_public?select=premium&id=eq.${groupId}`)).status,
        ).toBeGreaterThanOrEqual(400);
      });
    },
  );
}
