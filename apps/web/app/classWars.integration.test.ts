import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { modePool, type Rng } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { storedRosterKey } from '@/lib/testing/roll';

/**
 * M15.8, Class wars end to end: the first rule, proving M15.2 to M15.6 together on one fixture
 * night, through the real route handlers, real writes on the local stack, the companion's bearer
 * token, and a webhook that is a real HTTP server in this process.
 *
 * The night, in order (one `it` per step, so a failure names the step):
 *
 * 1. the card goes to standing Fearless through `POST /api/admin/mode`, and a rated Fearless game
 *    puts four tanks (and six others) on the ban list;
 * 2. an admin Spin, with a seeded RNG, lands on `Tanks only`;
 * 3. the card (Tonight's first paint), the panel's pool (minus the four banned tanks) and the teams
 *    post all say it;
 * 4. Roll locks it;
 * 5. the companion plays the game and posts the end-of-game block (twice: a second companion is a
 *    no-op): stamped not rated, nothing added to the pool, no rating moved, no role taught;
 * 6. the poster and the result post carry the kept/broke line, champions only;
 * 7. the card is back on Fearless;
 * 8. a second game with no new tap is a plain Fearless game that rates and grows the pool.
 *
 * Its own scratch group, players, token and Discord row, all deleted after; never `customs` or
 * `ogss`. Skipped, not failed, without the local stack or before `0032`.
 *
 * **The lobby is kept current (mode QA, 2026-10-04).** `sweepIdleLobbies` is global: every
 * companion post on the shared stack runs it, and `lobbyState.integration` runs it two hours
 * ahead, which abandons every open lobby on the stack. The rule lobby sits open from step 3 to
 * step 4, so `roll` first gives it a current `updated_at` (and puts back a foreign sweep's
 * `abandoned`, which only ever means another file's clock got to it): {@link keepCurrent}.
 */

const stack = await resolveLocalStack();

async function has0047(url: string, key: string): Promise<boolean> {
  const probe = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await probe.from('group_modes').select('pending_region_blue').limit(1);
  return error === null;
}

const ready = stack !== null && (await has0047(stack.url, stack.serviceRoleKey));

/** mulberry32: a fixed seed, so the Spin below lands where the test says. */
function seededRng(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
/** Seed 7: family 0.0117 (class, of class and region), option 0.0620 (Tank, the first of five). */
const SPIN_SEED = 7;

/** HTML to the words a reader sees: tags out, the escapes React writes decoded, spaces collapsed. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:])/g, '$1');
}

// Game 0, the rated Fearless game: Malphite, Sejuani, Nautilus and Thresh carry the Tank tag.
const GAME0 = [54, 113, 111, 222, 412, 103, 99, 22, 64, 157];
const BANNED_TANKS = [54, 111, 113, 412];
// The class wars game: blue five open tanks; red four tanks and Caitlyn, who breaks it.
const RULE_GAME = [516, 98, 89, 201, 154, 57, 33, 12, 32, 51];
// Game 2, plain Fearless: ten champions nobody has played tonight.
const GAME2 = [86, 122, 238, 55, 67, 81, 117, 40, 254, 121];

if (stack === null || !ready) {
  describe.skip('class wars end to end against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  // The roll handler import registers the Discord and command-queue listeners; the game route the same.
  const { setGroupModeRoute } = await import('./api/admin/mode/handler');
  const { rollRoute } = await import('./api/admin/lobbies/[lobbyId]/roll/handler');
  const { POST: postLobby } = await import('./api/companion/lobby/route');
  const { POST: postGame } = await import('./api/companion/game/route');
  const { readAssignments } = await import('@/lib/discord/assemble');
  const { listCapturedGames } = await import('@/lib/admin/games');
  const { ratedLabel } = await import('@/lib/admin/sectionCopy');
  const { loadFearless } = await import('@/lib/fearless/load');
  const { championTable } = await import('@/lib/mode/champions');
  const { loadModePanelView } = await import('@/lib/mode/panelView');
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { championName } = await import('@/lib/champs/names');
  const { ruleLineOf } = await import('./_mode/RuleLine');
  const { ModePanelBody } = await import('./_mode/ModePanelBody');
  const { TonightView } = await import('./_tonight/TonightView');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  /** Tonight's and the panel's own client: the anon key, as a phone reads. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-cw${index}`);
  const NAMES = ten.map((_, index) => `Wars${index}${runId.slice(0, 3)}`);
  const OWNER = ten[0] ?? '';
  const ownerDiscord = `9${runId.replace(/\D/g, '') || '1'}0008`;
  const group = { id: '', slug: `it-${runId}-cw`.toLowerCase(), name: `it ${runId} cw` };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  let token = '';
  let party = 0;
  let server: Server | null = null;
  let posts: Record<string, unknown>[] = [];

  /** State the steps hand to each other. */
  const night = {
    ruleLobby: { partyId: '', lobbyId: '' },
    ruleGameId: 0,
    ruleGameRowId: '',
    poolBefore: [] as number[],
    ratingsBefore: [] as Awaited<ReturnType<typeof ratingsOfTen>>,
    rolesBefore: [] as Awaited<ReturnType<typeof rolesOfTen>>,
  };

  const owner: SessionUserLike = {
    id: randomUUID(),
    email: `${OWNER}@example.invalid`,
    identities: [{ id: ownerDiscord, provider: 'discord', identity_data: {} }],
  };
  const adminOptions = {
    getClient: () => db,
    timeZone: 'Africa/Cairo',
    authorize: async (
      _request: Request,
      client: typeof db,
      groupId: string | null,
    ): Promise<AdminAuthResult> =>
      authorizeAdmin({
        resolveSessionUser: async () => owner,
        lookupPlayerByDiscordId: supabaseAdminLookup(client),
        lookupGroupRole: supabaseGroupRole(client),
        groupId,
      }),
  };

  const jsonRequest = (path: string, body: unknown, bearer?: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // A public origin, so the posts carry their links (localhost ones are dropped on purpose).
        'x-forwarded-host': 'kustom.test',
        'x-forwarded-proto': 'https',
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    });

  async function card(body: Record<string, unknown>) {
    const response = await setGroupModeRoute(adminOptions)(
      jsonRequest('/api/admin/mode', { groupId: group.id, ...body }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  async function cardRow() {
    const { data, error } = await db
      .from('group_modes')
      .select(
        'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override',
      )
      .eq('group_id', group.id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function openLobby(): Promise<{ partyId: string; lobbyId: string }> {
    party += 1;
    const partyId = `it-${runId}-cw-party-${party}`;
    const lobbyId = await companionLobby(partyId);
    return { partyId, lobbyId };
  }

  /** The companion's lobby post (it repeats it on every change; a repeat is a no-op). */
  async function companionLobby(partyId: string): Promise<string> {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: 'class wars night',
          members: ten.map((puuid, index) => ({
            puuid,
            gameName: NAMES[index],
            tagLine: 'EUW',
            summonerId: 8_000 + index,
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        token,
      ),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { lobbyId: string }).lobbyId;
  }

  /**
   * Give our open lobby a current `updated_at` (the row's trigger stamps `now()` on any update),
   * undoing a foreign idle sweep's `abandoned` if one got there first. Never touches another row.
   */
  async function keepCurrent(lobbyId: string) {
    const { error } = await db
      .from('lobbies')
      .update({ status: 'open' })
      .eq('id', lobbyId)
      .eq('group_id', group.id)
      .in('status', ['open', 'abandoned']);
    if (error) throw new Error(`keepCurrent: ${error.message}`);
  }

  /** The admin's Roll through the real handler (Discord listeners registered). */
  async function roll(lobbyId: string) {
    await keepCurrent(lobbyId);
    const response = await rollRoute(
      lobbyId,
      adminOptions,
    )(
      jsonRequest(`/api/admin/lobbies/${lobbyId}/roll`, {
        groupId: group.id,
        rosterKey: await storedRosterKey(db, lobbyId),
      }),
    );
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(json)).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 'balanced', outcome: 'rolled' });
    return json;
  }

  /**
   * The end-of-game block as the client would report it: the ten seated as the chosen split put
   * them (blue then red, each on the split's role), `champions` in that seat order.
   */
  async function eogFor(lobbyId: string, partyId: string, gameId: number, champions: readonly number[]) {
    const { data: split, error } = await db
      .from('splits')
      .select('blue, red')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    const seats = [...readAssignments(split.blue), ...readAssignments(split.red)];
    expect(seats).toHaveLength(10);
    const body = eogBody({
      gameId,
      partyId,
      puuids: seats.map((seat) => seat.puuid),
      roles: seats.map((seat) => seat.role),
      startedAt: new Date().toISOString(),
    });
    (body.participants as Record<string, unknown>[]).forEach((participant, index) => {
      participant.championId = champions[index];
    });
    return body;
  }

  async function postEog(body: Record<string, unknown>) {
    const response = await postGame(jsonRequest('/api/companion/game', body, token));
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  /** One whole game: lobby, Roll, in progress, end of game. Returns the game row. */
  async function playGame(champions: readonly number[]) {
    const { partyId, lobbyId } = await openLobby();
    await roll(lobbyId);
    const gameId = testGameId();
    gameIds.push(gameId);
    const started = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, token),
    );
    expect(started.status).toBe(200);
    const answer = await postEog(await eogFor(lobbyId, partyId, gameId, champions));
    return { answer, game: await gameRow(gameId), partyId, lobbyId };
  }

  async function gameRow(gameId: number) {
    const { data, error } = await db
      .from('games')
      .select('id, mode, rule, rule_class_tag, rated, rule_checked, rule_check')
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function ratingsOfTen() {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games, wins')
      .eq('group_id', group.id)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data;
  }

  async function rolesOfTen() {
    const { data, error } = await db
      .from('players')
      .select('id, main_role, secondary_role, roles_counted')
      .in('id', [...idOf.values()])
      .order('id');
    if (error) throw new Error(error.message);
    return data;
  }

  async function poolIds(): Promise<number[]> {
    return (await loadFearless(anon, group.id)).champions
      .map((champion) => champion.id)
      .sort((a, b) => a - b);
  }

  async function count(table: 'games' | 'game_players' | 'lobbies', column: string, value: string) {
    const { count: n, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value);
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  /** Tonight's first paint for an anonymous phone: the card, the poster, everything. */
  async function tonightPaint(): Promise<string> {
    const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId: group.id });
    return plain(
      renderToStaticMarkup(
        createElement(TonightView, { snapshot, viewer: { kind: 'anonymous' }, group, topPlayers: [] }),
      ),
    );
  }

  // Discord posts 2.0 (M14.61): the head embed's words, markdown stripped (`lib/testing/modeNight`).
  const { descriptionOf, isGameOnPost, titleOf } = await import('@/lib/testing/modeNight');

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    group.id = (await createTestGroups(db, runId, ['cw'] as const)).cw;
    const ownerId = idOf.get(OWNER) ?? '';
    const linked = await db.from('players').update({ discord_id: ownerDiscord }).eq('id', ownerId);
    if (linked.error) throw new Error(linked.error.message);
    await setTestMembership(db, group.id, ownerId, 'owner');
    for (const puuid of ten.slice(1)) await setTestMembership(db, group.id, idOf.get(puuid) ?? '', 'member');
    const minted = mintCompanionToken();
    const inserted = await db.from('companion_tokens').insert({
      player_id: ownerId,
      token_hash: minted.tokenHash,
      label: `cw-${runId}`,
      group_id: group.id,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    token = minted.token;

    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const post = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        // The kickoff's `Game on` post (M21.6) is not what this night counts.
        if (!isGameOnPost(post)) posts.push(post);
        response.writeHead(204).end();
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;
    const config = await db
      .from('discord_config')
      .insert({ group_id: group.id, guild_id: `it-${runId}-cw-guild`, webhook_url: webhookUrl });
    if (config.error) throw new Error(config.error.message);
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, [group.id]);
    await db.from('players').delete().in('puuid', ten);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
    const { data: left } = await db.from('players').select('puuid').in('puuid', ten);
    expect(left ?? []).toEqual([]);
  });

  describe('class wars, one fixture night', () => {
    it('1. standing Fearless, and a rated Fearless game puts four tanks on the ban list', async () => {
      await card({ mode: 'normal' });
      const answer = await card({ mode: 'fearless' });
      expect(answer).toMatchObject({
        changed: true,
        state: { standing: 'fearless', pending: null, nextRated: true },
      });

      const { answer: recorded, game } = await playGame(GAME0);
      expect(recorded).toMatchObject({ created: true, rated: true });
      expect(game).toMatchObject({ mode: 'fearless', rule: null, rated: true });
      expect(await poolIds()).toEqual([...GAME0].sort((a, b) => a - b));
      posts = [];
    });

    it('2. an admin Spin, seeded, lands on Tanks only', async () => {
      // M20.7: Spin is the one mode route with `spin: true`.
      const response = await setGroupModeRoute({ ...adminOptions, rng: seededRng(SPIN_SEED) })(
        jsonRequest('/api/admin/mode', { groupId: group.id, spin: true }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        spun: 'class:Tank',
        state: { standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, nextRated: false },
      });
      expect(await cardRow()).toMatchObject({
        mode: 'fearless',
        pending_rule: 'class',
        pending_class_tag: 'Tank',
        rated_override: null,
      });
      // A Spin posts nothing to Discord.
      expect(posts).toHaveLength(0);
    });

    it('3a. the card says it: Class wars, Tanks only with the open count, not rated, one game', async () => {
      night.ruleLobby = await openLobby();
      const page = await tonightPaint();
      expect(page).toContain('Class wars');
      expect(page).toContain('Tanks only · 42 open');
      expect(page).toContain('This game only. Then back to Fearless.');
      expect(page).toMatch(/Not rated/);
    });

    it('3b. the panel pool is the tanks minus the four banned under standing Fearless', async () => {
      const panel = await loadModePanelView(anon, group.id, tonightStart());
      expect(panel.view.shown).toEqual({ id: 'class', tag: 'Tank' });
      expect(panel.view.rated).toBe(false);
      expect(panel.view.classOpen).toBe(42);

      const bans = panel.fearless.champions.map((champion) => champion.id);
      const pool = modePool({ id: 'class', tag: 'Tank' }, championTable(), bans);
      if (pool.kind !== 'shared') throw new Error(`expected a shared pool, got ${pool.kind}`);
      expect(pool.pool.open).toHaveLength(42);
      expect([...pool.pool.banned].sort((a, b) => a - b)).toEqual(BANNED_TANKS);

      const html = plain(
        renderToStaticMarkup(
          createElement(ModePanelBody, {
            mode: panel.mode,
            fearless: panel.fearless,
            view: panel.view,
            lane: 'all',
            viewerLane: null,
            isAdmin: false,
            poolSince: null,
            cardHref: `/g/${group.slug}#mode`,
            heading: 'h1',
            headingId: 'mode-panel-title',
          }),
        ),
      );
      expect(html).toContain('Class wars');
      expect(html).toContain('Tanks only');
      expect(html).toMatch(/\b42 open\b/);
      expect(html).toMatch(/\b4 banned\b/);
      // An open tank is offered, a banned one is listed with the banned.
      expect(html).toContain(championName(516));
      expect(html).toContain(championName(54));
    });

    it('4. Roll locks it, and the teams post says it with the panel link', async () => {
      const { lobbyId, partyId } = night.ruleLobby;
      await roll(lobbyId);
      const { data: lock, error } = await db
        .from('lobbies')
        .select('status, lock_mode, lock_rule, lock_class_tag, lock_rated')
        .eq('id', lobbyId)
        .single();
      if (error) throw new Error(error.message);
      // M20.7: Roll moves the rule and Rated as they were (null = the rule's default, not rated)
      // onto the lock and empties the row.
      expect(lock).toEqual({
        status: 'balanced',
        lock_mode: 'fearless',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: null,
      });
      expect(await cardRow()).toMatchObject({ pending_rule: null, rated_override: null });

      expect(posts).toHaveLength(1);
      const teams = descriptionOf(posts[0]);
      expect(teams).toContain('This game: tanks only. Not rated. See the tanks: ');
      expect(teams).toContain(`/g/${group.slug}/mode`);

      // The companion keeps posting the same lobby: nothing changes, nothing posts again.
      const lobbiesBefore = await count('lobbies', 'group_id', group.id);
      expect(await companionLobby(partyId)).toBe(lobbyId);
      expect(await count('lobbies', 'group_id', group.id)).toBe(lobbiesBefore);
      expect(posts).toHaveLength(1);

      // The card, set: this game's lock.
      const page = await tonightPaint();
      expect(page).toContain('Tanks only · 42 open');
      posts = [];
    });

    it('5. the game: stamped not rated, no pool growth, no rating move, no role taught; a second companion is a no-op', async () => {
      const { lobbyId, partyId } = night.ruleLobby;
      night.poolBefore = await poolIds();
      night.ratingsBefore = await ratingsOfTen();
      night.rolesBefore = await rolesOfTen();
      expect(night.ratingsBefore).toHaveLength(10);

      night.ruleGameId = testGameId();
      gameIds.push(night.ruleGameId);
      const started = await postGame(
        jsonRequest(
          '/api/companion/game',
          { phase: 'in_progress', gameId: night.ruleGameId, partyId },
          token,
        ),
      );
      expect(started.status).toBe(200);
      // In game, the card is still this game's lock.
      const during = await tonightPaint();
      expect(during).toContain('Class wars');
      expect(during).toContain('Tanks only · 42 open');
      const body = await eogFor(lobbyId, partyId, night.ruleGameId, RULE_GAME);
      const answer = await postEog(body);
      expect(answer).toMatchObject({ created: true, rated: false, reason: 'not-rated' });

      const game = await gameRow(night.ruleGameId);
      night.ruleGameRowId = game.id;
      expect(game).toMatchObject({
        mode: 'fearless',
        rule: 'class',
        rule_class_tag: 'Tank',
        rated: false,
        rule_checked: true,
      });
      expect(game.rule_check).toMatchObject({
        kind: 'sides',
        blue: { verdict: 'kept', broke: [], unknown: [] },
        red: { verdict: 'broke', broke: [51], unknown: [] },
      });
      const { data: seats } = await db.from('game_players').select('mu_after').eq('game_id', game.id);
      expect(seats).toHaveLength(10);
      expect(seats?.every((seat) => seat.mu_after === null)).toBe(true);

      expect(await poolIds()).toEqual(night.poolBefore);
      expect(await ratingsOfTen()).toEqual(night.ratingsBefore);
      expect(await rolesOfTen()).toEqual(night.rolesBefore);

      // The same block from a second companion: no new rows, no second result post.
      const postsAfterFirst = posts.length;
      const games = await count('games', 'group_id', group.id);
      const seatRows = await count('game_players', 'game_id', game.id);
      const again = await postEog(body);
      expect(again).toMatchObject({ created: false });
      expect(await count('games', 'group_id', group.id)).toBe(games);
      expect(await count('game_players', 'game_id', game.id)).toBe(seatRows);
      expect(posts).toHaveLength(postsAfterFirst);
      expect(await ratingsOfTen()).toEqual(night.ratingsBefore);
    });

    it('6. the poster and the result post carry the kept/broke line, champions only', async () => {
      const line = "Tanks only: Blue kept the rule. Red: Caitlyn isn't a tank.";

      // The result post: one message, the line and `Not rated`, and no Fearless pool post after it.
      expect(posts).toHaveLength(1);
      const result = descriptionOf(posts[0]);
      expect(result).toContain(line);
      expect(result).toContain('Not rated, so no Rating change.');
      expect(titleOf(posts[0])).not.toMatch(/fearless/i);

      // The poster, from the stamp Tonight reads with the anon key: the same builder, the same words.
      const snapshot = await loadTonight(anon, { nightStart: tonightStart(), groupId: group.id });
      const stamp = snapshot.lobby?.status === 'finished' ? (snapshot.lobby.result?.stamp ?? null) : null;
      expect(ruleLineOf(stamp)).toBe(line);
      const page = await tonightPaint();
      expect(page).toContain(line);
      expect(page).toContain('Not rated, so no Rating change.');

      // Champions, never players: no name, no PUUID in the line either surface actually built.
      // The poster's line is what `ruleLineOf` made from the stored stamp; the post's is the row of
      // the posted description that carries the rule (the rest of it names players on purpose).
      const posterLine = ruleLineOf(stamp) ?? '';
      const postedLine = result.split('\n').find((row) => row.startsWith('Tanks only:')) ?? '';
      expect(posterLine).not.toBe('');
      expect(postedLine).toBe(posterLine);
      for (const who of [...NAMES, ...ten]) {
        expect(posterLine).not.toContain(who);
        expect(postedLine).not.toContain(who);
      }
      posts = [];
    });

    it('7. the card is back on the standing mode', async () => {
      expect(await cardRow()).toMatchObject({
        mode: 'fearless',
        pending_rule: null,
        pending_class_tag: null,
        rated_override: null,
      });
      const panel = await loadModePanelView(anon, group.id, tonightStart());
      expect(panel.view.shown).toEqual({ id: 'fearless' });
      expect(panel.view.rated).toBe(true);
      expect(panel.view.locked).toBe(false);
      const page = await tonightPaint();
      expect(page).not.toContain('Then back to Fearless.');
    });

    it('8. a second game with no new tap is a plain Fearless game that rates and grows the pool', async () => {
      const ratingsBefore = await ratingsOfTen();
      const poolBefore = await poolIds();

      const { answer, game } = await playGame(GAME2);
      // Its teams post (the first message) has no rule line.
      expect(titleOf(posts[0])).toBe('Teams are set');
      expect(descriptionOf(posts[0])).not.toContain('This game:');
      expect(answer).toMatchObject({ created: true, rated: true });
      expect(game).toMatchObject({ mode: 'fearless', rule: null, rule_class_tag: null, rated: true });
      expect(game.rule_checked).toBe(false);

      expect(await poolIds()).toEqual([...poolBefore, ...GAME2].sort((a, b) => a - b));
      const after = await ratingsOfTen();
      expect(after.map((row) => row.games)).toEqual(ratingsBefore.map((row) => row.games + 1));
      expect(after.some((row, index) => row.mu !== ratingsBefore[index]?.mu)).toBe(true);

      // Its result post: no rule line, no `Not rated`.
      const resultPost = posts.find((post) => descriptionOf(post).includes('Not rated'));
      expect(resultPost).toBeUndefined();
      expect(posts.some((post) => descriptionOf(post).includes('Tanks only'))).toBe(false);
    });

    it("9. admin Recording tells the night's three games apart: Yes, No · Tanks only, Yes", async () => {
      const rows = await listCapturedGames(db, { timeZone: 'Africa/Cairo', groupId: group.id });
      expect(rows).toHaveLength(3);
      // Newest first: game 2, the class wars game, game 0.
      expect(rows.map((row) => ratedLabel(row.ratedReason))).toEqual(['Yes', 'No · Tanks only', 'Yes']);
      expect(rows[1]?.id).toBe(night.ruleGameRowId);
    });
  });
}
