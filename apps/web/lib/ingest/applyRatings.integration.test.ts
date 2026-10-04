import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from '@customs/db';
import type { GamePlayerRatingsRow } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * 0043 `apply_game_player_ratings` on the local stack, through the three writers that use it: the
 * live fold's claim (`rating.ts`), `rebuild-ratings` and the daily cron's rebuild (`rebuild.ts`).
 *
 * 1. the live fold claims its ten rows in one call; the same game posted again (a second
 *    companion) writes nothing, and a direct `p_only_unrated` call on a rated game writes 0 rows;
 * 2. a backfilled game landing out of order is folded by a rebuild that writes every moved row in
 *    one call (the database's count equals the rebuild's), the stored rows then equal a fresh
 *    in-memory fold (a dry run would change nothing), and a second rebuild writes 0 rows;
 * 3. the database skips rows that did not move (the same rows twice: N, then 0);
 * 4. one row breaking a 0036 check refuses the whole call and nothing moves (one transaction);
 * 5. a row missing a column, a duplicate row, a non-array and another group's id are refused or
 *    touch nothing;
 * 6. anon and authenticated cannot execute it (through PostgREST and as the database roles);
 * 7. the M18 rollback pre-step (`packages/db/scripts/m18-rollback-prestep.sql`) still turns a group
 *    the RPC wrote back into OpenSkill-only rows the old build's writes are accepted on, and the
 *    Kustom rebuild then puts every row back.
 *
 * Own group, own players; skipped without the stack (`pnpm db:start`) or without 0043 applied.
 */

const stack = await resolveLocalStack();
const TZ = 'Africa/Cairo';

const DB_PACKAGE_ROOT = fileURLToPath(new URL('../../../../packages/db/', import.meta.url));

function findDbContainer(): string | null {
  try {
    const config = readFileSync(`${DB_PACKAGE_ROOT}supabase/config.toml`, 'utf8');
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

const container = stack === null ? null : findDbContainer();

function psql(sql: string, vars: Record<string, string> = {}): string {
  const args = [
    'exec',
    '-i',
    container as string,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-q',
  ];
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  return execFileSync('docker', args, {
    input: sql,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

const applied =
  container !== null &&
  psql("select count(*) from pg_proc where proname = 'apply_game_player_ratings'") === '1';

if (stack === null || !applied) {
  describe.skip('0043 apply_game_player_ratings against the local Supabase stack', () => {
    it('needs the local stack with 0043: `pnpm db:start`, then apply the migration', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.DISCORD_WEBHOOK_URL = '';
  process.env.CUSTOMS_NIGHT_TZ = TZ;

  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { rebuildRatings } = await import('./rebuild');
  const { applyGamePlayerRatings } = await import('./applyRatings');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId, 10);
  const ownerPuuid = puuids[0] as string;
  const base = testGameId();
  const gameIds: number[] = [];
  const nextGameId = () => {
    const id = base + gameIds.length;
    gameIds.push(id);
    return id;
  };

  let token = '';
  let groupId = '';
  let otherGroupId = '';

  const at = (day: number, hour: number) => new Date(Date.UTC(2026, 8, 7 + day, 16 + hour)).toISOString();
  const rotate = (list: readonly string[], by: number) => [...list.slice(by), ...list.slice(0, by)];

  function body(lcuGameId: number, startedAt: string, by: number, winningSide: 100 | 200) {
    return eogBody({
      gameId: lcuGameId,
      puuids: rotate(puuids, by),
      partyId: null,
      winningSide,
      startedAt,
      durationS: 1_800,
      performanceStats: true,
    }) as Record<string, unknown>;
  }

  async function post(payload: unknown): Promise<{ rated: boolean }> {
    const response = await postGame(
      new Request('http://localhost/api/companion/game', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { rated: boolean };
  }

  const COLUMNS =
    'game_id, player_id, mu_before, sigma_before, mu_after, sigma_after, fold_p, base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank, week_r_before, week_r_after, week_k, week_fold_p, week_games_before';

  /** Every rating column of every row of the group, as the RPC takes them, in a fixed order. */
  async function stored(): Promise<GamePlayerRatingsRow[]> {
    const { data, error } = await db
      .from('game_players')
      .select(COLUMNS)
      .eq('group_id', groupId)
      .order('game_id')
      .order('player_id');
    if (error) throw new Error(error.message);
    return (data ?? []) as GamePlayerRatingsRow[];
  }

  /** The rows' physical versions: unchanged `xmin` means the row was not rewritten at all. */
  function versions(): string {
    return psql(
      `select string_agg(game_id || ':' || player_id || ':' || xmin::text, ',' order by game_id, player_id)
         from public.game_players where group_id = '${groupId}'`,
    );
  }

  function rebuild(dryRun = false) {
    return rebuildRatings(db, { groupId, force: true, dryRun, timeZone: TZ });
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    const ownerPlayerId = ids.get(ownerPuuid) ?? '';
    const groups = await createTestGroups(db, runId, ['apply', 'other'] as const);
    groupId = groups.apply;
    otherGroupId = groups.other;
    await pinTestGroupMode(db, groupId, 'normal');
    await setTestMembership(db, groupId, ownerPlayerId, 'owner');
    const { token: raw, tokenHash } = mintCompanionToken();
    const inserted = await db.from('companion_tokens').insert({
      group_id: groupId,
      player_id: ownerPlayerId,
      token_hash: tokenHash,
      label: `it-${runId}-apply`,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    token = raw;
  });

  afterAll(async () => {
    const problems: string[] = [];
    const attempt = async (what: string, step: () => PromiseLike<unknown>) => {
      try {
        const result = (await step()) as { error?: { message?: string } | null } | null;
        if (result?.error) problems.push(`${what}: ${result.error.message ?? 'failed'}`);
      } catch (thrown) {
        problems.push(`${what}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    };
    await attempt('deleting this run’s games', () => db.from('games').delete().in('lcu_game_id', gameIds));
    await attempt('deleting the test groups', () => deleteTestGroups(db, [groupId, otherGroupId]));
    await attempt('deleting this run’s players', () => db.from('players').delete().in('puuid', puuids));
    if (problems.length > 0) throw new Error(`apply cleanup: ${problems.join('; ')}`);
  });

  describe('0043 apply_game_player_ratings', () => {
    it('claims a live game in one call; the same game posted again writes nothing', async () => {
      for (let game = 0; game < 4; game += 1) {
        const outcome = await post(body(nextGameId(), at(1 + game, 0), game, game % 2 === 0 ? 100 : 200));
        expect(outcome.rated).toBe(true);
      }
      const rows = await stored();
      expect(rows).toHaveLength(40);
      expect(rows.every((row) => row.r_after !== null && row.week_r_after !== null)).toBe(true);
      const before = versions();

      // A second companion posting the third game: a no-op, row for row.
      const again = await post(body(gameIds[2] as number, at(3, 0), 2, 100));
      expect(again.rated).toBe(false);
      expect(versions()).toBe(before);
      expect(await stored()).toEqual(rows);

      // The claim itself refuses a rated row, whatever it is handed.
      const third = rows.filter((row) => row.game_id === rows[20]?.game_id);
      const claim = await applyGamePlayerRatings(
        db,
        groupId,
        third.map((row) => ({ ...row, r_after: (row.r_after as number) + 50 })),
        { onlyUnrated: true },
      );
      expect(claim).toBe(0);
      expect(versions()).toBe(before);
    });

    it('rebuilds an out-of-order backfill in one call, and a second rebuild writes 0 rows', async () => {
      // A backfilled game from before the first live game: stored unrated, folded by the rebuild.
      const { partyId: _dropped, ...rest } = body(nextGameId(), at(0, 0), 5, 200);
      expect((await post({ ...rest, source: 'backfill' })).rated).toBe(false);

      const first = await rebuild();
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      // Every live row moves (the backfill is earlier) and the ten backfilled rows are new.
      expect(first.report.gamePlayerRowsChanged).toBe(50);
      expect(first.report.gamePlayerRowsWritten).toBe(first.report.gamePlayerRowsChanged);

      // What is stored is the ordered fold: a fresh in-memory fold finds nothing to change.
      const dry = await rebuild(true);
      expect(dry.ok && dry.report.gamePlayerRowsChanged).toBe(0);

      const before = versions();
      const second = await rebuild();
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.report.gamePlayerRowsChanged).toBe(0);
      expect(second.report.gamePlayerRowsWritten).toBe(0);
      expect(second.report.ratingRowsChanged).toBe(0);
      expect(versions()).toBe(before);
    });

    it('skips rows whose stored values already match', async () => {
      // PostgREST prints doubles to 15 digits, so the first call moves every row by a rounding
      // step; the same rows a second time match exactly and are not rewritten.
      const rows = await stored();
      const firstCall = await applyGamePlayerRatings(db, groupId, rows, { onlyUnrated: false });
      expect(firstCall).toBeGreaterThan(0);
      const before = versions();
      expect(await applyGamePlayerRatings(db, groupId, rows, { onlyUnrated: false })).toBe(0);
      expect(versions()).toBe(before);
      // The rebuild sees the rounded values as the same numbers (RATING_EPSILON) and writes none.
      const again = await rebuild();
      expect(again.ok && again.report.gamePlayerRowsWritten).toBe(0);
    });

    it('is one transaction: a row breaking a 0036 check refuses the whole call', async () => {
      const rows = await stored();
      const before = versions();
      const moved = rows.map((row, index) =>
        index === rows.length - 1
          ? { ...row, k: null }
          : { ...row, r_after: (row.r_after as number) + 1, week_r_after: (row.week_r_after as number) + 1 },
      );
      await expect(applyGamePlayerRatings(db, groupId, moved, { onlyUnrated: false })).rejects.toThrow(
        /game_players_kustom_together/,
      );
      expect(versions()).toBe(before);
      expect(await stored()).toEqual(rows);
    });

    it('refuses a missing column, a duplicate row and a non-array; another group is never touched', async () => {
      const rows = await stored();
      const row = rows[0] as GamePlayerRatingsRow;
      const before = versions();
      const call = (p_rows: unknown, p_group = groupId) =>
        db.rpc('apply_game_player_ratings', {
          p_group,
          p_rows: p_rows as never,
          p_only_unrated: false,
        });

      const { k: _k, ...missing } = row;
      expect((await call([missing])).error?.message).toMatch(/every rating column/);
      expect((await call([row, row])).error?.message).toMatch(/appears twice/);
      expect((await call({ rows: [row] })).error?.message).toMatch(/must be a json array/);
      // The same row under another group's id matches nothing.
      const other = await call([{ ...row, r_after: (row.r_after as number) + 5 }], otherGroupId);
      expect(other.error).toBeNull();
      expect(other.data).toBe(0);
      expect(versions()).toBe(before);
      // The TypeScript writer parses first: a NaN never reaches the table.
      await expect(
        applyGamePlayerRatings(db, groupId, [{ ...row, r_after: Number.NaN }], { onlyUnrated: false }),
      ).rejects.toThrow(/malformed row/);
    });

    it('cannot be executed by anon or authenticated', async () => {
      const before = versions();
      // Through PostgREST with the anon key, and with a signed authenticated session when the
      // stack's JWT secret is in the environment (SUPABASE_LOCAL_JWT_SECRET).
      const bearers = [stack.anonKey];
      const secret = process.env.SUPABASE_LOCAL_JWT_SECRET;
      if (secret) {
        const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: randomUUID(), role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600 })}`;
        bearers.push(`${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`);
      }
      for (const bearer of bearers) {
        const response = await fetch(`${stack.url}/rest/v1/rpc/apply_game_player_ratings`, {
          method: 'POST',
          headers: {
            apikey: stack.anonKey,
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ p_group: groupId, p_rows: [], p_only_unrated: false }),
        });
        const json = (await response.json()) as { code?: string };
        expect(response.status).toBeGreaterThanOrEqual(401);
        expect(json.code).toBe('42501');
      }
      // And in the database, as each role, whatever the gateway does.
      for (const role of ['anon', 'authenticated']) {
        expect(() =>
          psql(
            `begin; set local role ${role}; select public.apply_game_player_ratings('${groupId}', '[]', false); rollback;`,
          ),
        ).toThrow(/permission denied for function apply_game_player_ratings/);
      }
      expect(versions()).toBe(before);
    });

    it('leaves the M18 rollback pre-step valid: OpenSkill-only rows after it, Kustom back after a rebuild', async () => {
      const prestep = readFileSync(`${DB_PACKAGE_ROOT}scripts/m18-rollback-prestep.sql`, 'utf8');
      psql(`begin;\n${prestep}\ncommit;`, { group_id: groupId });
      const after = await stored();
      expect(
        after.every((row) => row.r_after === null && row.week_r_after === null && row.share_rank === null),
      ).toBe(true);
      expect(after.every((row) => row.mu_after !== null)).toBe(true);

      // The old build's un-rate (`nulled()`: OpenSkill and 0034 columns only) is accepted now.
      const victim = after[0] as GamePlayerRatingsRow;
      const nulled = await db
        .from('game_players')
        .update({
          mu_before: null,
          sigma_before: null,
          mu_after: null,
          sigma_after: null,
          fold_p: null,
          base_mu_after: null,
          award: null,
          rated_games_before: null,
        })
        .eq('game_id', victim.game_id)
        .eq('player_id', victim.player_id);
      expect(nulled.error).toBeNull();

      // Re-switching: the Kustom rebuild (through 0043) refills every row, and is idempotent again.
      const back = await rebuild();
      expect(back.ok).toBe(true);
      const refilled = await stored();
      expect(refilled.every((row) => row.r_after !== null && row.week_r_after !== null)).toBe(true);
      const second = await rebuild();
      expect(second.ok && second.report.gamePlayerRowsWritten).toBe(0);
    });
  });
}
