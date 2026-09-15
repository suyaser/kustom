import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEASON_ONE_ID } from './index';
import { resolveLocalStack } from './localStack';
import { rosterKey } from './rosterKey';

/**
 * What `0001_init.sql` actually enforces, exercised through PostgREST exactly the way the
 * API and the web client reach it: idempotency keys, the enum and check constraints, and
 * the RLS boundary between the service role and anon.
 *
 * Skipped, not failed, when the local stack is not running (`pnpm db:start`), so
 * `pnpm -r test` stays green on a machine without Docker.
 */

const stack = await resolveLocalStack();

type Caller = 'service' | 'anon';

interface RestResult {
  status: number;
  ok: boolean;
  body: unknown;
}

function rows(body: unknown): Record<string, unknown>[] {
  return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
}

if (stack === null) {
  describe.skip('schema against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const { url, anonKey, serviceRoleKey } = stack;

  async function rest(caller: Caller, path: string, init: RequestInit = {}): Promise<RestResult> {
    const key = caller === 'service' ? serviceRoleKey : anonKey;
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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

  function insert(table: string, payload: unknown, caller: Caller = 'service'): Promise<RestResult> {
    return rest(caller, table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
  }

  // Everything this file creates is namespaced by a run id and deleted afterwards, so the
  // local database is reusable between runs.
  const runId = `t-${crypto.randomUUID().slice(0, 8)}`;
  const puuidA = `${runId}-a`;
  const puuidB = `${runId}-b`;
  const partyId = `${runId}-party`;
  const gameId = Math.floor(Math.random() * 1_000_000_000) + 9_000_000_000;
  /**
   * A `window_posts` key of this run's own (M5.13). Deep in the past, because a real one is a
   * Sunday 06:00 the cron route computed and nothing here may collide with it.
   */
  const windowStart = new Date(
    Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 1_000_000_000),
  ).toISOString();

  let playerAId = '';
  let playerBId = '';
  let lobbyId = '';

  beforeAll(async () => {
    // PostgREST bulk insert needs identical keys on every object (PGRST102).
    const players = await insert('players', [
      { puuid: puuidA, game_name: 'Hana', tag_line: 'EUW', discord_id: `${runId}-discord`, main_role: 'mid' },
      { puuid: puuidB, game_name: 'Omar', tag_line: 'EUW', discord_id: null, main_role: 'jungle' },
    ]);
    expect(players.status).toBe(201);
    playerAId = String(rows(players.body)[0]?.id ?? '');
    playerBId = String(rows(players.body)[1]?.id ?? '');

    const lobby = await insert('lobbies', {
      lcu_party_id: partyId,
      reported_by_player_id: playerAId,
      lobby_name: 'customs night',
    });
    expect(lobby.status).toBe(201);
    lobbyId = String(rows(lobby.body)[0]?.id ?? '');
  });

  afterAll(async () => {
    await rest('service', `window_posts?window_start=eq.${encodeURIComponent(windowStart)}`, {
      method: 'DELETE',
    });
    await rest('service', `games?lcu_game_id=eq.${gameId}`, { method: 'DELETE' });
    await rest('service', `lobbies?lcu_party_id=like.${runId}*`, { method: 'DELETE' });
    await rest('service', `players?puuid=like.${runId}*`, { method: 'DELETE' });
  });

  describe('service role writes', () => {
    it('created the player and the lobby', () => {
      expect(playerAId).not.toBe('');
      expect(playerBId).not.toBe('');
      expect(lobbyId).not.toBe('');
    });

    it('defaults a new lobby to open', async () => {
      const result = await rest('service', `lobbies?id=eq.${lobbyId}&select=status,created_at,updated_at`);
      expect(rows(result.body)[0]?.status).toBe('open');
    });

    it('bumps updated_at on update', async () => {
      const before = await rest('service', `lobbies?id=eq.${lobbyId}&select=updated_at`);
      const updated = await rest('service', `lobbies?id=eq.${lobbyId}&select=updated_at`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'balanced' }),
      });
      expect(updated.ok).toBe(true);
      expect(rows(updated.body)[0]?.updated_at).not.toBe(rows(before.body)[0]?.updated_at);
    });

    it('inserts a game and defaults it to the active season', async () => {
      const game = await insert('games', {
        lcu_game_id: gameId,
        lobby_id: lobbyId,
        started_at: '2026-09-08T20:00:00.000Z',
        duration_s: 1834,
        winning_side: 100,
        raw: { gameId, gameType: 'CUSTOM_GAME' },
      });
      expect(game.status).toBe(201);
      const row = rows(game.body)[0];
      expect(row?.season_id).toBe(SEASON_ONE_ID);
      expect(row?.source).toBe('eog');

      const gamePlayer = await insert('game_players', {
        game_id: row?.id,
        player_id: playerAId,
        side: 100,
        role: 'mid',
        kills: 9,
      });
      expect(gamePlayer.status).toBe(201);
      expect(rows(gamePlayer.body)[0]?.deaths).toBe(0);
    });

    it('generates ratings.ordinal from mu and sigma', async () => {
      const rating = await insert('ratings', {
        player_id: playerAId,
        season_id: SEASON_ONE_ID,
        mu: 25,
        sigma: 8.333,
      });
      expect(rating.status).toBe(201);
      expect(rows(rating.body)[0]?.ordinal).toBeCloseTo(25 - 2 * 8.333, 6);
    });

    /**
     * The seed the first fold used, stored beside the rating it grew into (M5.7, `0012`).
     *
     * The pair constraint is the point: a reader asks `seed_mu is null` to know whether a seed
     * is stored at all, so a row with a mu and no sigma would be a state nothing downstream
     * handles. The rank columns stay free to be null — unranked is a real answer.
     */
    it('stores a seed as a pair, with the rank it was read from, and refuses half of one', async () => {
      const seeded = await insert('ratings', {
        player_id: playerBId,
        season_id: SEASON_ONE_ID,
        mu: 24.1,
        sigma: 8.1,
        seed_mu: 23,
        seed_sigma: 8.333,
        seed_rank_tier: 'GOLD',
        seed_rank_division: 'IV',
      });
      expect(seeded.status).toBe(201);
      expect(rows(seeded.body)[0]).toMatchObject({
        seed_mu: 23,
        seed_rank_tier: 'GOLD',
        seed_rank_division: 'IV',
      });

      const half = await rest('service', `ratings?player_id=eq.${playerBId}&season_id=eq.${SEASON_ONE_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ seed_sigma: null }),
      });
      expect(half.status).toBe(400);
      expect((half.body as { code?: string }).code).toBe('23514');
    });
  });

  describe('idempotency keys', () => {
    it('rejects a second live lobby for the same lcu_party_id and changes no rows', async () => {
      const before = await rest('service', `lobbies?lcu_party_id=eq.${partyId}&select=id`);
      const duplicate = await insert('lobbies', { lcu_party_id: partyId });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as { code?: string }).code).toBe('23505');

      const after = await rest('service', `lobbies?lcu_party_id=eq.${partyId}&select=id`);
      expect(rows(after.body)).toHaveLength(rows(before.body).length);
      expect(rows(after.body)).toHaveLength(1);
    });

    it.each([['balanced'], ['in_game']])(
      'rejects a second live lobby while the first is %s',
      async (status) => {
        const party = `${runId}-cycle-${status}`;
        const first = await insert('lobbies', { lcu_party_id: party, status });
        expect(first.status).toBe(201);

        const second = await insert('lobbies', { lcu_party_id: party });
        expect(second.status).toBe(409);
        expect((second.body as { code?: string }).code).toBe('23505');
      },
    );

    it.each([['dropped'], ['finished'], ['abandoned']])(
      "allows the night's next cycle once the previous row is %s (M2.14, M5.11)",
      async (status) => {
        // The client keeps one party id all night. `lobbies_active_party_idx` is partial, so a
        // closed row does not block the next game: `0003_lobby_cycles.sql`. `dropped`
        // (`0005_lobby_dropped.sql`) is in that list because a game whose result never landed
        // must not swallow the rest of the night's posts (M5.11).
        const party = `${runId}-cycle-next-${status}`;
        const first = await insert('lobbies', { lcu_party_id: party, status });
        expect(first.status).toBe(201);
        const firstId = String(rows(first.body)[0]?.id ?? '');

        const second = await insert('lobbies', { lcu_party_id: party });
        expect(second.status).toBe(201);
        const secondId = String(rows(second.body)[0]?.id ?? '');
        expect(secondId).not.toBe(firstId);

        // Two rows, one live and one closed, and nothing was rewritten.
        const all = await rest('service', `lobbies?lcu_party_id=eq.${party}&select=id,status`);
        expect(rows(all.body)).toHaveLength(2);
        expect(rows(all.body).filter((row) => row.status === 'open')).toHaveLength(1);
        expect(rows(all.body).find((row) => row.id === firstId)?.status).toBe(status);

        // And a third live row is still refused while that second one is open.
        const third = await insert('lobbies', { lcu_party_id: party });
        expect(third.status).toBe(409);
      },
    );

    it('rejects a second game with the same lcu_game_id and changes no rows', async () => {
      const before = await rest('service', `games?lcu_game_id=eq.${gameId}&select=id`);
      const duplicate = await insert('games', {
        lcu_game_id: gameId,
        started_at: '2026-09-08T21:00:00.000Z',
        duration_s: 100,
        winning_side: 200,
        raw: {},
      });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as { code?: string }).code).toBe('23505');

      const after = await rest('service', `games?lcu_game_id=eq.${gameId}&select=id`);
      expect(rows(after.body)).toHaveLength(rows(before.body).length);
      expect(rows(after.body)).toHaveLength(1);
    });

    it('rejects a second player with the same puuid', async () => {
      const duplicate = await insert('players', { puuid: puuidA });
      expect(duplicate.status).toBe(409);
    });
  });

  describe('constraints', () => {
    it('rejects a lobby status that is not in the union', async () => {
      const result = await insert('lobbies', { lcu_party_id: `${runId}-bad`, status: 'inGame' });
      expect(result.ok).toBe(false);
    });

    it('rejects a side that is not 100 or 200', async () => {
      const result = await insert('lobby_members', { lobby_id: lobbyId, player_id: playerAId, side: 300 });
      expect(result.ok).toBe(false);
      expect((result.body as { code?: string }).code).toBe('23514');
    });

    it('rejects a role that is not one of the five', async () => {
      const result = await insert('lobby_members', {
        lobby_id: lobbyId,
        player_id: playerBId,
        role: 'bot',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a split whose teams are not five players', async () => {
      const result = await insert('splits', {
        lobby_id: lobbyId,
        rank: 1,
        blue: [{ puuid: puuidA, role: 'mid' }],
        red: [],
        gap: 100,
        blue_win_prob: 0.51,
        score: 100,
        off_role_count: 0,
        explanation: 'nope',
        roster_key: rosterKey([puuidA, puuidB]),
      });
      expect(result.ok).toBe(false);
      expect((result.body as { code?: string }).code).toBe('23514');
    });
  });

  describe('splits history and the lastSplit lookup', () => {
    const team = (prefix: string) =>
      ['top', 'jungle', 'mid', 'adc', 'support'].map((role, index) => ({
        puuid: `${prefix}-${index}`,
        role,
      }));

    it('keeps three splits per run and at most one chosen', async () => {
      const key = rosterKey([...team('blue'), ...team('red')].map((entry) => entry.puuid));
      const created = await insert(
        'splits',
        [1, 2, 3].map((rank) => ({
          lobby_id: lobbyId,
          rank,
          blue: team('blue'),
          red: team('red'),
          gap: 100 * rank,
          blue_win_prob: 0.51,
          score: 100 * rank,
          off_role_count: 0,
          explanation: `split ${rank}`,
          roster_key: key,
          is_chosen: rank === 1,
        })),
      );
      expect(created.status).toBe(201);

      const secondChosen = await rest('service', `splits?lobby_id=eq.${lobbyId}&rank=eq.2`, {
        method: 'PATCH',
        body: JSON.stringify({ is_chosen: true }),
      });
      expect(secondChosen.ok).toBe(false);
      expect((secondChosen.body as { code?: string }).code).toBe('23505');

      // A reroll clears the old choice first, then promotes: that is allowed.
      await rest('service', `splits?lobby_id=eq.${lobbyId}&rank=eq.1`, {
        method: 'PATCH',
        body: JSON.stringify({ is_chosen: false }),
      });
      const promoted = await rest('service', `splits?lobby_id=eq.${lobbyId}&rank=eq.2`, {
        method: 'PATCH',
        body: JSON.stringify({ is_chosen: true }),
      });
      expect(promoted.ok).toBe(true);

      const lastSplit = await rest(
        'service',
        `splits?roster_key=eq.${key}&is_chosen=is.true&select=rank&order=created_at.desc&limit=1`,
      );
      expect(rows(lastSplit.body)[0]?.rank).toBe(2);
    });
  });

  describe('row level security', () => {
    it('does not let anon read players at all', async () => {
      const result = await rest('anon', 'players?select=*');
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result.body)).not.toContain(`${runId}-discord`);
    });

    it('does not let anon read discord_id by asking for the column', async () => {
      const result = await rest('anon', 'players?select=discord_id');
      expect(result.ok).toBe(false);
    });

    it('lets anon read players_public, which has no discord_id', async () => {
      const result = await rest('anon', `players_public?puuid=eq.${puuidA}&select=*`);
      expect(result.ok).toBe(true);
      const row = rows(result.body)[0];
      expect(row?.puuid).toBe(puuidA);
      expect(row).not.toHaveProperty('discord_id');

      const explicit = await rest('anon', `players_public?puuid=eq.${puuidA}&select=discord_id`);
      expect(explicit.ok).toBe(false);
    });

    it('lets anon read the public display tables', async () => {
      for (const table of [
        'seasons',
        'lobbies',
        'lobby_members',
        'splits',
        'games',
        'game_players',
        'ratings',
      ]) {
        const result = await rest('anon', `${table}?select=*&limit=1`);
        expect(result.ok, `${table} should be publicly readable`).toBe(true);
      }
    });

    it('does not let anon read the private tables', async () => {
      for (const table of [
        'companion_tokens',
        'companion_commands',
        'discord_config',
        'window_posts',
        'daily_mysteries',
        'daily_mystery_clues',
        'daily_mystery_sessions',
        'daily_mystery_attempts',
      ]) {
        const result = await rest('anon', `${table}?select=*&limit=1`);
        expect(result.ok, `${table} must not be readable by anon`).toBe(false);
      }
    });

    it('does not let anon write anywhere', async () => {
      const inserted = await insert('lobbies', { lcu_party_id: `${runId}-anon` }, 'anon');
      expect(inserted.ok).toBe(false);

      const patched = await rest('anon', `lobbies?id=eq.${lobbyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'finished' }),
      });
      expect(patched.ok).toBe(false);

      const deleted = await rest('anon', `lobbies?id=eq.${lobbyId}`, { method: 'DELETE' });
      expect(deleted.ok).toBe(false);

      const stillOpen = await rest('service', `lobbies?id=eq.${lobbyId}&select=id`);
      expect(rows(stillOpen.body)).toHaveLength(1);
    });
  });

  /**
   * The whole point of `0011_window_posts.sql`: the primary key is what makes
   * `GET /api/cron/window` safe to call at any cadence. The route's own logic is tested in
   * `apps/web`; this is the guarantee underneath it (M5.13).
   */
  describe('window_posts', () => {
    it('takes one claim per (kind, window_start) and refuses the second', async () => {
      const first = await insert('window_posts', { kind: 'last-week', window_start: windowStart });
      expect(first.status).toBe(201);
      expect(rows(first.body)[0]?.posted_at).toBeNull();
      expect(rows(first.body)[0]?.attempts).toBe(1);

      const second = await insert('window_posts', { kind: 'last-week', window_start: windowStart });
      expect(second.ok).toBe(false);
      // 23505, the unique violation PostgREST answers 409 for: the loser of two calls in the
      // same second posts nothing.
      expect(second.status).toBe(409);

      // The same start under the other kind is a different window and is allowed: a Sunday the
      // 1st claims a week and a month, and they are two rows.
      const month = await insert('window_posts', { kind: 'last-month', window_start: windowStart });
      expect(month.status).toBe(201);

      const all = await rest(
        'service',
        `window_posts?window_start=eq.${encodeURIComponent(windowStart)}&select=kind`,
      );
      expect(rows(all.body)).toHaveLength(2);
    });

    it('refuses a kind that is not one of the two closed windows', async () => {
      // `this-week` never closes, so nothing can have posted it.
      const result = await insert('window_posts', { kind: 'this-week', window_start: windowStart });
      expect(result.ok).toBe(false);
    });
  });

  describe('bootstrap_admin', () => {
    it('promotes an existing player and is idempotent', async () => {
      const first = await rest('service', 'rpc/bootstrap_admin', {
        method: 'POST',
        body: JSON.stringify({ p_puuid: puuidA }),
      });
      expect(first.ok).toBe(true);
      expect((first.body as { is_admin?: boolean }).is_admin).toBe(true);

      const second = await rest('service', 'rpc/bootstrap_admin', {
        method: 'POST',
        body: JSON.stringify({ p_puuid: puuidA }),
      });
      expect(second.ok).toBe(true);
      expect((second.body as { id?: string }).id).toBe((first.body as { id?: string }).id);

      const all = await rest('service', `players?puuid=eq.${puuidA}&select=id,is_admin`);
      expect(rows(all.body)).toHaveLength(1);
      expect(rows(all.body)[0]?.is_admin).toBe(true);
    });

    it('creates the player when the puuid is new, exactly once', async () => {
      const puuid = `${runId}-new-admin`;
      await rest('service', 'rpc/bootstrap_admin', {
        method: 'POST',
        body: JSON.stringify({ p_puuid: puuid }),
      });
      await rest('service', 'rpc/bootstrap_admin', {
        method: 'POST',
        body: JSON.stringify({ p_puuid: puuid }),
      });

      const all = await rest('service', `players?puuid=eq.${puuid}&select=id,is_admin`);
      expect(rows(all.body)).toHaveLength(1);
      expect(rows(all.body)[0]?.is_admin).toBe(true);
    });

    it('cannot be called by anon', async () => {
      const result = await rest('anon', 'rpc/bootstrap_admin', {
        method: 'POST',
        body: JSON.stringify({ p_puuid: `${runId}-anon-admin` }),
      });
      expect(result.ok).toBe(false);
    });
  });
}
