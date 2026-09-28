import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SWITCH_SIDE_ENABLED } from '../commands/gate';
import { mintCompanionToken } from '../companionAuth';
import { FEARLESS_TITLE } from '../fearless/copy';
import { ensurePlayers } from '../ingest/players';
import { ROSTER_STABLE_MS } from '../lobbyState';
import { nightStart } from '../night';
import { eogBody, testGameId } from '../testing/fixtures';
import { resolveLocalStack } from '../testing/localStack';
import { sideLine } from './embeds';

/**
 * M3.1 and M3.3 end to end: the companion posts a lobby through the real route, the state
 * machine balances, and one teams embed lands on a webhook that is a real HTTP server in this
 * process. Then the end-of-game block, and the result embed.
 *
 * What it is here to prove, beyond "a message arrives":
 *
 * - **exactly one** post per transition, whatever the companion does;
 * - a webhook that answers 500 changes neither the lobby response nor the stored state;
 * - no `discord_config` row means no post and no error.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the Discord webhook against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  // Importing the routes is what registers the Discord hooks (`lib/ingest/discord.ts`).
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { resetWebhookWarning } = await import('./webhook');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  /** The same zone the routes read out of `CUSTOMS_NIGHT_TZ` above. */
  const TIME_ZONE = 'Africa/Cairo';
  const guildId = `it-${runId}-guild`;
  const puuids = Array.from({ length: 10 }, (_, index) => `it-${runId}-dc${String(index).padStart(2, '0')}`);
  /** Eleven of their own, so no other case's rotation or ratings can order this one. */
  const eleven = Array.from({ length: 11 }, (_, index) => `it-${runId}-el${String(index).padStart(2, '0')}`);
  /** Ten more, one of whom the client has never named (M3.15). */
  const nameless = Array.from(
    { length: 10 },
    (_, index) => `it-${runId}-nn${String(index).padStart(2, '0')}`,
  );
  const allPuuids = [...puuids, ...eleven, ...nameless];
  const partyIds = new Set<string>();
  const gameIds = new Set<number>();

  let token = '';
  /** A token owned by one of the eleven: a companion may only report a lobby it is in (M1.8). */
  let elevenToken = '';
  /** The same rule again, for the lobby with a nameless player in it. */
  let namelessToken = '';
  let webhookUrl = '';
  let server: Server | null = null;
  let posts: { body: Record<string, unknown> }[] = [];
  let answer: (response: ServerResponse) => void = (response) => response.writeHead(204).end();

  function party(name: string): string {
    const id = `dc-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function gameNumber(): number {
    const id = testGameId() + gameIds.size;
    gameIds.add(id);
    return id;
  }

  interface MemberSpec {
    puuid: string;
    isSpectator?: boolean;
    /** The lobby carries no Riot ID for this one: `players` keeps both name columns null. */
    unnamed?: boolean;
  }

  function lobbyBody(partyId: string, members: readonly (string | MemberSpec)[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs-night',
      members: members.map((member, index) => {
        const spec = typeof member === 'string' ? { puuid: member } : member;
        return {
          puuid: spec.puuid,
          gameName: spec.unnamed ? null : `Player${index}`,
          tagLine: spec.unnamed ? null : 'EUW',
          summonerId: 3_000 + index,
          side: spec.isSpectator ? null : index < 5 ? 100 : 200,
          isSpectator: spec.isSpectator ?? false,
        };
      }),
    };
  }

  function request(json: unknown, bearer: string = token): Request {
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(json),
    });
  }

  /**
   * The stability clock is the lobby row's own `updated_at`, written by Postgres, so every
   * "ten seconds later" is measured from that column rather than from the test's wall clock.
   * Only `Date` is faked: the sockets to Supabase and to the webhook are real.
   */
  async function clockAt(lobbyId: string, offsetMs: number): Promise<number> {
    const { data, error } = await db.from('lobbies').select('updated_at').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return Date.parse(data.updated_at) + offsetMs;
  }

  /**
   * An instant that is inside **tonight**, whatever o'clock it is when the suite runs (M3.24).
   *
   * A night runs 06:00 to 06:00 in `CUSTOMS_NIGHT_TZ` (`night.ts`), and "games tonight" is
   * `games.started_at >= nightStart(now)`. A game posted at a plain `now - 60_000` therefore
   * falls into *last* night for the sixty seconds after 06:00 local — which is where this
   * suite was run on 2026-09-09 at 06:00:41 Cairo, `gamesTonight` came back 0 for everybody,
   * and the case below read the tied-on-games clause instead of the one it is about.
   *
   * So: a minute ago, or the start of tonight if a minute ago is on the other side of it.
   * Nothing reads `started_at` with an upper bound, so the second branch being at most a
   * second "ahead" of the clock in the first second of a night costs nothing.
   */
  function insideTonight(now: Date): string {
    return new Date(
      Math.max(now.getTime() - 60_000, nightStart(now, TIME_ZONE).getTime() + 1_000),
    ).toISOString();
  }

  /**
   * Run `body` with `Date` faked to `at`, and hand it that instant. Only `Date` is faked, as
   * everywhere else in this file: the sockets to Supabase and to the webhook stay real, and
   * the database keeps writing its own `now()`.
   *
   * The clock only ever moves **backwards** here (to the start of tonight), which matters on
   * a shared local stack: the idle sweep every companion post runs takes its cutoff from this
   * clock, so an earlier one can only sweep fewer rows, never more.
   */
  async function withClockAt<T>(at: number, body: (now: Date) => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    try {
      return await body(new Date(at));
    } finally {
      vi.useRealTimers();
    }
  }

  async function lobbyIdOf(response: Response): Promise<string> {
    const body = (await response.clone().json()) as { lobbyId: string };
    return body.lobbyId;
  }

  /** The two posts a lobby needs: one to open it, one ten seconds later to balance it. */
  async function driveToBalanced(
    partyId: string,
    members: readonly (string | MemberSpec)[] = puuids,
    bearer: string = token,
  ): Promise<Response> {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = await postLobby(request(lobbyBody(partyId, members), bearer));
      expect(first.status).toBe(200);

      vi.setSystemTime(await clockAt(await lobbyIdOf(first), ROSTER_STABLE_MS + 1_000));
      return await postLobby(request(lobbyBody(partyId, members), bearer));
    } finally {
      vi.useRealTimers();
    }
  }

  /** The fields of the single embed of a post, by name. */
  function fieldsOf(index: number): Record<string, string> {
    const embed = ((posts[index]?.body.embeds ?? []) as Record<string, unknown>[])[0];
    const fields = (embed?.fields ?? []) as { name: string; value: string }[];
    return Object.fromEntries(fields.map((field) => [field.name, field.value]));
  }

  /** The ten lines of the two side fields, whose names carry a sum that is not the subject. */
  function teamLines(index: number): string[] {
    return Object.entries(fieldsOf(index))
      .filter(([name]) => name.startsWith('Blue · ') || name.startsWith('Red · '))
      .flatMap(([, value]) => value.split('\n'));
  }

  /** Field-for-field stable: the timestamp and the season's game count are not. */
  function normalise(body: Record<string, unknown>): unknown {
    const embeds = (body.embeds as Record<string, unknown>[]).map((embed) => ({
      ...embed,
      timestamp: '<timestamp>',
      footer: { text: String((embed.footer as { text: string }).text).replace(/game \d+/, 'game <n>') },
    }));
    return { ...body, embeds };
  }

  beforeAll(async () => {
    await ensurePlayers(
      db,
      allPuuids.map((puuid) => ({ puuid })),
    );
    async function mintFor(puuid: string): Promise<string> {
      const { data } = await db.from('players').select('id').eq('puuid', puuid).single();
      const { token: raw, tokenHash } = mintCompanionToken();
      const { error } = await db
        .from('companion_tokens')
        .insert({ player_id: data?.id ?? '', token_hash: tokenHash, label: `dc-${runId}` });
      if (error) throw new Error(error.message);
      return raw;
    }

    token = await mintFor(puuids[0] ?? '');
    elevenToken = await mintFor(eleven[5] ?? '');
    namelessToken = await mintFor(nameless[0] ?? '');

    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
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

    const { error: configError } = await db
      .from('discord_config')
      .insert({ guild_id: guildId, webhook_url: webhookUrl });
    if (configError) throw new Error(configError.message);
  });

  afterEach(() => {
    posts = [];
    answer = (response) => response.writeHead(204).end();
    resetWebhookWarning();
  });

  afterAll(async () => {
    await db.from('discord_config').delete().eq('guild_id', guildId);
    await db
      .from('games')
      .delete()
      .in('lcu_game_id', [...gameIds]);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', allPuuids);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  describe('a night, from the tenth join to the result', () => {
    it('posts one teams embed on balanced, and nothing more when the companion posts again', async () => {
      const id = party('night');
      const balanced = await driveToBalanced(id);

      expect(balanced.status).toBe(200);
      expect(await balanced.json()).toMatchObject({ ok: true, status: 'balanced' });
      expect(posts).toHaveLength(1);
      expect(normalise(posts[0]?.body ?? {})).toMatchSnapshot();

      // The companion keeps posting the same lobby; the transition has already happened.
      const again = await postLobby(request(lobbyBody(id, puuids)));
      expect(again.status).toBe(200);
      expect(posts).toHaveLength(1);
    });

    it('posts one result embed when the end-of-game block is rated, and none on a re-post', async () => {
      const id = party('night');
      const gameId = gameNumber();
      const body = eogBody({ gameId, puuids, partyId: id, winningSide: 200 });

      const first = await postGame(request(body));
      expect(first.status).toBe(200);
      expect(posts).toHaveLength(1);

      const posted = posts[0]?.body ?? {};
      const embed = (posted.embeds as Record<string, unknown>[])[0];
      expect(embed?.title).toBe('Red wins · 32:00');
      expect(normalise(posted)).toMatchSnapshot();

      // The second companion in the same game: stored, rated and posted by nobody.
      const second = await postGame(request(body));
      expect(second.status).toBe(200);
      expect(posts).toHaveLength(1);
    });
  });

  describe('when Discord is not there', () => {
    it('answers 200 and stores the splits when the webhook 500s', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      answer = (response) => response.writeHead(500).end('nope');

      const id = party('five-hundred');
      const balanced = await driveToBalanced(id);
      const payload = (await balanced.json()) as { lobbyId: string; status: string };

      expect(balanced.status).toBe(200);
      expect(payload.status).toBe('balanced');
      // Tried twice, then given up on.
      expect(posts).toHaveLength(2);

      const { data: lobby } = await db.from('lobbies').select('status').eq('id', payload.lobbyId).single();
      expect(lobby?.status).toBe('balanced');
      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', payload.lobbyId);
      expect(count).toBe(3);
      vi.restoreAllMocks();
    });

    it('posts nothing at all when no webhook is configured', async () => {
      const { error } = await db.from('discord_config').update({ webhook_url: null }).eq('guild_id', guildId);
      if (error) throw new Error(error.message);

      try {
        const id = party('no-config');
        const balanced = await driveToBalanced(id);
        const payload = (await balanced.json()) as { lobbyId: string; status: string };

        expect(payload.status).toBe('balanced');
        expect(posts).toHaveLength(0);
        const { count } = await db
          .from('splits')
          .select('id', { count: 'exact', head: true })
          .eq('lobby_id', payload.lobbyId);
        expect(count).toBe(3);
      } finally {
        await db.from('discord_config').update({ webhook_url: webhookUrl }).eq('guild_id', guildId);
      }
    });
  });

  describe('the cases that must not post', () => {
    it('posts nothing for nine around: no balance, no splits, and the companion still gets 200', async () => {
      const id = party('nine');
      vi.useFakeTimers({ toFake: ['Date'] });
      let lobbyId = '';
      try {
        const first = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(first.status).toBe(200);
        lobbyId = await lobbyIdOf(first);

        vi.setSystemTime(await clockAt(lobbyId, ROSTER_STABLE_MS + 60_000));
        const later = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(later.status).toBe(200);
        expect(await later.json()).toMatchObject({ status: 'open', memberCount: 9 });
      } finally {
        vi.useRealTimers();
      }

      expect(posts).toHaveLength(0);
      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId);
      expect(count).toBe(0);
    });

    it('posts no result for a game the fold refused: 200 seconds, and nine on the scoreboard', async () => {
      const short = eogBody({ gameId: gameNumber(), puuids, partyId: null, durationS: 200 });
      const shortResponse = await postGame(request(short));
      expect(shortResponse.status).toBe(200);
      expect(await shortResponse.json()).toMatchObject({ created: true });
      expect(posts).toHaveLength(0);

      const nine = eogBody({ gameId: gameNumber(), puuids: puuids.slice(0, 9), partyId: null });
      const nineResponse = await postGame(request(nine));
      expect(nineResponse.status).toBe(200);
      expect(await nineResponse.json()).toMatchObject({ created: true, participants: 9 });
      expect(posts).toHaveLength(0);
    });
  });

  describe('the cases that post more than once', () => {
    it('posts a second embed when somebody leaves and the lobby rebalances', async () => {
      const id = party('rebalance');
      const balanced = await driveToBalanced(id);
      expect(await lobbyIdOf(balanced)).toBeTruthy();
      expect(posts).toHaveLength(1);

      const lobbyId = await lobbyIdOf(balanced);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // One leaves: the roster's identity changed, so the lobby is `open` and the clock restarts.
        const left = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(await left.json()).toMatchObject({ status: 'open', memberCount: 9 });
        expect(posts).toHaveLength(1);

        // They come back, and ten seconds later there are teams again.
        const rejoined = await postLobby(request(lobbyBody(id, puuids)));
        expect(await rejoined.json()).toMatchObject({ status: 'open', memberCount: 10 });

        vi.setSystemTime(await clockAt(lobbyId, ROSTER_STABLE_MS + 1_000));
        const again = await postLobby(request(lobbyBody(id, puuids)));
        expect(await again.json()).toMatchObject({ status: 'balanced' });
      } finally {
        vi.useRealTimers();
      }

      // Two messages in the channel is the honest record: M3.1 edits and deletes nothing.
      expect(posts).toHaveLength(2);
      expect(fieldsOf(1)).toHaveProperty('Lobby');

      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId);
      expect(count).toBe(6);
      const { count: chosen } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId)
        .eq('is_chosen', true);
      expect(chosen).toBe(1);
    });
  });

  describe('eleven around', () => {
    it('names who sits and who swaps in, in M2.15 copy', async () => {
      const id = party('eleven');
      // Everyone has played the same number tonight (none), so the rotation falls through to
      // puuid order: `el00` sits. The spectator is somebody else, so they are one of the ten
      // and have to take the seat that just came free.
      const members = eleven.map((puuid, index) => ({ puuid, isSpectator: index === 10 }));
      const balanced = await driveToBalanced(id, members, elevenToken);

      expect(await balanced.json()).toMatchObject({ status: 'balanced', memberCount: 11 });
      expect(posts).toHaveLength(1);

      // The first balance of a night for these eleven: tied on games *and* nobody carrying a
      // sit-out, which is exactly the case M3.12 gave its own clause. `longest since they last
      // sat out` was true here and vacuous — the comparator had fallen through to puuid order.
      const fields = fieldsOf(0);
      expect(fields['Sitting out']).toBe(
        'Sitting out: Player0 — nobody has sat out before, so somebody had to be first.',
      );
      // The move, then M4.3's side line. The whole pipeline runs here, so the sentence is the
      // one the shipped gate picks: `sideLine(SWITCH_SIDE_ENABLED)`, not a literal that has to
      // be rewritten the day a patch turns a write back off.
      expect(fields.Seats).toBe(`Swap: Player0 out, Player10 in.\n${sideLine(SWITCH_SIDE_ENABLED)}`);

      // The ten in the two side fields are the other ten, and the sitter is in neither.
      const lines = teamLines(0);
      expect(lines).toHaveLength(10);
      expect(lines.some((line) => line.includes('Player0 ·'))).toBe(false);
      expect(lines.some((line) => line.includes('Player10 ·'))).toBe(true);
    });

    it('goes back to the most-games clause once one game has been played (M3.12)', async () => {
      const members = eleven.map((puuid, index) => ({ puuid, isSpectator: index === 10 }));
      const first = party('eleven-night');
      const balanced = await driveToBalanced(first, members, elevenToken);
      const lobbyId = await lobbyIdOf(balanced);
      expect(fieldsOf(0)['Sitting out']).toBe(
        'Sitting out: Player0 — nobody has sat out before, so somebody had to be first.',
      );

      // The ten play it out. `el00` was in the lobby and not in the game, which is what a
      // sit-out *is* (there is no sit-out table), and the other ten now have a game tonight.
      //
      // Posted under a clock pinned at **06:00:30 in `CUSTOMS_NIGHT_TZ`** — thirty seconds
      // into a night — because that is the minute this case used to fail in (M3.24): at
      // 06:00:41 Cairo a game started at `now - 60_000` belongs to *last* night, nobody has
      // a game tonight, and the clause under test is never reached. Pinning it there rather
      // than avoiding it means the boundary is exercised on every run, at any hour.
      const played = await withClockAt(nightStart(new Date(), TIME_ZONE).getTime() + 30_000, (now) =>
        postGame(
          request(
            eogBody({
              gameId: gameNumber(),
              puuids: eleven.slice(1),
              partyId: first,
              startedAt: insideTonight(now),
            }),
            elevenToken,
          ),
        ),
      );
      expect(played.status).toBe(200);
      expect(lobbyId).toBeTruthy();

      // The result post is followed by the fearless-pool embed (M10.1), whenever the pool is
      // non-empty — a real Rift game with real champions always is. That is a second post the
      // hook makes after every rated game, so index 2 here is the fearless embed, not the next
      // lobby's balanced post. Asserted explicitly, by name, so the next post this hook grows
      // moves this index loudly rather than turning `fieldsOf(2)['Sitting out']` into a silent
      // `undefined` again.
      expect(((posts[2]?.body.embeds ?? []) as Record<string, unknown>[])[0]?.title).toBe(FEARLESS_TITLE);

      // Same eleven, next lobby of the night. They are no longer tied on games, so the clause
      // is the plain one and the person sitting is somebody who has just played.
      const second = party('eleven-night-2');
      await driveToBalanced(second, members, elevenToken);

      expect(posts).toHaveLength(4);
      const fields = fieldsOf(3);
      expect(fields['Sitting out']).toBe('Sitting out: Player1 — most games tonight.');
      expect(fields.Seats).toBe(`Swap: Player1 out, Player10 in.\n${sideLine(SWITCH_SIDE_ENABLED)}`);
    });
  });

  describe('a player the client has not named yet', () => {
    it('writes Someone into the stored explanation, prints it, and names nobody in players', async () => {
      const id = party('nameless');
      // The lobby carries no `gameName` for the fifth of them, which is the ordinary case for
      // a friend the database has never met: the League lobby has no Riot ID in it at all
      // (M0.3), so the name arrives minutes later with the sweep or the first eog block.
      const members = nameless.map((puuid, index) => ({ puuid, unnamed: index === 4 }));
      const balanced = await driveToBalanced(id, members, namelessToken);
      const payload = (await balanced.json()) as { lobbyId: string; status: string };
      expect(payload.status).toBe('balanced');
      expect(posts).toHaveLength(1);

      // Everyone is unrated and flexible, so every split is gap 0 and the next-best clause
      // names the two the enumeration swaps: the nameless one and the one after them.
      const { data: split } = await db
        .from('splits')
        .select('explanation')
        .eq('lobby_id', payload.lobbyId)
        .eq('is_chosen', true)
        .single();
      expect(split?.explanation).toBe(
        'Even 50%. Everyone on a main role. Gap 0. Next best: swap Someone and Player5, gap 0.',
      );
      expect(split?.explanation).not.toContain('Unknown');

      // The stored sentence is quoted, not recomposed, and the line above it says the same
      // word: one message cannot call one player two things (M3.15).
      const embed = ((posts[0]?.body.embeds ?? []) as Record<string, unknown>[])[0];
      expect(embed?.description).toBe(split?.explanation);
      expect(teamLines(0).filter((line) => line.includes('Someone ·'))).toHaveLength(1);

      // `Someone` is a word we print, never a row we write.
      const { data: player } = await db
        .from('players')
        .select('display_name, game_name')
        .eq('puuid', nameless[4] ?? '')
        .single();
      expect(player).toEqual({ display_name: null, game_name: null });
    });
  });
}
