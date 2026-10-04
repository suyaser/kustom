import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from './localStack';
import { ORIGINAL_GROUP_ID } from './schemas/groups';

/**
 * M16.3, `0033_ai_lines.sql`: the AI lines store, the ledger and meter, the kill switch, the
 * group switch and the player opt-out.
 *
 * 1. **A scratch database** inside the stack's container (the 0031 pattern): replay every migration
 *    before 0033, give it a group, a member, a player and a game, apply 0033, and check the new
 *    columns' defaults, the settings row, the subject shape and uniqueness, the status machine, the
 *    meter's refusals (kill switch, Premium, AI lines, the group cap, the global cap, a worst case
 *    that would cross a cap), the spend sum and settle-once, and that `anon` and `authenticated`
 *    can neither read the tables nor run the functions. Runs whether or not the stack has applied
 *    0033; the scratch database is dropped afterwards. This is the throwaway-Postgres check.
 * 2. **The stack itself, through PostgREST**, skipped until 0033 is in
 *    `supabase_migrations.schema_migrations`: the anon key and a signed `authenticated` JWT are both
 *    refused the three tables and the three functions.
 *
 * Skipped, not failed, when Docker or the stack's database container is not there.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = `${PACKAGE_ROOT}supabase/migrations`;
const MIGRATION = '0033_ai_lines.sql';
const VERSION = '0033';

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

const MONTH = `'2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'`;

if (container === null) {
  describe.skip('0033: AI lines', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('0033 against a scratch database', () => {
    const scratch = `m16_3_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ids = {
      group: 'e1000000-0000-0000-0000-000000000001',
      other: 'e1000000-0000-0000-0000-000000000002',
      player: 'e1000000-0000-0000-0000-000000000011',
      hider: 'e1000000-0000-0000-0000-000000000012',
      game: 'e1000000-0000-0000-0000-000000000021',
    };
    const reserve = (group: string, worst: string) =>
      psql(
        scratch,
        `select public.ai_reserve_call('${group}', 'claude-haiku-4-5-20251001', ${worst}, ${MONTH})::text`,
      );
    const insertLine = (extra: string, values: string) =>
      `insert into public.ai_lines (group_id, kind, subject${extra}, facts, fact_hash, model, prompt_version)
       values ('${ids.group}', ${values}, '[]', '${'a'.repeat(64)}', 'm', 'v')`;

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
        `insert into public.groups (id, slug, name) values ('${ids.group}', 'ai-group', 'AI'), ('${ids.other}', 'ai-other', 'Other');
         insert into public.players (id, puuid) values ('${ids.player}', 'ai-scratch-puuid'), ('${ids.hider}', 'ai-scratch-hider');
         insert into public.group_memberships (group_id, player_id) values ('${ids.group}', '${ids.player}');
         insert into public.games (id, group_id, lcu_game_id, duration_s, started_at, winning_side, raw)
           values ('${ids.game}', '${ids.group}', 987654321, 1800, now(), 100, '{}');`,
      );
      psql(scratch, migration(MIGRATION));
    }, 240_000);

    afterAll(() => {
      psql('postgres', `drop database if exists ${scratch} with (force)`);
    });

    it('turns AI lines on for every group, opts nobody out, and seeds the settings row', () => {
      expect(psql(scratch, 'select count(*) from public.groups where not ai_lines_enabled')).toBe('0');
      expect(
        psql(scratch, `select ai_lines_enabled from public.groups where id = '${ORIGINAL_GROUP_ID}'`),
      ).toBe('t');
      expect(psql(scratch, 'select count(*) from public.group_memberships where ai_opt_out')).toBe('0');
      expect(
        psql(scratch, `select calls_enabled || '|' || global_monthly_cap_usd from public.ai_settings`),
      ).toBe('true|20.00');
      expect(psqlError(scratch, 'insert into public.ai_settings (id) values (false)')).toMatch(
        /ai_settings_singleton/,
      );
      expect(psqlError(scratch, 'insert into public.ai_settings (id) values (true)')).toMatch(
        /duplicate key/,
      );
    });

    it('keys a line by (group, kind, subject) with the subject spelled from its typed column', () => {
      psql(scratch, insertLine(', game_id', `'game', '${ids.game}', '${ids.game}'`));
      expect(psqlError(scratch, insertLine(', game_id', `'game', '${ids.game}', '${ids.game}'`))).toMatch(
        /ai_lines_subject_unique/,
      );
      expect(psqlError(scratch, insertLine(', game_id', `'game', 'something-else', '${ids.game}'`))).toMatch(
        /ai_lines_subject_shape/,
      );
      psql(scratch, insertLine(', week_start', `'week', '2026-09-27', '2026-09-27'`));
      psql(
        scratch,
        insertLine(
          ', player_id, week_start',
          `'player', '${ids.player}:2026-09-27', '${ids.player}', '2026-09-27'`,
        ),
      );
      expect(psqlError(scratch, insertLine(', week_start', `'week', '27/09/2026', '2026-09-27'`))).toMatch(
        /ai_lines_subject_shape/,
      );
      expect(psqlError(scratch, insertLine('', `'season', 'x'`))).toMatch(
        /ai_lines_kind|ai_lines_subject_shape/,
      );
    });

    it('lets a line move only as the status machine says', () => {
      const id = psql(scratch, `select id from public.ai_lines where kind = 'week'`);
      const move = (set: string) => psql(scratch, `update public.ai_lines set ${set} where id = '${id}'`);
      expect(
        psqlError(
          scratch,
          `update public.ai_lines set status = 'hidden', hidden_at = now() where id = '${id}'`,
        ),
      ).toMatch(/pending -> hidden is not an allowed move/);
      move(`status = 'failed', reject_reason = 'transient:server'`);
      move(`status = 'pending'`);
      move(`status = 'published', text = '{P1} x.', published_at = now()`);
      expect(psqlError(scratch, `update public.ai_lines set status = 'rejected' where id = '${id}'`)).toMatch(
        /published -> rejected/,
      );
      move(`status = 'hidden', hidden_at = now(), hidden_by = '${ids.hider}'`);
      expect(
        psqlError(scratch, `update public.ai_lines set status = 'published' where id = '${id}'`),
      ).toMatch(/hidden -> published/);
      expect(psqlError(scratch, `update public.ai_lines set text = 'changed' where id = '${id}'`)).toMatch(
        /is final/,
      );
      // Nor can its hider be swapped for someone else.
      expect(
        psqlError(scratch, `update public.ai_lines set hidden_by = '${ids.player}' where id = '${id}'`),
      ).toMatch(/is final/);
      // A published line needs its text; a hidden one its stamp.
      const player = psql(scratch, `select id from public.ai_lines where kind = 'player'`);
      expect(
        psqlError(
          scratch,
          `update public.ai_lines set status = 'published', published_at = now() where id = '${player}'`,
        ),
      ).toMatch(/ai_lines_shown_has_text/);
    });

    it('deleting the admin who hid a line nulls hidden_by and the line stays hidden', () => {
      psql(scratch, `delete from public.players where id = '${ids.hider}'`);
      expect(
        psql(
          scratch,
          `select status || '|' || coalesce(hidden_by::text, '-') from public.ai_lines where kind = 'week'`,
        ),
      ).toBe('hidden|-');
    });

    it('drops a game line with its game', () => {
      psql(scratch, `delete from public.games where id = '${ids.game}'`);
      expect(psql(scratch, `select count(*) from public.ai_lines where kind = 'game'`)).toBe('0');
    });

    it('refuses a call for a group without Premium, with AI lines off, or behind the kill switch', () => {
      expect(reserve(ids.group, '0.01')).toBe('{"ok": false, "reason": "not_premium"}');
      psql(scratch, `update public.groups set premium = true where id in ('${ids.group}', '${ids.other}')`);
      psql(scratch, `update public.groups set ai_lines_enabled = false where id = '${ids.group}'`);
      expect(reserve(ids.group, '0.01')).toBe('{"ok": false, "reason": "lines_off"}');
      psql(scratch, `update public.groups set ai_lines_enabled = true where id = '${ids.group}'`);
      psql(scratch, 'update public.ai_settings set calls_enabled = false');
      expect(reserve(ids.group, '0.01')).toBe('{"ok": false, "reason": "kill_switch"}');
      psql(scratch, 'update public.ai_settings set calls_enabled = true');
      expect(reserve('e1000000-0000-0000-0000-0000000000ff', '0.01')).toBe(
        '{"ok": false, "reason": "no_group"}',
      );
      expect(psqlError(scratch, `select public.ai_reserve_call('${ids.group}', 'm', 0, ${MONTH})`)).toMatch(
        /positive/,
      );
    });

    it("stops at the group's $2 cap: the call whose worst case would cross it is not made", () => {
      expect(reserve(ids.group, '1.95')).toMatch(/"ok": true/);
      expect(reserve(ids.group, '0.06')).toBe('{"ok": false, "reason": "group_cap"}');
      const landing = reserve(ids.group, '0.05');
      expect(landing).toMatch(/"ok": true/); // exactly $2.00
      expect(reserve(ids.group, '0.000001')).toBe('{"ok": false, "reason": "group_cap"}');
      // Another group still has its own budget.
      expect(reserve(ids.other, '0.05')).toMatch(/"ok": true/);
    });

    it('counts a settled call at its cost, once', () => {
      const id = psql(scratch, `select id from public.ai_calls where reserved_usd = 1.95`);
      expect(psql(scratch, `select public.ai_settle_call('${id}', 'ok', 0.002, 2000, 80, 'msg_x')`)).toBe(
        't',
      );
      expect(psql(scratch, `select public.ai_settle_call('${id}', 'ok', 0, 0, 0, 'msg_y')`)).toBe('f');
      expect(
        psql(
          scratch,
          `select group_spent_usd || '|' || global_spent_usd from public.ai_month_spend('${ids.group}', ${MONTH})`,
        ),
      ).toBe('0.052000|0.102000');
      // Last month's and next month's calls are not this month's.
      expect(
        psql(
          scratch,
          `select group_spent_usd from public.ai_month_spend('${ids.group}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')`,
        ),
      ).toBe('0');
      expect(psqlError(scratch, `select public.ai_settle_call('${id}', 'maybe', 0, 0, 0, null)`)).toMatch(
        /unknown outcome/,
      );
    });

    it('stops every group at the global cap', () => {
      psql(scratch, 'update public.ai_settings set global_monthly_cap_usd = 0.15');
      psql(scratch, `update public.groups set ai_monthly_cap_usd = 100 where id = '${ids.other}'`);
      expect(reserve(ids.other, '0.05')).toBe('{"ok": false, "reason": "global_cap"}');
      expect(reserve(ids.other, '0.048')).toMatch(/"ok": true/);
      psql(scratch, 'update public.ai_settings set global_monthly_cap_usd = 20');
    });

    it('keeps the three tables and three functions away from anon and authenticated', () => {
      for (const role of ['anon', 'authenticated']) {
        for (const table of ['ai_lines', 'ai_calls', 'ai_settings']) {
          expect(
            psqlError(
              scratch,
              `begin; set local role ${role}; select count(*) from public.${table}; rollback;`,
            ),
          ).toMatch(new RegExp(`permission denied for table ${table}`));
        }
        expect(
          psqlError(
            scratch,
            `begin; set local role ${role}; select public.ai_reserve_call('${ids.group}', 'm', 1, ${MONTH}); rollback;`,
          ),
        ).toMatch(/permission denied for function ai_reserve_call/);
        expect(
          psqlError(
            scratch,
            `begin; set local role ${role}; select * from public.ai_month_spend('${ids.group}', ${MONTH}); rollback;`,
          ),
        ).toMatch(/permission denied for function ai_month_spend/);
        expect(
          psqlError(
            scratch,
            `begin; set local role ${role}; update public.group_memberships set ai_opt_out = true; rollback;`,
          ),
        ).toMatch(/permission denied for table group_memberships/);
        expect(
          psqlError(
            scratch,
            `begin; set local role ${role}; select ai_lines_enabled from public.groups; rollback;`,
          ),
        ).toMatch(/permission denied for table groups/);
      }
      expect(
        psql(
          scratch,
          `begin; set local role service_role; select count(*) >= 0 from public.ai_calls; rollback;`,
        ),
      ).toContain('t');
    });
  });

  describe('0033 on the stack, through PostgREST', async () => {
    const stack = await resolveLocalStack();
    const applied =
      stack !== null &&
      psql(
        'postgres',
        `select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}'`,
      ) === '1';

    it.skipIf(!applied)(
      'refuses the anon key and a signed authenticated session every table and function',
      async () => {
        if (stack === null) return;
        const signed = (() => {
          if (!stack.jwtSecret) return null;
          const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
          const now = Math.floor(Date.now() / 1000);
          const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: randomUUID(), role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600 })}`;
          return `${body}.${createHmac('sha256', stack.jwtSecret).update(body).digest('base64url')}`;
        })();
        const bearers = [stack.anonKey, ...(signed === null ? [] : [signed])];
        for (const bearer of bearers) {
          const headers = {
            apikey: stack.anonKey,
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          };
          for (const table of ['ai_lines', 'ai_calls', 'ai_settings']) {
            const response = await fetch(`${stack.url}/rest/v1/${table}?select=*`, { headers });
            expect(response.status, table).toBeGreaterThanOrEqual(400);
          }
          for (const fn of ['ai_reserve_call', 'ai_settle_call', 'ai_month_spend']) {
            const response = await fetch(`${stack.url}/rest/v1/rpc/${fn}`, {
              method: 'POST',
              headers,
              body: '{}',
            });
            expect(response.status, fn).toBeGreaterThanOrEqual(400);
          }
        }
      },
    );

    it.skipIf(applied)('waits for 0033 to be applied to the stack', () => {
      expect(applied).toBe(false);
    });
  });
}
