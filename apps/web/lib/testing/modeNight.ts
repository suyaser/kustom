import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Rng } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from 'vitest';
import type { ViewerState } from '../tonight/viewer';
import type { LocalStack } from './localStack';

/**
 * Tests only: one fixture night of the mode of the night (M15.8, shared by M15.10 and M15.11), on
 * the local stack, through the real route handlers: `/api/admin/mode` (Spin included), the admin Roll
 * and Reroll, and the companion's lobby and game posts under a bearer token. A scratch group of
 * ten fresh players (the first is the owner, the host and the token's player), and a webhook that
 * is a real HTTP server in the process, so every Discord post is captured as sent.
 *
 * `modeNight(stack, key)` sets the environment the routes read, imports them (which registers the
 * Discord listeners), and answers the helpers. The caller wires `setup` into `beforeAll` and
 * `teardown` into `afterAll`; teardown deletes every row the night wrote. Never `customs`, never
 * `ogss`.
 */

/** mulberry32: a fixed seed for Spin. */
export function seededRng(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** An RNG that answers `values` in order (then repeats the last): for a draw the test spells out. */
export function sequenceRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

/** HTML to the words a reader sees: tags out, the escapes React writes decoded, spaces collapsed. */
export function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:])/g, '$1');
}

export const sortIds = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b);

type Post = Record<string, unknown>;

/**
 * Discord markdown to the words (M14.61's posts): bold markers out, a masked link `[action](url)`
 * read as `action: url`, which is exactly M15.6's plain wording (`See the tanks: <url>`).
 */
export function markdownWords(text: string): string {
  return text.replaceAll('**', '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');
}

/** The post's head embed's description, as words (Discord posts 2.0 are multi-embed stacks). */
export function descriptionOf(post: Post | undefined): string {
  const embed = ((post?.embeds ?? []) as { description?: string }[])[0];
  return markdownWords(embed?.description ?? '');
}

export function titleOf(post: Post | undefined): string {
  const embed = ((post?.embeds ?? []) as { title?: string }[])[0];
  return embed?.title ?? '';
}

/**
 * The `Game on` post (M21.6). These fixture nights start their games on the lobby's posted sides,
 * not the roll's, so each start is a `custom` kickoff and posts one; the mode suites are about
 * the rule lines and leave it out of what they count (`gameOn.integration.test.ts` owns it).
 */
export function isGameOnPost(post: Post | undefined): boolean {
  return titleOf(post).startsWith('Game on');
}

export interface EogOptions {
  /** The detected position per seat (blue then red), overriding the split's roles; null is none. */
  roles?: readonly (string | null)[];
  /** `raw.gameType` (`CUSTOM_GAME` by default). */
  gameType?: string;
  /** Extra `raw` keys (e.g. the pick mode a Draft lobby reports). */
  raw?: Record<string, unknown>;
}

export async function modeNight(stack: LocalStack, key: string) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  // The roll handler import registers the Discord and command-queue listeners; the game route too.
  const { setGroupModeRoute } = await import('@/app/api/admin/mode/handler');
  const { rollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/roll/handler');
  const { rerollRoute } = await import('@/app/api/admin/lobbies/[lobbyId]/reroll/handler');
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { TonightView } = await import('@/app/_tonight/TonightView');
  const { authorizeAdmin, supabaseAdminLookup } = await import('../adminAuth');
  const { mintCompanionToken } = await import('../companionAuth');
  const { readAssignments } = await import('../discord/assemble');
  const { loadFearless } = await import('../fearless/load');
  const { supabaseGroupRole } = await import('../groups/membership');
  const { ensurePlayers } = await import('../ingest/players');
  const { createPublicClient } = await import('../publicClient');
  const { loadTonight } = await import('../tonight/load');
  const { tonightStart } = await import('../tonight/night');
  const { eogBody, testGameId } = await import('./fixtures');
  const { createTestGroups, deleteTestGroups, setTestMembership } = await import('./groups');
  const { storedRosterKey } = await import('./roll');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  /** Tonight's and the panel's own client: the anon key, as a phone reads. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-${key}${index}`);
  const names = ten.map((_, index) => `${key.toUpperCase()}${index}x${runId.slice(0, 3)}`);
  const owner = ten[0] ?? '';
  const ownerDiscord = `9${runId.replace(/\D/g, '') || '1'}0${key.length}09`;
  const group = { id: '', slug: `it-${runId}-${key}`.toLowerCase(), name: `it ${runId} ${key}` };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const state = { token: '', party: 0, posts: [] as Post[], server: null as Server | null };

  const session = {
    id: randomUUID(),
    email: `${owner}@example.invalid`,
    identities: [{ id: ownerDiscord, provider: 'discord', identity_data: {} }],
  };
  const adminOptions = {
    getClient: () => db,
    timeZone: 'Africa/Cairo',
    authorize: async (_request: Request, client: typeof db, groupId: string | null) =>
      authorizeAdmin({
        resolveSessionUser: async () => session,
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

  /** One card action; `rng` pins region wars' draw (M20.7: drawn when it is chosen). */
  async function card(body: Record<string, unknown>, rng?: Rng) {
    const { status, json } = await cardAnswer(body, rng);
    expect(status, JSON.stringify(json)).toBe(200);
    return json;
  }

  /** One card action that may be refused: the status and the body. */
  async function cardAnswer(body: Record<string, unknown>, rng?: Rng) {
    const response = await setGroupModeRoute({ ...adminOptions, ...(rng === undefined ? {} : { rng }) })(
      jsonRequest('/api/admin/mode', { groupId: group.id, ...body }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  /**
   * M20.18: one card action as the no-JS form posts it (`application/x-www-form-urlencoded`, the
   * form's own fields): the status and the redirect's `notice` / `error`.
   */
  async function cardForm(fields: Record<string, string>, rng?: Rng) {
    const response = await setGroupModeRoute({ ...adminOptions, ...(rng === undefined ? {} : { rng }) })(
      new Request('http://localhost/api/admin/mode', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-host': 'kustom.test',
          'x-forwarded-proto': 'https',
        },
        body: new URLSearchParams(fields).toString(),
      }),
    );
    const location = new URL(response.headers.get('location') ?? 'http://invalid/');
    return {
      status: response.status,
      path: location.pathname,
      notice: location.searchParams.get('notice'),
      error: location.searchParams.get('error'),
    };
  }

  /** Spin (M20.7: the one mode route with `spin: true`); `rng` pins the pick and a region pair. */
  async function spin(rng: Rng) {
    const response = await setGroupModeRoute({ ...adminOptions, rng })(
      jsonRequest('/api/admin/mode', { groupId: group.id, spin: true }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function cardRow() {
    const { data, error } = await db
      .from('group_modes')
      .select(
        'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at',
      )
      .eq('group_id', group.id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * The companion's lobby post (it repeats it on every change; a repeat is a no-op). The first
   * five sit on blue, the rest on red, unless `sides` puts somebody elsewhere (M21.9).
   */
  async function companionLobby(
    partyId: string,
    members: readonly string[] = ten,
    sides: Readonly<Record<string, 100 | 200>> = {},
  ): Promise<string> {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `${key} night`,
          members: members.map((puuid) => {
            const index = ten.indexOf(puuid);
            return {
              puuid,
              gameName: names[index],
              tagLine: 'EUW',
              summonerId: 8_000 + index,
              side: sides[puuid] ?? (index < 5 ? 100 : 200),
              isSpectator: false,
            };
          }),
        },
        state.token,
      ),
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { lobbyId: string }).lobbyId;
  }

  async function openLobby(): Promise<{ partyId: string; lobbyId: string }> {
    state.party += 1;
    const partyId = `it-${runId}-${key}-party-${state.party}`;
    return { partyId, lobbyId: await companionLobby(partyId) };
  }

  /** The admin's Roll through the real handler; `rng` pins region wars' draw. */
  async function roll(lobbyId: string, rng?: Rng) {
    const response = await rollRoute(lobbyId, { ...adminOptions, ...(rng === undefined ? {} : { rng }) })(
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

  /** The admin's Reroll to the split ranked `rank`, through the real handler. */
  async function reroll(lobbyId: string, rank: number) {
    const { data, error } = await db
      .from('splits')
      .select('id')
      .eq('lobby_id', lobbyId)
      .eq('rank', rank)
      .single();
    if (error) throw new Error(error.message);
    const response = await rerollRoute(
      lobbyId,
      adminOptions,
    )(jsonRequest(`/api/admin/lobbies/${lobbyId}/reroll`, { groupId: group.id, splitId: data.id }));
    const json = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(json)).toBe(200);
    return json;
  }

  async function lockOf(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select(
        'status, lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated, locked_at',
      )
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** The chosen split's seats, blue then red, each with the split's role. */
  async function seatsOf(lobbyId: string) {
    const { data: split, error } = await db
      .from('splits')
      .select('blue, red')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    const seats = [...readAssignments(split.blue), ...readAssignments(split.red)];
    expect(seats).toHaveLength(10);
    return seats;
  }

  /**
   * The end-of-game block as the client would report it: the ten seated as the chosen split put
   * them (blue then red, each on the split's role unless `roles` overrides), `champions` in that
   * seat order.
   */
  async function eogFor(
    lobbyId: string,
    partyId: string,
    gameId: number,
    champions: readonly number[],
    options: EogOptions = {},
  ) {
    const seats = await seatsOf(lobbyId);
    const body = eogBody({
      gameId,
      partyId,
      puuids: seats.map((seat) => seat.puuid),
      roles: options.roles ?? seats.map((seat) => seat.role),
      startedAt: new Date().toISOString(),
      ...(options.gameType === undefined ? {} : { gameType: options.gameType }),
      ...(options.raw === undefined ? {} : { raw: options.raw }),
    });
    (body.participants as Record<string, unknown>[]).forEach((participant, index) => {
      participant.championId = champions[index];
    });
    return body;
  }

  async function postEog(body: Record<string, unknown>) {
    const response = await postGame(jsonRequest('/api/companion/game', body, state.token));
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  async function startGame(partyId: string): Promise<number> {
    const gameId = testGameId() + gameIds.length;
    gameIds.push(gameId);
    const started = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, state.token),
    );
    expect(started.status).toBe(200);
    return gameId;
  }

  async function gameRow(gameId: number) {
    const { data, error } = await db
      .from('games')
      .select(
        'id, mode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated, rule_checked, rule_check',
      )
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** One whole game: lobby, Roll, in progress, end of game. */
  async function playGame(champions: readonly number[], options: EogOptions & { rng?: Rng } = {}) {
    const { partyId, lobbyId } = await openLobby();
    await roll(lobbyId, options.rng);
    const gameId = await startGame(partyId);
    const body = await eogFor(lobbyId, partyId, gameId, champions, options);
    const answer = await postEog(body);
    return { answer, game: await gameRow(gameId), partyId, lobbyId, gameId, body };
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
    return sortIds((await loadFearless(anon, group.id)).champions.map((champion) => champion.id));
  }

  async function count(table: 'games' | 'game_players' | 'lobbies', column: string, value: string) {
    const { count: n, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value);
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  async function snapshot() {
    return loadTonight(anon, { nightStart: tonightStart(), groupId: group.id });
  }

  /** Tonight's first paint for `viewer` (anonymous by default): the card, the poster, everything. */
  async function tonightPaint(viewer: ViewerState = { kind: 'anonymous' }): Promise<string> {
    return plain(
      renderToStaticMarkup(
        createElement(TonightView, { snapshot: await snapshot(), viewer, group, topPlayers: [] }),
      ),
    );
  }

  async function setup() {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    group.id = (await createTestGroups(db, runId, [key] as const))[key] ?? '';
    const ownerId = idOf.get(owner) ?? '';
    const linked = await db.from('players').update({ discord_id: ownerDiscord }).eq('id', ownerId);
    if (linked.error) throw new Error(linked.error.message);
    await setTestMembership(db, group.id, ownerId, 'owner');
    for (const puuid of ten.slice(1)) await setTestMembership(db, group.id, idOf.get(puuid) ?? '', 'member');
    const minted = mintCompanionToken();
    const inserted = await db.from('companion_tokens').insert({
      player_id: ownerId,
      token_hash: minted.tokenHash,
      label: `${key}-${runId}`,
      group_id: group.id,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    state.token = minted.token;

    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const post = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Post;
        if (!isGameOnPost(post)) state.posts.push(post);
        response.writeHead(204).end();
      });
    });
    state.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
    const config = await db
      .from('discord_config')
      .insert({ group_id: group.id, guild_id: `it-${runId}-${key}-guild`, webhook_url: webhookUrl });
    if (config.error) throw new Error(config.error.message);
  }

  async function teardown() {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, [group.id]);
    await db.from('players').delete().in('puuid', ten);
    await new Promise<void>((resolve) => {
      const server = state.server;
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
    const { data: left } = await db.from('players').select('puuid').in('puuid', ten);
    expect(left ?? []).toEqual([]);
  }

  return {
    db,
    anon,
    group,
    ten,
    names,
    idOf,
    gameIds,
    /** Every Discord post since the last {@link clearPosts}. */
    get posts(): Post[] {
      return state.posts;
    },
    clearPosts: () => {
      state.posts = [];
    },
    card,
    cardAnswer,
    cardForm,
    spin,
    cardRow,
    companionLobby,
    openLobby,
    roll,
    reroll,
    lockOf,
    seatsOf,
    eogFor,
    postEog,
    startGame,
    gameRow,
    playGame,
    ratingsOfTen,
    rolesOfTen,
    poolIds,
    count,
    snapshot,
    tonightPaint,
    nightStart: () => tonightStart(),
    setup,
    teardown,
  };
}

/** Skip unless the local stack is up and on `0047` (the one-row card: the pending pair). */
export async function stackWithModes(stack: LocalStack | null): Promise<LocalStack | null> {
  if (stack === null) return null;
  const probe = createClient<Database>(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
  const { error } = await probe.from('group_modes').select('pending_region_blue').limit(1);
  return error === null ? stack : null;
}
