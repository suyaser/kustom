import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GROUP_SLUG_CASES } from './groupSlugCases';
import { groupSlugSchema, ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * What `0018_groups.sql` does to a database that already has a group's history in it (M13.2,
 * acceptance 2).
 *
 * The shared local database cannot show this: by the time a test runs there, 0018 was applied to
 * empty tables and every row since was written by tests through the temporary defaults. So this
 * file builds its own database inside the local stack's Postgres container -- a scratch database
 * with a random name, never the stack's `postgres` -- replays 0001 to 0017, writes a small night
 * into it, snapshots it, applies 0018, and checks the backfill against the snapshot. It drops the
 * scratch database afterwards and touches nothing else.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there, like every
 * other `*.integration.test.ts`.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const GROUPS_MIGRATION = '0018_groups.sql';

/** The ten tables 0018 puts a `group_id` on. */
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
  describe.skip('0018 backfill against a scratch database', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const scratch = `m13_backfill_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

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

  /** One value from the scratch database. */
  function one(sql: string): string {
    return psql(scratch, sql);
  }

  function migration(name: string): string {
    return readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8');
  }

  const ids = {
    lobbyOnly: 'a0000000-0000-0000-0000-000000000001',
    gameOnly: 'a0000000-0000-0000-0000-000000000002',
    tokenOnly: 'a0000000-0000-0000-0000-000000000003',
    adminOnly: 'a0000000-0000-0000-0000-000000000004',
    adminWhoPlayed: 'a0000000-0000-0000-0000-000000000005',
    approved: 'a0000000-0000-0000-0000-000000000006',
    nobody: 'a0000000-0000-0000-0000-000000000007',
    both: 'a0000000-0000-0000-0000-000000000008',
    lobby: 'b0000000-0000-0000-0000-000000000001',
    game: 'c0000000-0000-0000-0000-000000000001',
  };

  let before: Record<string, string> = {};

  function snapshot(): Record<string, string> {
    const counts: Record<string, string> = {};
    for (const table of GROUPED_TABLES) counts[table] = one(`select count(*) from public.${table}`);
    counts['sum(mu)'] = one('select sum(mu)::text from public.ratings');
    counts['sum(sigma)'] = one('select sum(sigma)::text from public.ratings');
    counts.players = one('select count(*) from public.players');
    return counts;
  }

  beforeAll(() => {
    psql('postgres', `create database ${scratch}`);
    // The stack's roles (anon, authenticated, service_role) are cluster-wide; the `auth` schema is
    // per database, and 0018 needs `auth.users` for `groups.created_by`.
    psql(
      scratch,
      'create schema if not exists auth; create table if not exists auth.users (id uuid primary key);',
    );
    // What Supabase does to its own database and a scratch one does not inherit: anon and
    // authenticated get every privilege on new public tables by default. Without it the revokes
    // in 0001 and 0018 would be proving nothing, and the public-read tables would not be.
    psql(
      scratch,
      `grant usage on schema public to anon, authenticated, service_role;
       alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
       alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`,
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort();
    for (const name of files.filter((file) => file < GROUPS_MIGRATION)) {
      psql(scratch, migration(name), true);
    }

    // One night, before groups existed. Every membership edge case of the brief is one player.
    psql(
      scratch,
      `
      insert into public.players (id, puuid, is_admin, backfill_requested_at, backfill_approved_at) values
        ('${ids.lobbyOnly}',      'p-lobby-only',  false, null, null),
        ('${ids.gameOnly}',       'p-game-only',   false, null, null),
        ('${ids.tokenOnly}',      'p-token-only',  false, null, null),
        ('${ids.adminOnly}',      'p-admin-only',  true,  null, null),
        ('${ids.adminWhoPlayed}', 'p-admin-plays', true,  null, null),
        ('${ids.approved}',       'p-approved',    false, '2026-09-20T10:00:00Z', '2026-09-21T10:00:00Z'),
        ('${ids.nobody}',         'p-nobody',      false, null, null),
        ('${ids.both}',           'p-both',        false, null, null);

      insert into public.lobbies (id, lcu_party_id, status) values ('${ids.lobby}', 'party-1', 'finished');
      insert into public.lobby_members (lobby_id, player_id, side) values
        ('${ids.lobby}', '${ids.lobbyOnly}', 100),
        ('${ids.lobby}', '${ids.both}', 200);

      insert into public.games (id, lcu_game_id, lobby_id, started_at, duration_s, winning_side, raw) values
        ('${ids.game}', 7001, '${ids.lobby}', '2026-09-20T20:00:00Z', 1800, 100, '{}');
      insert into public.game_players (game_id, player_id, side) values
        ('${ids.game}', '${ids.gameOnly}', 100),
        ('${ids.game}', '${ids.adminWhoPlayed}', 100),
        ('${ids.game}', '${ids.both}', 200);

      insert into public.ratings (player_id, season_id, mu, sigma) values
        ('${ids.gameOnly}',       '00000000-0000-0000-0000-000000000001', 21.25, 7.5),
        ('${ids.adminWhoPlayed}', '00000000-0000-0000-0000-000000000001', 19.875, 7.25),
        ('${ids.both}',           '00000000-0000-0000-0000-000000000001', 20.5, 7.125);

      insert into public.companion_tokens (player_id, token_hash, revoked_at) values
        ('${ids.tokenOnly}', 'hash-revoked', now()),
        ('${ids.approved}', 'hash-approved', null);

      insert into public.companion_commands (target_player_id, kind) values ('${ids.approved}', 'invite');

      insert into public.daily_mysteries
        (day, challenge_number, game_id, mystery_player_id, interesting_score, category, suspect_ids, hook, active_from, expires_at)
      values
        ('2026-09-21', 1, '${ids.game}', '${ids.gameOnly}', 1, 'disaster', array['${ids.gameOnly}'::uuid], '{}', now(), now() + interval '1 day');

      insert into public.window_posts (kind, window_start) values ('last-week', '2026-09-13T04:00:00Z');

      -- Two guilds' rows: the app tolerates them, so 0018 must too (see its header).
      insert into public.discord_config (guild_id, webhook_url) values ('guild-1', 'https://example.invalid/1'), ('guild-2', null);
      `,
    );

    before = snapshot();
    psql(scratch, migration(GROUPS_MIGRATION), true);
  }, 180_000);

  afterAll(() => {
    psql('postgres', `drop database if exists ${scratch} with (force)`);
  });

  describe('0018 backfill against a scratch database', () => {
    it('creates the original group with its fixed id, slug and name', () => {
      expect(
        one(
          "select id || '|' || slug || '|' || name || '|' || coalesce(created_by::text, 'null') from public.groups",
        ),
      ).toBe(`${ORIGINAL_GROUP_ID}|customs|Customs Night|null`);
    });

    it.each(GROUPED_TABLES.map((table) => [table]))(
      'gives every existing %s row the original group, not null',
      (table) => {
        expect(Number(before[table])).toBeGreaterThan(0);
        expect(
          one(`select count(*) from public.${table} where group_id is distinct from '${ORIGINAL_GROUP_ID}'`),
        ).toBe('0');
        expect(
          one(
            `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = 'group_id'`,
          ),
        ).toBe('NO');
      },
    );

    it('moves no row and no number: counts, sum(mu) and sum(sigma) are exactly what they were', () => {
      expect(snapshot()).toEqual(before);
    });

    it('makes a member of everybody in a lobby, a game or holding a token, and an admin of every is_admin', () => {
      const memberships = one(
        `select string_agg(p.puuid || '=' || m.role, ',' order by p.puuid)
           from public.group_memberships m join public.players p on p.id = m.player_id
          where m.group_id = '${ORIGINAL_GROUP_ID}'`,
      );
      expect(memberships.split(',')).toEqual([
        'p-admin-only=admin',
        'p-admin-plays=admin',
        'p-approved=member',
        'p-both=member',
        'p-game-only=member',
        'p-lobby-only=member',
        'p-token-only=member',
      ]);
    });

    it('counts exactly the distinct players of lobby_members, game_players, token holders and admins', () => {
      const expected = one(`
        select count(*) from (
          select player_id from public.lobby_members
          union select player_id from public.game_players
          union select player_id from public.companion_tokens
          union select id from public.players where is_admin
        ) everyone`);
      expect(one('select count(*) from public.group_memberships')).toBe(expected);
      expect(expected).toBe('7');
    });

    it('gives a player with no lobby, no game and no token no membership', () => {
      expect(one(`select count(*) from public.group_memberships where player_id = '${ids.nobody}'`)).toBe(
        '0',
      );
    });

    it('copies the M5.1 approval pair onto the membership and leaves players untouched', () => {
      expect(
        one(
          `select backfill_requested_at::text || '|' || backfill_approved_at::text
             from public.group_memberships where player_id = '${ids.approved}'`,
        ),
      ).toBe('2026-09-20 10:00:00+00|2026-09-21 10:00:00+00');
      expect(
        one(`select count(*) from public.players where is_admin or backfill_approved_at is not null`),
      ).toBe('3');
    });

    it('lets bootstrap_admin make an admin membership in the original group, idempotently', () => {
      psql(scratch, `select public.bootstrap_admin('p-nobody'); select public.bootstrap_admin('p-nobody');`);
      psql(scratch, `select public.bootstrap_admin('p-game-only');`);
      expect(
        one(
          `select string_agg(p.puuid || '=' || m.role, ',' order by p.puuid)
             from public.group_memberships m join public.players p on p.id = m.player_id
            where p.puuid in ('p-nobody', 'p-game-only')`,
        ),
      ).toBe('p-game-only=admin,p-nobody=admin');
    });

    /** Acceptance 3. A second group exists from here on in this scratch database. */
    describe('with a second group', () => {
      const other = 'd0000000-0000-0000-0000-000000000002';

      beforeAll(() => {
        psql(
          scratch,
          `insert into public.groups (id, slug, name) values ('${other}', 'other-group', 'Other')`,
        );
      });

      it("refuses a game_players row whose group differs from its game's", () => {
        expect(() =>
          psql(
            scratch,
            `insert into public.game_players (game_id, player_id, side, group_id)
             values ('${ids.game}', '${ids.lobbyOnly}', 100, '${other}')`,
          ),
        ).toThrow(/game_players_game_group_fkey/);
      });

      it('refuses a second game with an existing lcu_game_id even in a different group', () => {
        expect(() =>
          psql(
            scratch,
            `insert into public.games (lcu_game_id, started_at, duration_s, winning_side, raw, group_id)
             values (7001, now(), 60, 200, '{}', '${other}')`,
          ),
        ).toThrow(/games_lcu_game_id_key/);
        expect(one('select count(*) from public.games where lcu_game_id = 7001')).toBe('1');
      });

      it('still refuses a second live lobby for a party in a different group', () => {
        psql(scratch, `insert into public.lobbies (lcu_party_id) values ('party-live')`);
        expect(() =>
          psql(
            scratch,
            `insert into public.lobbies (lcu_party_id, group_id) values ('party-live', '${other}')`,
          ),
        ).toThrow(/lobbies_active_party_idx/);
      });
    });

    describe('the slug check agrees with groupSlugSchema', () => {
      it.each(GROUP_SLUG_CASES.map((c) => [c.slug, c.valid, c.why] as const))(
        '%s -> valid %s (%s)',
        (slug, valid) => {
          // Inside a rolled-back transaction, so a passing slug leaves nothing behind and
          // `customs` is not refused for already existing.
          const sql = `begin;
            delete from public.groups where slug = '${slug}' and id <> '${ORIGINAL_GROUP_ID}';
            update public.groups set slug = slug || '-x' where slug = '${slug}';
            insert into public.groups (slug, name) values ('${slug}', 'Case');
            rollback;`;
          if (valid) {
            expect(() => psql(scratch, sql)).not.toThrow();
          } else {
            expect(() => psql(scratch, sql)).toThrow(/groups_slug_(shape|not_reserved)/);
          }
          expect(groupSlugSchema.safeParse(slug).success).toBe(valid);
        },
      );
    });

    describe('row level security', () => {
      const asAnon = (sql: string) => psql(scratch, `set role anon; ${sql}`);

      it('lets anon read the two public views and nothing private on them', () => {
        expect(asAnon(`select slug from public.groups_public where id = '${ORIGINAL_GROUP_ID}'`)).toBe(
          'customs',
        );
        expect(Number(asAnon('select count(*) from public.group_members_public'))).toBeGreaterThan(0);
        expect(() => asAnon('select created_by from public.groups_public')).toThrow(/created_by/);
        expect(() => asAnon('select role from public.group_members_public')).toThrow(/role/);
      });

      it('does not let anon read the base tables', () => {
        expect(() => asAnon('select * from public.groups')).toThrow(/permission denied/);
        expect(() => asAnon('select * from public.group_memberships')).toThrow(/permission denied/);
      });

      it('does not let anon or authenticated write to either table', () => {
        for (const role of ['anon', 'authenticated']) {
          expect(() =>
            psql(scratch, `set role ${role}; insert into public.groups (slug, name) values ('sneaky', 'x')`),
          ).toThrow(/permission denied/);
          expect(() =>
            psql(
              scratch,
              `set role ${role}; update public.group_memberships set role = 'admin' where player_id = '${ids.gameOnly}'`,
            ),
          ).toThrow(/permission denied/);
        }
      });

      it('keeps the ten tables as public or as private as they were', () => {
        expect(() => asAnon('select group_id from public.games limit 1')).not.toThrow();
        expect(() => asAnon('select group_id from public.ratings limit 1')).not.toThrow();
        expect(() => asAnon('select group_id from public.discord_config limit 1')).toThrow(
          /permission denied/,
        );
        expect(() => asAnon('select group_id from public.companion_tokens limit 1')).toThrow(
          /permission denied/,
        );
      });
    });

    it('leaves exactly one foreign key from game_players to games, the composite one', () => {
      expect(
        one(`
          select string_agg(conname, ',' order by conname) from pg_constraint
           where contype = 'f' and conrelid = 'public.game_players'::regclass
             and confrelid = 'public.games'::regclass`),
      ).toBe('game_players_game_group_fkey');
    });
  });
}
