import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensurePlayers } from '@/lib/ingest/players';
import { type ClosedWindow, closedWindow } from '@/lib/night';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `GET /api/cron/window` against the local Supabase stack (M5.13): the whole point of the
 * route, which is that **the week posts itself exactly once** however often the thing outside
 * the app decides to call it.
 *
 * What is only provable here, with a real `window_posts` table and a real webhook:
 *
 * - three calls across one Sunday post one message and write one row;
 * - a window with no games is recorded and never posted, and never retried;
 * - a webhook that refuses leaves the row unposted, so a later call sends the week late.
 *
 * The clock is faked to a Sunday in 2025 — the day a week closes on since M5.34 — and every
 * window this file touches is a week or a month nothing else in the suite has games in. Only
 * `Date` is faked: the sockets to Supabase and to the webhook are real.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the window post against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';
  process.env.CRON_SECRET = 'it-window-secret';
  // The post links to the board it printed, and `siteOrigin` drops a localhost request origin:
  // without a configured site URL the embed would carry no link at all. `siteOrigin` reads it
  // through `readAuthEnv`, which wants the anon key beside it.
  process.env.NEXT_PUBLIC_SITE_URL = 'https://customs.example';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { GET } = await import('./route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  const guildId = `it-${runId}-window`;
  const puuids = Array.from({ length: 10 }, (_, index) => `it-${runId}-w${String(index).padStart(2, '0')}`);

  /**
   * Four Sundays (and one 1st) in 2025, one per case, so no two cases share a window and
   * nothing else in the suite has a game anywhere near them.
   *
   * **Sundays since M5.34**: a week closes at 06:00 on a Sunday, so the morning a post is due
   * is a Sunday morning. Nothing in the route reads the day — these instants are simply the
   * hours a real call would land in.
   */
  const SUNDAY = new Date('2025-09-07T07:00:00Z'); // 10:00 Cairo, Sunday 7 September
  const EMPTY_SUNDAY = new Date('2025-07-13T07:00:00Z'); // 10:00 Cairo, Sunday 13 July
  const FLAKY_SUNDAY = new Date('2025-05-11T07:00:00Z'); // 10:00 Cairo, Sunday 11 May
  const FIRST_OF_MONTH = new Date('2025-11-01T12:00:00Z'); // Saturday 1 November, after 06:00
  const AWARDS_SUNDAY = new Date('2025-03-09T07:00:00Z'); // 09:00 Cairo, Sunday 9 March

  const windowsTouched: ClosedWindow[] = [
    closedWindow('last-week', SUNDAY, TIME_ZONE),
    closedWindow('last-week', EMPTY_SUNDAY, TIME_ZONE),
    closedWindow('last-week', FLAKY_SUNDAY, TIME_ZONE),
    closedWindow('last-week', FIRST_OF_MONTH, TIME_ZONE),
    closedWindow('last-month', FIRST_OF_MONTH, TIME_ZONE),
    closedWindow('last-week', AWARDS_SUNDAY, TIME_ZONE),
  ];

  let playerIds: string[] = [];
  let seasonId = '';
  let webhookUrl = '';
  let server: Server | null = null;
  let posts: Record<string, unknown>[] = [];
  const gameIds: number[] = [];
  /** What the webhook does with the next post. The failure case flips it. */
  let answer: (response: ServerResponse) => void = (response) => response.writeHead(204).end();

  function request(bearer = 'it-window-secret'): Request {
    return new Request('http://localhost/api/cron/window', {
      headers: { authorization: `Bearer ${bearer}` },
    });
  }

  interface RouteBody {
    ok: boolean;
    posted: string[];
    skipped: { kind: string; reason: string }[];
  }

  /**
   * One call, with the clock at `instant`. Only `Date` is faked — the route's `now` and every
   * `claimed_at` it writes are that instant, while the sockets underneath stay real.
   */
  async function callAt(instant: Date, bearer?: string): Promise<RouteBody> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);
    try {
      const response = await GET(request(bearer));
      return (await response.json()) as RouteBody;
    } finally {
      vi.useRealTimers();
    }
  }

  async function rowsFor(window: ClosedWindow) {
    const { data } = await db
      .from('window_posts')
      .select('kind, window_start, posted_at, attempts, reason')
      .eq('kind', window.kind)
      .eq('window_start', window.key);
    return data ?? [];
  }

  /** A rated game inside a window: ten players, five a side, every rating column written. */
  async function seedGame(startedAt: Date): Promise<void> {
    const lcuGameId = Math.floor(Math.random() * 1_000_000_000) + 8_000_000_000;
    gameIds.push(lcuGameId);
    const { data, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        season_id: seasonId,
        started_at: startedAt.toISOString(),
        duration_s: 1_800,
        winning_side: 100,
        source: 'eog',
        raw: { gameId: lcuGameId },
      })
      .select('id')
      .single();
    if (error) throw new Error(`seeding a game: ${error.message}`);

    const { error: playersError } = await db.from('game_players').insert(
      playerIds.map((playerId, index) => ({
        game_id: data.id,
        player_id: playerId,
        side: index < 5 ? 100 : 200,
        kills: 3,
        deaths: 3,
        assists: 3,
        // Rated: this is what "the fold counted this game" looks like on a stored row, and it
        // is what puts the player on the window's board.
        mu_before: 25,
        sigma_before: 8.333,
        mu_after: index < 5 ? 26 : 24,
        sigma_after: 8.1,
      })),
    );
    if (playersError) throw new Error(`seeding a scoreboard: ${playersError.message}`);
  }

  /**
   * A week with enough in it to hand out awards (M5.4): six games, the same ten, the sides
   * rotating so the pairs and the roles vary the way a real week does.
   *
   * `Window0` climbs `1266 → 1478` on the **stored** track — `mu` 21.1 to 24.6333, the numbers
   * the pages would have printed — and everybody else stands still. Since M7.4 a week's
   * `Most improved` is not read off those columns: the rotation is what decides it, because the
   * weekly fold starts all ten at their seed and the winner is whoever the six games left
   * furthest above it. `Window1`'s main is top and they play jungle all week, which is the
   * off-role award.
   */
  async function seedAwardsGame(startedAt: Date, index: number): Promise<void> {
    const lcuGameId = Math.floor(Math.random() * 1_000_000_000) + 7_000_000_000;
    gameIds.push(lcuGameId);
    const { data, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        season_id: seasonId,
        started_at: startedAt.toISOString(),
        duration_s: 1_800,
        winning_side: index % 2 === 0 ? 100 : 200,
        source: 'eog',
        raw: { gameId: lcuGameId },
      })
      .select('id')
      .single();
    if (error) throw new Error(`seeding an awards game: ${error.message}`);

    const lanes = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
    // The ten, rotated one seat per game: a different five a side every night.
    const order = [...playerIds.slice(index % 10), ...playerIds.slice(0, index % 10)];

    const { error: playersError } = await db.from('game_players').insert(
      order.map((playerId, seat) => ({
        game_id: data.id,
        player_id: playerId,
        side: seat < 5 ? 100 : 200,
        // `Window1` is on jungle every game, whatever seat the rotation gives them.
        role: playerId === playerIds[1] ? ('jungle' as const) : (lanes[seat % 5] as (typeof lanes)[number]),
        kills: 3,
        deaths: 3,
        assists: 3,
        mu_before: playerId === playerIds[0] ? (index === 0 ? 21.1 : 24.4) : 25,
        sigma_before: 8.333,
        mu_after: playerId === playerIds[0] ? (index === 5 ? 24.6333333 : 24.4) : 25,
        sigma_after: 8.1,
      })),
    );
    if (playersError) throw new Error(`seeding an awards scoreboard: ${playersError.message}`);
  }

  /** The embed of the last post, or undefined. */
  function embedOf(index: number): Record<string, unknown> | undefined {
    const embeds = posts[index]?.embeds as Record<string, unknown>[] | undefined;
    return embeds?.[0];
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      puuids.map((puuid, index) => ({ puuid, gameName: `Window${index}`, tagLine: 'EUW' })),
    );
    playerIds = puuids.map((puuid) => ids.get(puuid) ?? '');

    const { data: season, error } = await db.from('seasons').select('id').eq('is_active', true).single();
    if (error) throw new Error(`no active season: ${error.message}`);
    seasonId = season.id;

    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        answer(response);
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;

    // Leftovers from an interrupted run would win the "oldest row with a webhook" rule.
    await db.from('discord_config').delete().like('guild_id', 'it-%');
    const { count } = await db
      .from('discord_config')
      .select('guild_id', { count: 'exact', head: true })
      .not('webhook_url', 'is', null);
    if ((count ?? 0) > 0) {
      throw new Error(
        'a discord_config row with a webhook already exists; this test would not be the one used',
      );
    }
    await db.from('discord_config').insert({ guild_id: guildId, webhook_url: webhookUrl });

    // A window is keyed by its own start, so it cannot be namespaced by run: clear the rows a
    // previous interrupted run of this file left behind before claiming anything.
    for (const window of windowsTouched) {
      await db.from('window_posts').delete().eq('kind', window.kind).eq('window_start', window.key);
    }

    // Two games in the week that closed on `SUNDAY`, one in the flaky week, and one that is in
    // both windows the 1st of November considers.
    await seedGame(new Date('2025-09-03T18:00:00Z'));
    await seedGame(new Date('2025-09-05T19:00:00Z'));
    await seedGame(new Date('2025-05-07T19:00:00Z'));
    await seedGame(new Date('2025-10-22T19:00:00Z'));

    // Six games in the week that closed on `AWARDS_SUNDAY`, Monday to Saturday.
    for (let index = 0; index < 6; index += 1) {
      await seedAwardsGame(new Date(`2025-03-0${3 + index}T19:00:00Z`), index);
    }
    // One main role in that week, so the off-role award has somebody to consider.
    await db
      .from('players')
      .update({ main_role: 'top' })
      .eq('id', playerIds[1] as string);
  });

  afterAll(async () => {
    vi.useRealTimers();
    for (const window of windowsTouched) {
      await db.from('window_posts').delete().eq('kind', window.kind).eq('window_start', window.key);
    }
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await db.from('players').delete().in('puuid', puuids);
    await db.from('discord_config').delete().eq('guild_id', guildId);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    posts = [];
    answer = (response) => response.writeHead(204).end();
  });

  describe('the week posts itself exactly once', () => {
    /**
     * The acceptance check the whole task is written for: **call it at any cadence.** Three
     * calls across one Sunday, and the group sees one message.
     */
    it('posts on the first call of a Sunday and nothing on the next two', async () => {
      const window = closedWindow('last-week', SUNDAY, TIME_ZONE);

      const first = await callAt(SUNDAY);
      expect(first).toEqual({ ok: true, posted: ['last-week'], skipped: [] });

      const second = await callAt(new Date(SUNDAY.getTime() + 60 * 60 * 1_000));
      const third = await callAt(new Date(SUNDAY.getTime() + 5 * 60 * 60 * 1_000));
      expect(second).toEqual({
        ok: true,
        posted: [],
        skipped: [{ kind: 'last-week', reason: 'already posted' }],
      });
      expect(third).toEqual(second);

      // One message in the channel and one row in the table, after three calls.
      expect(posts).toHaveLength(1);
      const rows = await rowsFor(window);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.posted_at).not.toBeNull();
      expect(rows[0]?.reason).toBeNull();

      /**
       * And the one message names its own week: the description is the same line the page
       * prints under its picker, and the count is the window's counted games — the two seeded
       * inside it, never a lifetime total.
       */
      const embed = embedOf(0);
      expect(embed?.title).toBe('Last week · leaderboard');
      expect(embed?.description).toBe('Sunday 31 Aug to Saturday 6 Sep · 2 games');
      expect(String(embed?.url ?? '')).toContain('/leaderboard?window=last-week');
      // Ten players, five a side, two games each: the board is the window's, not all time.
      const fields = (embed?.fields ?? []) as { value: string }[];
      const lines = String(fields[0]?.value ?? '').split('\n');
      expect(lines).toHaveLength(10);
      expect(lines[0]).toContain('· 2 games');
    });
  });

  /**
   * **The awards field is M5.4's three lines, quoted** (M5.10): the post the group reads on a
   * Sunday and the page they open a tap later are the same words, and an award nobody won still
   * prints its sentence, so the block always has three labels and the bar they missed is on
   * screen.
   */
  describe('the awards under the board', () => {
    it('prints all three, computed from the week it just posted', async () => {
      const posted = await callAt(AWARDS_SUNDAY);
      expect(posted.posted).toEqual(['last-week']);

      const embed = embedOf(0);
      expect(embed?.description).toBe('Sunday 2 Mar to Saturday 8 Mar · 6 games');

      const fields = (embed?.fields ?? []) as { name: string; value: string }[];
      expect(fields).toHaveLength(2);
      expect(fields[1]?.name).toBe('Awards');

      const lines = String(fields[1]?.value ?? '').split('\n');
      const labelled = lines.filter((line) => line.startsWith('**'));
      expect(labelled.map((line) => line.slice(0, line.indexOf('**', 2) + 2))).toEqual([
        '**Most improved**',
        '**Best off-role**',
        '**Cursed duo**',
      ]);

      /**
       * **The weekly numbers, in the post** (M7.4). `Most improved` on a week is the weekly
       * track: everybody starts the week at their seed — these ten are unranked, so `1200` —
       * and `rateGameWeekly` folds the six games, which leaves `Window4` furthest above where
       * their week began.
       *
       * The stored `mu` columns on those same rows say `Window0` went `1266 → 1478`, which is
       * the all-time track's answer and the one the month post prints. If that line ever comes
       * back on a Sunday, a week is being posted with an all-time number in it.
       */
      expect(labelled[0]).toBe('**Most improved** Window4 · +192 · 1200 → 1392');
      expect(fields[1]?.value).not.toContain('1266 → 1478');
      // Window1's main is top and they played jungle in all six.
      expect(labelled[1]).toMatch(/^\*\*Best off-role\*\* Window1 · \d+W \d+L · \d+% · their main is top$/);
      // Whoever it is, the pair line is a pair and a record — or the sentence nobody won it.
      expect(labelled[2]).toMatch(
        /^\*\*Cursed duo\*\* (.+ and .+ · \d+W \d+L · \d+%|No pair played 4 games together this week\.)$/,
      );
      // ASCII in a message that gets copy-pasted: U+2212 stays on the web (05-design.md).
      expect(fields[1]?.value).not.toContain('−');

      /**
       * **M7.4, acceptance 4**: replay the Sunday and the group still sees the week once.
       *
       * The weekly climb is folded at read time rather than stored, so the thing to be sure of
       * is that a second call neither posts a second message nor writes a second row, and that
       * the message standing in the channel still carries the numbers the first read produced.
       */
      const again = await callAt(new Date(AWARDS_SUNDAY.getTime() + 60 * 60 * 1_000));
      expect(again).toEqual({
        ok: true,
        posted: [],
        skipped: [{ kind: 'last-week', reason: 'already posted' }],
      });
      expect(posts).toHaveLength(1);
      expect(await rowsFor(closedWindow('last-week', AWARDS_SUNDAY, TIME_ZONE))).toHaveLength(1);
      expect(((embedOf(0)?.fields ?? []) as { value: string }[])[1]?.value).toBe(fields[1]?.value);
    });
  });

  /**
   * **A window with no games produces no post** and is recorded anyway (M5.13, edge case 2):
   * unstamped, an empty week would be retried every hour for seven days, and there is nothing
   * there to find.
   */
  describe('a window with no games', () => {
    it('writes the row, posts nothing, and is not retried', async () => {
      const window = closedWindow('last-week', EMPTY_SUNDAY, TIME_ZONE);

      const first = await callAt(EMPTY_SUNDAY);
      expect(first).toEqual({
        ok: true,
        posted: [],
        skipped: [{ kind: 'last-week', reason: 'no games in the window' }],
      });
      expect(posts).toHaveLength(0);

      const rows = await rowsFor(window);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.posted_at).not.toBeNull();
      expect(rows[0]?.reason).toBe('no games in the window');

      // An hour later, and a day later: still nothing, and still one row.
      const later = await callAt(new Date(EMPTY_SUNDAY.getTime() + 60 * 60 * 1_000));
      expect(later.skipped).toEqual([{ kind: 'last-week', reason: 'already posted' }]);
      expect(posts).toHaveLength(0);
      expect(await rowsFor(window)).toHaveLength(1);
    });
  });

  /**
   * **A webhook failure is not a posted week** (M5.13, acceptance 2). The claim row stays
   * unposted so a later call sends the week late — and a call *while the first is still in
   * flight* posts nothing, which is the other half of the same rule.
   */
  describe('a webhook that would not take it', () => {
    it('leaves the week retryable, and a later call posts it', async () => {
      const window = closedWindow('last-week', FLAKY_SUNDAY, TIME_ZONE);
      answer = (response) => response.writeHead(500).end();

      const failed = await callAt(FLAKY_SUNDAY);
      expect(failed.posted).toEqual([]);
      expect(failed.skipped[0]?.kind).toBe('last-week');
      expect(failed.skipped[0]?.reason).toBe('HTTP 500');
      // One try and one retry, both refused: nothing landed.
      expect(posts).toHaveLength(2);

      const claimed = await rowsFor(window);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.posted_at).toBeNull();
      expect(claimed[0]?.reason).toBe('HTTP 500');

      // A call a minute later must not race the one that may still be talking to Discord.
      answer = (response) => response.writeHead(204).end();
      posts = [];
      const tooSoon = await callAt(new Date(FLAKY_SUNDAY.getTime() + 60 * 1_000));
      expect(tooSoon.skipped).toEqual([
        { kind: 'last-week', reason: 'a post for this window is already in flight' },
      ]);
      expect(posts).toHaveLength(0);

      // The next hourly call, with Discord back: the week goes out late and correct.
      const retried = await callAt(new Date(FLAKY_SUNDAY.getTime() + 60 * 60 * 1_000));
      expect(retried.posted).toEqual(['last-week']);
      expect(posts).toHaveLength(1);
      expect(embedOf(0)?.description).toBe('Sunday 4 May to Saturday 10 May · 1 game');

      const stamped = await rowsFor(window);
      expect(stamped).toHaveLength(1);
      expect(stamped[0]?.posted_at).not.toBeNull();
      expect(stamped[0]?.attempts).toBe(2);

      // And it stays posted: the retry does not reopen the window.
      const after = await callAt(new Date(FLAKY_SUNDAY.getTime() + 2 * 60 * 60 * 1_000));
      expect(after.skipped).toEqual([{ kind: 'last-week', reason: 'already posted' }]);
      expect(posts).toHaveLength(1);
    });
  });

  /**
   * **On the 1st, the week and the month, week first** (M5.13, acceptance 3): on a Sunday the
   * 1st the group gets two posts in the order they read in. Here it is a Saturday the 1st, so
   * the week is one that closed six days earlier and the month is the one that closed today —
   * and, because Cairo left daylight saving between them, the two boundaries are at different
   * UTC offsets, which is exactly the case `lib/night.ts` owns and this must not re-solve.
   */
  describe('the 1st of a month', () => {
    it('posts both, week first, and each of them once', async () => {
      const week = closedWindow('last-week', FIRST_OF_MONTH, TIME_ZONE);
      const month = closedWindow('last-month', FIRST_OF_MONTH, TIME_ZONE);

      const first = await callAt(FIRST_OF_MONTH);
      expect(first.posted).toEqual(['last-week', 'last-month']);
      expect(posts).toHaveLength(2);
      expect(embedOf(0)?.title).toBe('Last week · leaderboard');
      expect(embedOf(0)?.description).toBe('Sunday 19 Oct to Saturday 25 Oct · 1 game');
      expect(embedOf(1)?.title).toBe('Last month · leaderboard');
      expect(embedOf(1)?.description).toBe('October · 1 game');

      expect(await rowsFor(week)).toHaveLength(1);
      expect(await rowsFor(month)).toHaveLength(1);

      const again = await callAt(new Date(FIRST_OF_MONTH.getTime() + 3 * 60 * 60 * 1_000));
      expect(again.posted).toEqual([]);
      expect(again.skipped).toEqual([
        { kind: 'last-week', reason: 'already posted' },
        { kind: 'last-month', reason: 'already posted' },
      ]);
      expect(posts).toHaveLength(2);
    });

    /** On the 2nd only the week is considered: yesterday's month is no longer news. */
    it('looks at the week alone on the 2nd', async () => {
      const body = await callAt(new Date('2025-11-02T12:00:00Z'));

      expect([...body.posted, ...body.skipped.map((skip) => skip.kind)]).toEqual(['last-week']);
    });
  });

  describe('the door', () => {
    it('answers 401 for the wrong secret and writes nothing', async () => {
      const window = closedWindow('last-week', new Date('2025-06-09T07:00:00Z'), TIME_ZONE);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2025-06-09T07:00:00Z'));
      const response = await GET(request('not-the-secret'));
      vi.useRealTimers();

      expect(response.status).toBe(401);
      expect(posts).toHaveLength(0);
      expect(await rowsFor(window)).toHaveLength(0);
    });
  });
}
