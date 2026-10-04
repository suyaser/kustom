import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * What `0020_group_keys_web_and_defaults_off.sql` does (M13.4): the last single-group keys go, the
 * ten temporary `group_id` defaults go, and `discord_config` becomes one row per group. The role
 * writer 0020 added (`set_group_member_role`) is dropped by `0023` (M14.11); the last block below
 * applies 0021 to 0023 on top and checks its replacement, `set_group_member_role_v2`, with
 * `transfer_group_ownership` and `remove_group_member`.
 *
 * Like `groups.backfill.integration.test.ts`, this builds its own scratch database inside the
 * local stack's Postgres container, because the interesting part is a database that held data
 * **before** 0020 (two `discord_config` rows in one group, written through the defaults): it
 * replays 0001 to 0019, writes that data, applies 0020, and checks. The scratch database is
 * dropped afterwards; the stack's own `postgres` database is never touched.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const KEYS_MIGRATION = '0020_group_keys_web_and_defaults_off.sql';

/** The ten tables 0018 put a `group_id` on, with the temporary default 0020 removes. */
const GROUPED_TABLES = [
  'ratings',
  'lobbies',
  'games',
  'game_players',
  'companion_tokens',
  'companion_commands',
  'fearless_state',
  'daily_mysteries',
  'window_posts',
  'discord_config',
] as const;

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

if (container === null) {
  describe.skip('0020 against a scratch database', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const scratch = `m13_keys_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

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

  function one(sql: string): string {
    return psql(scratch, sql);
  }

  function migration(name: string): string {
    return readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8');
  }

  const ids = {
    other: 'd0000000-0000-0000-0000-000000000002',
    hana: 'a0000000-0000-0000-0000-000000000001',
    omar: 'a0000000-0000-0000-0000-000000000002',
    zoe: 'a0000000-0000-0000-0000-000000000003',
    game: 'c0000000-0000-0000-0000-000000000001',
    otherGame: 'c0000000-0000-0000-0000-000000000002',
  };

  beforeAll(() => {
    psql('postgres', `create database ${scratch}`);
    psql(
      scratch,
      'create schema if not exists auth; create table if not exists auth.users (id uuid primary key);',
    );
    psql(
      scratch,
      `grant usage on schema public to anon, authenticated, service_role;
       alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
       alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`,
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort();
    for (const name of files.filter((file) => file < KEYS_MIGRATION)) {
      psql(scratch, migration(name), true);
    }

    // Before 0020: everything written through the temporary defaults, into the original group,
    // including the case 0018's header deferred to here -- three `discord_config` rows in one
    // group. The app posted with the oldest row that had a webhook (`guild-new-hook`, older than
    // the other hooked row), so that is the one 0020 must keep.
    psql(
      scratch,
      `
      insert into public.players (id, puuid) values
        ('${ids.hana}', 'p-hana'), ('${ids.omar}', 'p-omar'), ('${ids.zoe}', 'p-zoe');

      insert into public.games (id, lcu_game_id, started_at, duration_s, winning_side, raw) values
        ('${ids.game}', 7001, '2026-09-20T20:00:00Z', 1800, 100, '{}');

      insert into public.daily_mysteries
        (day, kind, challenge_number, game_id, mystery_player_id, interesting_score, category, suspect_ids, hook, active_from, expires_at)
      values
        ('2026-09-21', 'mystery', 1, '${ids.game}', '${ids.hana}', 1, 'disaster', array['${ids.hana}'::uuid], '{}', now(), now() + interval '1 day');

      insert into public.window_posts (kind, window_start) values ('last-week', '2026-09-13T04:00:00Z');

      insert into public.discord_config (guild_id, webhook_url, created_at) values
        ('guild-no-hook',  null,                         '2026-01-01T00:00:00Z'),
        ('guild-new-hook', 'https://example.invalid/1', '2026-02-01T00:00:00Z'),
        ('guild-late',     'https://example.invalid/2', '2026-03-01T00:00:00Z');

      insert into public.group_memberships (group_id, player_id, role) values
        ('${ORIGINAL_GROUP_ID}', '${ids.hana}', 'admin'),
        ('${ORIGINAL_GROUP_ID}', '${ids.omar}', 'member');
      `,
    );

    psql(scratch, migration(KEYS_MIGRATION), true);

    // A second group, from here on.
    psql(
      scratch,
      `insert into public.groups (id, slug, name) values ('${ids.other}', 'other-group', 'Other');
       insert into public.games (id, lcu_game_id, started_at, duration_s, winning_side, raw, group_id) values
         ('${ids.otherGame}', 7002, '2026-09-20T21:00:00Z', 1800, 100, '{}', '${ids.other}');`,
    );
  }, 180_000);

  afterAll(() => {
    psql('postgres', `drop database if exists ${scratch} with (force)`);
  });

  describe('0020 against a scratch database', () => {
    describe('the temporary defaults are gone (acceptance 6)', () => {
      it('refuses a games insert that does not name its group', () => {
        expect(() =>
          psql(
            scratch,
            `insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw)
             values (7100, now(), 60, 100, '{}')`,
          ),
        ).toThrow(/null value in column "group_id".*violates not-null constraint/);
        expect(one('select count(*) from public.games where lcu_game_id = 7100')).toBe('0');
      });

      it.each(GROUPED_TABLES.map((table) => [table]))(
        '%s.group_id has no default and is not null',
        (table) => {
          expect(
            one(
              `select coalesce(column_default, 'none') || '|' || is_nullable from information_schema.columns
              where table_schema = 'public' and table_name = '${table}' and column_name = 'group_id'`,
            ),
          ).toBe('none|NO');
        },
      );

      it('still accepts the same insert when it names its group', () => {
        psql(
          scratch,
          `insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
           values (7101, now(), 60, 100, '{}', '${ORIGINAL_GROUP_ID}')`,
        );
        expect(one('select group_id from public.games where lcu_game_id = 7101')).toBe(ORIGINAL_GROUP_ID);
      });
    });

    describe('daily_mysteries, per group', () => {
      it('lets two groups have a challenge on the same day, each numbering from its own #1', () => {
        psql(
          scratch,
          `insert into public.daily_mysteries
             (group_id, day, kind, challenge_number, game_id, mystery_player_id, interesting_score, category, suspect_ids, hook, active_from, expires_at)
           values
             ('${ids.other}', '2026-09-21', 'mystery', 1, '${ids.otherGame}', '${ids.zoe}', 1, 'disaster', array['${ids.zoe}'::uuid], '{}', now(), now() + interval '1 day')`,
        );
        expect(one(`select count(*) from public.daily_mysteries where day = '2026-09-21'`)).toBe('2');
      });

      it('still refuses a second challenge for one group on one day, and a repeated number', () => {
        const insert = (day: string, number: number) =>
          psql(
            scratch,
            `insert into public.daily_mysteries
               (group_id, day, kind, challenge_number, game_id, mystery_player_id, interesting_score, category, suspect_ids, hook, active_from, expires_at)
             values
               ('${ids.other}', '${day}', 'mystery', ${number}, '${ids.otherGame}', '${ids.zoe}', 1, 'disaster', array['${ids.zoe}'::uuid], '{}', now(), now() + interval '1 day')`,
          );
        expect(() => insert('2026-09-21', 2)).toThrow(/daily_mysteries_group_day_key/);
        expect(() => insert('2026-09-22', 1)).toThrow(/daily_mysteries_group_kind_challenge_number_key/);
      });
    });

    describe('window_posts, per group', () => {
      it('claims the same window once per group, and refuses a second claim in one group', () => {
        psql(
          scratch,
          `insert into public.window_posts (group_id, kind, window_start)
           values ('${ids.other}', 'last-week', '2026-09-13T04:00:00Z')`,
        );
        expect(() =>
          psql(
            scratch,
            `insert into public.window_posts (group_id, kind, window_start)
             values ('${ids.other}', 'last-week', '2026-09-13T04:00:00Z')`,
          ),
        ).toThrow(/window_posts_pkey/);
        expect(one('select count(*) from public.window_posts')).toBe('2');
      });
    });

    describe('discord_config, one row per group', () => {
      it('kept the row the app was posting with: the oldest one that had a webhook', () => {
        expect(one(`select string_agg(guild_id, ',') from public.discord_config`)).toBe('guild-new-hook');
        expect(one(`select group_id from public.discord_config`)).toBe(ORIGINAL_GROUP_ID);
      });

      it('lets a second group share the guild with its own channel, and refuses a second row for one group', () => {
        psql(
          scratch,
          `insert into public.discord_config (group_id, guild_id, results_channel_id)
           values ('${ids.other}', 'guild-new-hook', 'other-channel')`,
        );
        expect(() =>
          psql(
            scratch,
            `insert into public.discord_config (group_id, guild_id) values ('${ids.other}', 'guild-x')`,
          ),
        ).toThrow(/discord_config_pkey/);
      });
    });

    describe('after 0021 to 0023: set_group_member_role_v2 and the owner functions (M14.11)', () => {
      const OWNED = 'd0000000-0000-0000-0000-000000000003';

      beforeAll(() => {
        // The two auth objects 0022's helpers reference, which the scratch database's stub auth
        // schema does not have. Only their shape matters: nobody signs in here.
        psql(
          scratch,
          `create table if not exists auth.identities (
             user_id uuid, provider text, provider_id text);
           create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';`,
        );
        const later = readdirSync(MIGRATIONS_DIR)
          .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name > KEYS_MIGRATION && name < '0024')
          .sort();
        for (const name of later) psql(scratch, migration(name), true);
        // The original group has no owner (M13.4 rules); a third group has one: Zoe owns it, Hana
        // is its admin, Omar its member.
        psql(
          scratch,
          `insert into public.groups (id, slug, name) values ('${OWNED}', 'owned-group', 'Owned');
           insert into public.group_memberships (group_id, player_id, role) values
             ('${OWNED}', '${ids.zoe}', 'owner'),
             ('${OWNED}', '${ids.hana}', 'admin'),
             ('${OWNED}', '${ids.omar}', 'member');`,
        );
      }, 120_000);

      const setRole = (actor: string, playerId: string, role: string, groupId: string = ORIGINAL_GROUP_ID) =>
        one(`select public.set_group_member_role_v2('${groupId}', '${actor}', '${playerId}', '${role}')`);
      const roleOf = (playerId: string, groupId: string = ORIGINAL_GROUP_ID) =>
        one(
          `select coalesce((select role from public.group_memberships where group_id = '${groupId}' and player_id = '${playerId}'), 'none')`,
        );

      it('dropped the old set_group_member_role', () => {
        expect(
          one(
            `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'set_group_member_role'`,
          ),
        ).toBe('0');
      });

      it('in a group with no owner, refuses to demote the only admin, and writes nothing', () => {
        expect(setRole(ids.hana, ids.hana, 'member')).toBe('last_admin');
        expect(roleOf(ids.hana)).toBe('admin');
      });

      it('in a group with no owner, promotes a member, then lets either admin step down while one remains', () => {
        expect(setRole(ids.hana, ids.omar, 'admin')).toBe('ok');
        expect(setRole(ids.hana, ids.omar, 'admin')).toBe('unchanged');
        expect(setRole(ids.omar, ids.hana, 'member')).toBe('ok');
        expect(roleOf(ids.hana)).toBe('member');
        // Omar is now the last one.
        expect(setRole(ids.omar, ids.omar, 'member')).toBe('last_admin');
        expect(roleOf(ids.omar)).toBe('admin');
        // And Hana, a member now, may change nobody's role.
        expect(setRole(ids.hana, ids.hana, 'admin')).toBe('forbidden');
      });

      it('answers not_member for a player outside the group, and for a group that does not exist', () => {
        expect(setRole(ids.omar, ids.zoe, 'admin')).toBe('not_member');
        expect(setRole(ids.omar, ids.hana, 'admin', 'e0000000-0000-0000-0000-000000000009')).toBe(
          'not_member',
        );
      });

      it('refuses a role outside member | admin: ownership only moves by transfer', () => {
        expect(() => setRole(ids.omar, ids.hana, 'owner')).toThrow(/role must be member or admin/);
      });

      it('in a group with an owner, only the owner demotes an admin, and nobody demotes the owner', () => {
        expect(setRole(ids.hana, ids.omar, 'admin', OWNED)).toBe('ok');
        expect(setRole(ids.hana, ids.omar, 'member', OWNED)).toBe('owner_only');
        expect(setRole(ids.hana, ids.zoe, 'member', OWNED)).toBe('is_owner');
        expect(setRole(ids.zoe, ids.zoe, 'admin', OWNED)).toBe('is_owner');
        expect(setRole(ids.zoe, ids.omar, 'member', OWNED)).toBe('ok');
        expect(roleOf(ids.omar, OWNED)).toBe('member');
      });

      it('transfer_group_ownership: owner only, to an admin, and the old owner stays an admin', () => {
        const transfer = (actor: string, to: string) =>
          one(`select public.transfer_group_ownership('${OWNED}', '${actor}', '${to}')`);
        expect(transfer(ids.hana, ids.hana)).toBe('owner_only');
        expect(transfer(ids.zoe, ids.omar)).toBe('not_admin');
        expect(transfer(ids.zoe, ids.zoe)).toBe('unchanged');
        expect(transfer(ids.zoe, ids.hana)).toBe('ok');
        expect(roleOf(ids.hana, OWNED)).toBe('owner');
        expect(roleOf(ids.zoe, OWNED)).toBe('admin');
        expect(transfer(ids.hana, ids.zoe)).toBe('ok');
      });

      it('remove_group_member: admins remove members, the owner removes admins, nobody removes the owner', () => {
        const remove = (actor: string, playerId: string) =>
          one(`select public.remove_group_member('${OWNED}', '${actor}', '${playerId}')`);
        expect(remove(ids.hana, ids.zoe)).toBe('is_owner');
        expect(remove(ids.omar, ids.hana)).toBe('forbidden');
        expect(remove(ids.hana, ids.omar)).toBe('ok');
        expect(roleOf(ids.omar, OWNED)).toBe('none');
        expect(remove(ids.hana, ids.omar)).toBe('not_member');
        expect(remove(ids.zoe, ids.hana)).toBe('ok');
        expect(roleOf(ids.hana, OWNED)).toBe('none');
      });

      it('one owner per group, by the index', () => {
        expect(() =>
          psql(
            scratch,
            `insert into public.group_memberships (group_id, player_id, role) values ('${OWNED}', '${ids.omar}', 'owner')`,
          ),
        ).toThrow(/group_memberships_one_owner_idx/);
      });

      it.each([
        ['set_group_member_role_v2', `'${ORIGINAL_GROUP_ID}', '${ids.omar}', '${ids.hana}', 'admin'`],
        ['transfer_group_ownership', `'${OWNED}', '${ids.zoe}', '${ids.hana}'`],
        ['remove_group_member', `'${OWNED}', '${ids.zoe}', '${ids.omar}'`],
      ])('%s is not callable by anon or authenticated', (fn, args) => {
        for (const role of ['anon', 'authenticated']) {
          expect(() => psql(scratch, `set role ${role}; select public.${fn}(${args})`)).toThrow(
            /permission denied/,
          );
        }
      });
    });
  });
}
