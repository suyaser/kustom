import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * M18.4, `0036_kustom_rating.sql`: the Kustom rating's columns on `game_players`, `ratings.r`,
 * nullable OpenSkill `ratings.mu`/`sigma`, and `splits.odds_model`.
 *
 * Against **a scratch database** inside the stack's container (like `premiumFlag`): replay every
 * migration before 0036, store an OpenSkill-era night (a rated row with its 0034 breakdown, an
 * unrated row, a ratings row, a chosen split), apply 0036, and check that every existing row is
 * untouched and reads null / 'openskill', that a second apply fails, that the shapes the Kustom fold
 * (M18.5) and the current OpenSkill build write are accepted, and that a hand-written update
 * breaking each check is refused -- one test per check.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there (CI).
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const MIGRATION = '0036_kustom_rating.sql';

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

const IDS = {
  rated: 'f1800000-0000-0000-0000-000000000001',
  unrated: 'f1800000-0000-0000-0000-000000000002',
  newcomer: 'f1800000-0000-0000-0000-000000000003',
  game: 'f1800000-0000-0000-0000-0000000000a1',
  lobby: 'f1800000-0000-0000-0000-0000000000b1',
};

/** A whole all-time Kustom set (the 0034 parts it reuses included), as M18.5 writes it. */
const KUSTOM =
  "r_before = 1200, r_after = 1219.2, k = 32, fold_p = 0.5, award = 'mvp', rated_games_before = 0, share_rank = 1";
/** A whole weekly set. */
const WEEK =
  'week_r_before = 1200, week_r_after = 1219.2, week_k = 32, week_fold_p = 0.5, week_games_before = 0';

/**
 * `set ${KUSTOM}, k = 0 where ...` assigns `k` twice, which Postgres refuses before any check runs:
 * keep the last assignment of each column, so a test reads as "the whole set, but this".
 */
function lastWins(sql: string): string {
  return sql.replace(/\bset ([\s\S]*?) where /g, (_match, list: string) => {
    const byColumn = new Map<string, string>();
    for (const part of list.split(/,\s*/)) {
      const column = part.split('=')[0]?.trim() ?? part;
      byColumn.delete(column);
      byColumn.set(column, part.trim());
    }
    return `set ${[...byColumn.values()].join(', ')} where `;
  });
}

if (container === null) {
  describe.skip('0036: the Kustom rating columns', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('0036 against a scratch database', () => {
    const scratch = `m18_4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const rated = `where game_id = '${IDS.game}' and player_id = '${IDS.rated}'`;
    const unrated = `where game_id = '${IDS.game}' and player_id = '${IDS.unrated}'`;

    /** Runs `sql` inside a transaction that is always rolled back; returns its last output. */
    const tryIt = (sql: string) => psql(scratch, `begin;\n${lastWins(sql)}\nrollback;`);
    const refused = (sql: string) => psqlError(scratch, `begin;\n${lastWins(sql)}\nrollback;`);

    beforeAll(() => {
      psql('postgres', `create database ${scratch}`);
      psql(
        scratch,
        `create schema if not exists auth;
         create table if not exists auth.users (id uuid primary key);
         create table if not exists auth.identities (user_id uuid, provider text, provider_id text);
         create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
         create publication supabase_realtime;
         do $$ begin
           if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
           if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
           if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
         end $$;
         grant usage on schema public to anon, authenticated, service_role;
         alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
         alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`,
      );
      const earlier = readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < MIGRATION)
        .sort();
      for (const name of earlier) psql(scratch, migration(name), true);

      // An OpenSkill-era night, as the current build stores it.
      const g = ORIGINAL_GROUP_ID;
      psql(
        scratch,
        `insert into public.players (id, puuid) values
           ('${IDS.rated}', 'p-m18-4-rated'), ('${IDS.unrated}', 'p-m18-4-unrated'), ('${IDS.newcomer}', 'p-m18-4-new');
         insert into public.games (id, group_id, lcu_game_id, started_at, duration_s, winning_side, raw)
           values ('${IDS.game}', '${g}', 918004, '2026-10-01T20:00:00Z', 1800, 100, '{}');
         insert into public.game_players
           (game_id, group_id, player_id, side, mu_before, sigma_before, mu_after, sigma_after,
            fold_p, base_mu_after, award, rated_games_before)
         values
           ('${IDS.game}', '${g}', '${IDS.rated}', 100, 20, 8, 21.5, 7.8, 0.55, 21.2, 'mvp', 4),
           ('${IDS.game}', '${g}', '${IDS.unrated}', 200, null, null, null, null, null, null, null, null);
         insert into public.ratings (group_id, player_id, mu, sigma, games, wins)
           values ('${g}', '${IDS.rated}', 21.5, 7.8, 5, 3);
         insert into public.lobbies (id, group_id, lcu_party_id) values ('${IDS.lobby}', '${g}', 'party-m18-4');
         insert into public.splits (lobby_id, rank, blue, red, gap, blue_win_prob, score, off_role_count,
                                    explanation, roster_key, is_chosen)
           values ('${IDS.lobby}', 1, '[1,2,3,4,5]', '[6,7,8,9,10]', 12, 0.52, 3.5, 0, 'x', 'k', true);`,
      );
      psql(scratch, migration(MIGRATION));
    }, 240_000);

    afterAll(() => {
      psql('postgres', `drop database if exists ${scratch} with (force)`);
    });

    it('leaves every existing row as it was: new columns null, splits openskill', () => {
      expect(
        psql(
          scratch,
          `select count(*) from public.game_players
           where r_before is not null or r_after is not null or k is not null or share_rank is not null
              or week_r_before is not null or week_r_after is not null or week_k is not null
              or week_fold_p is not null or week_games_before is not null`,
        ),
      ).toBe('0');
      expect(
        psql(
          scratch,
          `select mu_after || '|' || fold_p || '|' || base_mu_after || '|' || award from public.game_players ${rated}`,
        ),
      ).toBe('21.5|0.55|21.2|mvp');
      expect(
        psql(scratch, `select mu || '|' || sigma || '|' || coalesce(r::text, '-') from public.ratings`),
      ).toBe('21.5|7.8|-');
      expect(psql(scratch, 'select odds_model from public.splits')).toBe('openskill');
    });

    it('has the documented columns and types', () => {
      expect(
        psql(
          scratch,
          `select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, column_name)
           from information_schema.columns where table_schema = 'public' and (
             (table_name = 'game_players' and column_name in ('r_before','r_after','k','share_rank','week_r_before','week_r_after','week_k','week_fold_p','week_games_before'))
             or (table_name = 'ratings' and column_name in ('r','mu','sigma'))
             or (table_name = 'splits' and column_name = 'odds_model'))`,
        ),
      ).toBe(
        [
          'game_players.k:double precision:YES',
          'game_players.r_after:double precision:YES',
          'game_players.r_before:double precision:YES',
          'game_players.share_rank:smallint:YES',
          'game_players.week_fold_p:double precision:YES',
          'game_players.week_games_before:integer:YES',
          'game_players.week_k:double precision:YES',
          'game_players.week_r_after:double precision:YES',
          'game_players.week_r_before:double precision:YES',
          'ratings.mu:double precision:YES',
          'ratings.r:double precision:YES',
          'ratings.sigma:double precision:YES',
          'splits.odds_model:text:NO',
        ].join(','),
      );
    });

    it('fails a second apply cleanly, leaving the first intact', () => {
      expect(psqlError(scratch, migration(MIGRATION))).toMatch(/already exists/);
      expect(psql(scratch, 'select odds_model from public.splits')).toBe('openskill');
    });

    describe('accepts what the writers write', () => {
      it('the current build: an OpenSkill rating with its 0034 breakdown, and nulling it whole', () => {
        tryIt(
          `update public.game_players set mu_before = 20, sigma_before = 8, mu_after = 19, sigma_after = 7.9,
             fold_p = 0.45, base_mu_after = 19.3, award = 'ace', rated_games_before = 0 ${unrated};`,
        );
        tryIt(
          `update public.game_players set mu_before = null, sigma_before = null, mu_after = null, sigma_after = null,
             fold_p = null, base_mu_after = null, award = null, rated_games_before = null ${rated};`,
        );
        tryIt(`insert into public.splits (lobby_id, rank, blue, red, gap, blue_win_prob, score, off_role_count, explanation, roster_key)
               values ('${IDS.lobby}', 2, '[1,2,3,4,5]', '[6,7,8,9,10]', 1, 0.5, 1, 0, 'x', 'k');`);
      });

      it('the Kustom fold: both tracks with no OpenSkill numbers (base_mu_after null)', () => {
        tryIt(`update public.game_players set ${KUSTOM}, ${WEEK} ${unrated};`);
      });

      it('the Kustom fold over an OpenSkill-era row (both models side by side)', () => {
        tryIt(`update public.game_players set ${KUSTOM}, ${WEEK} ${rated};`);
      });

      it('a game with no performance score: share_rank null, award none', () => {
        tryIt(
          `update public.game_players set ${KUSTOM.replace("'mvp'", "'none'")}, share_rank = null, ${WEEK} ${unrated};`,
        );
      });

      it('a game before the reset epoch inside the current week: the weekly track only', () => {
        tryIt(`update public.game_players set ${WEEK}, award = 'none' ${unrated};`);
      });

      it('an un-rate that nulls every column of a Kustom row in one statement', () => {
        tryIt(
          `update public.game_players set ${KUSTOM}, ${WEEK} ${unrated};
           update public.game_players set r_before = null, r_after = null, k = null, fold_p = null, award = null,
             rated_games_before = null, share_rank = null, week_r_before = null, week_r_after = null, week_k = null,
             week_fold_p = null, week_games_before = null ${unrated};`,
        );
      });

      it('a Kustom-only ratings row, and a kustom split', () => {
        tryIt(
          `insert into public.ratings (group_id, player_id, r, games, wins) values ('${ORIGINAL_GROUP_ID}', '${IDS.newcomer}', 1219.2, 1, 1);
           update public.ratings set r = 1208 where player_id = '${IDS.rated}';
           update public.splits set odds_model = 'kustom';`,
        );
      });
    });

    describe('refuses a hand-written update breaking each check', () => {
      it('game_players_kustom_together: r_after without r_before or k', () => {
        expect(refused(`update public.game_players set ${KUSTOM}, r_before = null ${unrated};`)).toMatch(
          /game_players_kustom_together/,
        );
        expect(refused(`update public.game_players set ${KUSTOM}, k = null ${unrated};`)).toMatch(
          /game_players_kustom_together/,
        );
      });

      it('game_players_kustom_together: an all-time Kustom row without fold_p, award or n', () => {
        for (const missing of [
          'rated_games_before = null',
          'fold_p = null, award = null, share_rank = null',
        ]) {
          expect(refused(`update public.game_players set ${KUSTOM}, ${missing} ${unrated};`)).toMatch(
            /game_players_kustom_together/,
          );
        }
      });

      it('game_players_week_together: a partial weekly set, or one without an award', () => {
        expect(
          refused(`update public.game_players set ${WEEK}, award = 'none', week_fold_p = null ${unrated};`),
        ).toMatch(/game_players_week_together/);
        expect(
          refused(
            `update public.game_players set ${WEEK}, award = 'none', week_games_before = null ${unrated};`,
          ),
        ).toMatch(/game_players_week_together/);
        expect(refused(`update public.game_players set ${WEEK} ${unrated};`)).toMatch(
          /game_players_week_together/,
        );
      });

      it('game_players_share_rank: a share rank without an award', () => {
        expect(
          refused(
            `update public.game_players set share_rank = 2, award = null, fold_p = null, base_mu_after = null ${rated};`,
          ),
        ).toMatch(/game_players_share_rank/);
      });

      it('game_players_breakdown_together: an OpenSkill breakdown without its odds or award', () => {
        expect(refused(`update public.game_players set fold_p = null ${rated};`)).toMatch(
          /game_players_breakdown_together/,
        );
        expect(refused(`update public.game_players set base_mu_after = null ${rated};`)).toMatch(
          /game_players_breakdown_together/,
        );
      });

      it('game_players_breakdown_needs_rating: all-time parts on a row with no all-time rating', () => {
        expect(refused(`update public.game_players set mu_after = null ${rated};`)).toMatch(
          /game_players_breakdown_needs_rating/,
        );
        expect(
          refused(
            `update public.game_players set ${WEEK}, award = 'none', rated_games_before = 3 ${unrated};`,
          ),
        ).toMatch(/game_players_breakdown_needs_rating/);
      });

      it('game_players_breakdown_needs_rating: an award or share rank on a row rated on no track', () => {
        expect(refused(`update public.game_players set award = 'none' ${unrated};`)).toMatch(
          /game_players_breakdown_needs_rating/,
        );
        expect(refused(`update public.game_players set award = 'none', share_rank = 3 ${unrated};`)).toMatch(
          /game_players_breakdown_needs_rating/,
        );
        // An un-rate that forgets the weekly set leaves the award explained by it, and so is legal;
        // one that forgets the all-time breakdown is not.
        expect(
          refused(
            `update public.game_players set ${KUSTOM} ${unrated};
             update public.game_players set r_before = null, r_after = null, k = null ${unrated};`,
          ),
        ).toMatch(/game_players_breakdown_(needs_rating|together)/);
      });

      it('the column ranges: share_rank 1-5, k and week_k positive, week_fold_p in [0, 1], week n >= 0', () => {
        expect(refused(`update public.game_players set ${KUSTOM}, share_rank = 6 ${unrated};`)).toMatch(
          /game_players_share_rank_check/,
        );
        expect(refused(`update public.game_players set ${KUSTOM}, k = 0 ${unrated};`)).toMatch(
          /game_players_k_check/,
        );
        expect(refused(`update public.game_players set ${KUSTOM}, ${WEEK}, week_k = -1 ${unrated};`)).toMatch(
          /game_players_week_k_check/,
        );
        expect(
          refused(`update public.game_players set ${KUSTOM}, ${WEEK}, week_fold_p = 1.01 ${unrated};`),
        ).toMatch(/game_players_week_fold_p_check/);
        expect(
          refused(`update public.game_players set ${KUSTOM}, ${WEEK}, week_games_before = -1 ${unrated};`),
        ).toMatch(/game_players_week_games_before_check/);
      });

      it('ratings_openskill_pair: mu without sigma', () => {
        expect(refused(`update public.ratings set sigma = null where player_id = '${IDS.rated}';`)).toMatch(
          /ratings_openskill_pair/,
        );
      });

      it('ratings_has_a_rating: a row with neither an OpenSkill pair nor r', () => {
        expect(
          refused(`update public.ratings set mu = null, sigma = null where player_id = '${IDS.rated}';`),
        ).toMatch(/ratings_has_a_rating/);
      });

      it('splits_odds_model_known: an unknown odds model, or none', () => {
        expect(refused(`update public.splits set odds_model = 'elo';`)).toMatch(/splits_odds_model_known/);
        expect(refused(`update public.splits set odds_model = null;`)).toMatch(/not-null/);
      });
    });

    describe('rollback: the OpenSkill build rebuilding over Kustom rows', () => {
      // A row as the Kustom fold writes it after the switch: no OpenSkill numbers, both tracks.
      const kustomRow = `update public.game_players set mu_before = null, sigma_before = null, mu_after = null,
        sigma_after = null, base_mu_after = null, ${KUSTOM}, ${WEEK} ${rated};`;
      // The OpenSkill rebuild's `nulled()` row (apps/web/lib/ingest/rebuild.ts) for a gated game.
      const oldNulled = `update public.game_players set mu_before = null, sigma_before = null, mu_after = null,
        sigma_after = null, fold_p = null, base_mu_after = null, award = null, rated_games_before = null ${rated};`;
      // The OpenSkill rebuild's write for a rated game.
      const oldRated = `update public.game_players set mu_before = 20, sigma_before = 8, mu_after = 21.4,
        sigma_after = 7.8, fold_p = 0.52, base_mu_after = 21.1, award = 'mvp', rated_games_before = 4 ${rated};`;
      const prestep = readFileSync(`${PACKAGE_ROOT}scripts/m18-rollback-prestep.sql`, 'utf8').replaceAll(
        ":'group_id'",
        `'${ORIGINAL_GROUP_ID}'`,
      );

      it('refuses the old nulled() on a Kustom row (the gap the pre-step closes)', () => {
        expect(refused(`${kustomRow}\n${oldNulled}`)).toMatch(/game_players_kustom_together/);
      });

      it('accepts the old nulled() and rated writes after m18-rollback-prestep.sql', () => {
        // The file runs verbatim (comments and CASE included), not through `lastWins`.
        const afterPrestep = (sql: string) =>
          psql(scratch, `begin;\n${lastWins(kustomRow)}\n${prestep}\n${sql}\nrollback;`);
        afterPrestep(oldNulled);
        afterPrestep(oldRated);
        expect(
          afterPrestep(
            `select count(*) from public.game_players where group_id = '${ORIGINAL_GROUP_ID}'
               and (r_after is not null or week_r_after is not null or share_rank is not null or k is not null);`,
          ),
        ).toBe('0');
      });

      it('needs no ratings step: the old upsert writes mu/sigma over a Kustom-only row, and nulling r there is refused', () => {
        const kustomOnly = `insert into public.ratings (group_id, player_id, r, games, wins)
          values ('${ORIGINAL_GROUP_ID}', '${IDS.newcomer}', 1219.2, 1, 1);`;
        tryIt(
          `${kustomOnly}
           insert into public.ratings (group_id, player_id, mu, sigma, games, wins)
             values ('${ORIGINAL_GROUP_ID}', '${IDS.newcomer}', 21, 8, 1, 1)
             on conflict (group_id, player_id) do update set mu = excluded.mu, sigma = excluded.sigma;`,
        );
        expect(
          refused(`${kustomOnly}\nupdate public.ratings set r = null where player_id = '${IDS.newcomer}';`),
        ).toMatch(/ratings_has_a_rating/);
      });
    });

    it('needs no new policy: anon reads the new columns, and still cannot write them', () => {
      expect(
        tryIt(
          `set local role anon;
           select count(r_after) + count(week_r_after) + count(share_rank) from public.game_players;
           select count(r) from public.ratings;
           select count(odds_model) from public.splits;`,
        ),
      ).toBe('0\n0\n1');
      expect(refused(`set local role anon; update public.game_players set share_rank = 1;`)).toMatch(
        /permission denied/,
      );
      expect(
        psql(
          scratch,
          `select count(*) from pg_policies where schemaname = 'public' and tablename in ('game_players', 'ratings', 'splits')`,
        ),
      ).toBe('3');
    });
  });
}
