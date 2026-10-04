import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * M14.46, `0030_new_groups_start_normal.sql`: a new group starts on Normal; every group that
 * existed before keeps its mode.
 *
 * Two blocks, both through `psql` in the local stack's database container:
 *
 * 1. **A scratch database** (like `groups.keys.integration.test.ts`): replay every migration
 *    before 0030, give it existing groups (the original group on Fearless, one an admin switched
 *    to Normal, one left on Fearless), apply 0030, and check no existing row moved and a group
 *    created afterwards is on Normal. Runs whether or not the stack has applied 0030; the scratch
 *    database is dropped afterwards.
 * 2. **The stack's own database**, skipped until 0030 is in
 *    `supabase_migrations.schema_migrations`: a scratch group inserted inside a transaction gets
 *    `normal`, and the transaction rolls back, so nothing is left behind.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const MIGRATION = '0030_new_groups_start_normal.sql';
const VERSION = '0030';

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

function migration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8');
}

const DEFAULT_SQL = `select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'group_modes' and column_name = 'mode'`;

if (container === null) {
  describe.skip('0030: new groups start on Normal', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('0030 against a scratch database', () => {
    const scratch = `m14_46_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ids = {
      admin: 'a0000000-0000-0000-0000-000000000001',
      switched: 'd0000000-0000-0000-0000-000000000002',
      untouched: 'd0000000-0000-0000-0000-000000000003',
      born: 'd0000000-0000-0000-0000-000000000004',
      rowless: 'd0000000-0000-0000-0000-000000000005',
    };
    const ROW_SQL = `select g.slug || '|' || gm.mode || '|' || coalesce(gm.set_by::text, '-') || '|' || gm.updated_at
      from public.group_modes gm join public.groups g on g.id = gm.group_id
      where g.id not in ('${ids.born}', '${ids.rowless}') order by g.slug`;
    let before = '';

    beforeAll(() => {
      psql('postgres', `create database ${scratch}`);
      // The auth objects and the Realtime publication the migrations reference, which a fresh
      // database inside the stack's container does not have. Only their shape matters.
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

      // Existing groups, before 0030: the original group (0018) on Fearless, one an admin switched
      // to Normal, one created and left alone (Fearless, set by nobody).
      psql(
        scratch,
        `insert into public.players (id, puuid) values ('${ids.admin}', 'p-admin');
         insert into public.groups (id, slug, name) values
           ('${ids.switched}', 'switched-group', 'Switched'),
           ('${ids.untouched}', 'untouched-group', 'Untouched');
         update public.group_modes set mode = 'normal', set_by = '${ids.admin}' where group_id = '${ids.switched}';`,
      );
      before = psql(scratch, ROW_SQL);
      psql(scratch, migration(MIGRATION));
    }, 180_000);

    afterAll(() => {
      psql('postgres', `drop database if exists ${scratch} with (force)`);
    });

    it('started from a database where a new group was born on Fearless', () => {
      expect(before.split('\n').map((row) => row.split('|').slice(0, 3).join('|'))).toEqual([
        'customs|fearless|-',
        'switched-group|normal|' + ids.admin,
        'untouched-group|fearless|-',
      ]);
      expect(
        psql(scratch, `select group_id from public.group_modes where group_id = '${ORIGINAL_GROUP_ID}'`),
      ).toBe(ORIGINAL_GROUP_ID);
    });

    it('leaves every existing group exactly as it was: mode, set_by and updated_at', () => {
      expect(psql(scratch, ROW_SQL)).toBe(before);
    });

    it("changes the column default to 'normal'", () => {
      expect(psql(scratch, DEFAULT_SQL)).toBe("'normal'::text");
    });

    it('starts a group created afterwards on Normal, set by nobody', () => {
      psql(
        scratch,
        `insert into public.groups (id, slug, name) values ('${ids.born}', 'born-group', 'Born')`,
      );
      expect(
        psql(
          scratch,
          `select mode || '|' || coalesce(set_by::text, '-') from public.group_modes where group_id = '${ids.born}'`,
        ),
      ).toBe('normal|-');
    });

    it('stamps a game in the new group normal, so it never joins a fearless pool', () => {
      psql(
        scratch,
        `insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
         values (4646, now(), 1800, 100, '{}', '${ids.born}')`,
      );
      expect(psql(scratch, 'select mode from public.games where lcu_game_id = 4646')).toBe('normal');
    });

    it("stamps a game whose group has no group_modes row normal (games_stamp_mode's fallback)", () => {
      psql(
        scratch,
        `insert into public.groups (id, slug, name) values ('${ids.rowless}', 'rowless-group', 'Rowless');
         delete from public.group_modes where group_id = '${ids.rowless}';
         insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
         values (4647, now(), 1800, 100, '{}', '${ids.rowless}')`,
      );
      expect(psql(scratch, 'select mode from public.games where lcu_game_id = 4647')).toBe('normal');
    });

    it('still stamps a game in an existing fearless group fearless, and honours a named mode', () => {
      psql(
        scratch,
        `insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
         values (4648, now(), 1800, 100, '{}', '${ids.untouched}');
         insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id, mode)
         values (4649, now(), 1800, 100, '{}', '${ids.born}', 'fearless')`,
      );
      expect(psql(scratch, 'select mode from public.games where lcu_game_id = 4648')).toBe('fearless');
      expect(psql(scratch, 'select mode from public.games where lcu_game_id = 4649')).toBe('fearless');
    });

    it('applies twice without changing anything', () => {
      const rows = psql(scratch, ROW_SQL);
      psql(scratch, migration(MIGRATION));
      expect(psql(scratch, ROW_SQL)).toBe(rows);
      expect(psql(scratch, DEFAULT_SQL)).toBe("'normal'::text");
    });
  });

  const applied =
    psql(
      'postgres',
      `select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}'`,
    ) === '1';

  describe.skipIf(!applied)('0030 on the local stack (skipped until 0030 is applied)', () => {
    it('gives a scratch group the mode normal, and leaves nothing behind', () => {
      const slug = `it-m14-46-${crypto.randomUUID().slice(0, 8)}`;
      const answer = psql(
        'postgres',
        `begin;
         insert into public.groups (slug, name) values ('${slug}', 'M14.46 scratch');
         select gm.mode || '|' || coalesce(gm.set_by::text, '-')
           from public.group_modes gm join public.groups g on g.id = gm.group_id where g.slug = '${slug}';
         rollback;`,
      );
      expect(answer).toBe('normal|-');
      expect(psql('postgres', `select count(*) from public.groups where slug = '${slug}'`)).toBe('0');
    });

    it("has 'normal' as the column default", () => {
      expect(psql('postgres', DEFAULT_SQL)).toBe("'normal'::text");
    });
  });
}
