import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { settleDetached } from '@/lib/afterResponse';
import { mintCompanionToken } from '@/lib/companionAuth';
import { readAssignments } from '@/lib/discord/assemble';
import {
  GAME_ON_CUSTOM_DESCRIPTION,
  GAME_ON_CUSTOM_TITLE,
  GAME_ON_UNROLLED_DESCRIPTION,
  GAME_ON_UNROLLED_TITLE,
} from '@/lib/discord/embeds';
import { ensurePlayers } from '@/lib/ingest/players';
import { testGameId } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * M21.6 against the local stack: the `Game on` post the `in_progress` post sends when the kickoff
 * teams are not the roll, through the real companion routes, the real roll and a webhook that is
 * a real HTTP server in this process (the Discord fake `discord.integration.test.ts` uses).
 *
 * One group of its own on Normal with its own `discord_config` row, ten players, two companion
 * tokens (the host's and a second companion in the same game). Every scenario opens its own party.
 *
 * Skipped, not failed, without the local stack or on a stack without 0046.
 */

const stack = await resolveLocalStack();

async function has0046(url: string, key: string): Promise<boolean> {
  const probe = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await probe.from('lobbies').select('kickoff_kind').limit(1);
  return error === null;
}

const ready = stack !== null && (await has0046(stack.url, stack.serviceRoleKey));

if (stack === null || !ready) {
  describe.skip('the Game on post against the local Supabase stack', () => {
    it('needs the local stack with 0046 applied: `pnpm db:start`, then apply 0046', () => {
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

  // Importing the game route registers the Discord hooks (`lib/ingest/discord.ts`).
  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');
  const { resetWebhookWarning } = await import('@/lib/discord/webhook');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-go${index}`);
  const HOST = ten[0] ?? '';
  const groups = { g: '' };
  const idOf = new Map<string, string>();
  const tokens = { host: '', second: '' };
  let party = 0;

  let server: Server | null = null;
  let webhookUrl = '';
  /** Every request the webhook server received. */
  let posts: Record<string, unknown>[] = [];
  let answer: (response: ServerResponse) => void = (response) => response.writeHead(204).end();

  type Member = { puuid: string; side: 100 | 200 | null };

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  const sided = (blue: readonly string[], red: readonly string[]): Member[] => [
    ...blue.map((puuid) => ({ puuid, side: 100 as const })),
    ...red.map((puuid) => ({ puuid, side: 200 as const })),
  ];

  async function postMembers(partyId: string, members: readonly Member[]) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: 'game on night',
          members: members.map((member) => ({
            puuid: member.puuid,
            gameName: `Go${ten.indexOf(member.puuid)}`,
            tagLine: 'EUW',
            summonerId: 7_000 + ten.indexOf(member.puuid),
            side: member.side,
            isSpectator: false,
          })),
        },
        tokens.host,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string; status: string };
  }

  async function openLobby(members: readonly Member[]) {
    party += 1;
    const partyId = `it-${runId}-goparty-${party}`;
    const { lobbyId } = await postMembers(partyId, members);
    return { partyId, lobbyId };
  }

  async function chosenTeams(lobbyId: string) {
    const { data, error } = await db
      .from('splits')
      .select('blue, red')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    return {
      blue: readAssignments(data.blue).map((a) => a.puuid),
      red: readAssignments(data.red).map((a) => a.puuid),
    };
  }

  async function lobbyRow(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select('status, kickoff_kind')
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** `in_progress` through the real route; answers without waiting for the post (`after()`). */
  function startOnly(partyId: string, gameId: number, token = tokens.host): Promise<Response> {
    return postGame(jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, token));
  }

  /** `in_progress`, then wait for the after-response work (the Game on post) to finish. */
  async function start(partyId: string, gameId: number, token = tokens.host) {
    const response = await startOnly(partyId, gameId, token);
    await settleDetached();
    return response.status;
  }

  /** Rolled, then two players traded across: a `custom` kickoff. */
  async function rolledThenSwapped() {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    const split = await chosenTeams(lobbyId);
    const [b0, ...blueRest] = split.blue;
    const [r0, ...redRest] = split.red;
    await postMembers(partyId, sided([r0 ?? '', ...blueRest], [b0 ?? '', ...redRest]));
    // The roll's own teams post went out: start counting from the kickoff.
    posts = [];
    return { partyId, lobbyId };
  }

  function descriptionLines(index: number): string[] {
    const embeds = (posts[index]?.embeds ?? []) as { description?: string }[];
    return String(embeds[0]?.description ?? '').split('\n');
  }

  function titleOf(index: number): string | undefined {
    return ((posts[index]?.embeds ?? []) as { title?: string }[])[0]?.title;
  }

  async function connectChannel() {
    const { error } = await db
      .from('discord_config')
      .upsert({ group_id: groups.g, guild_id: `it-${runId}-goguild`, webhook_url: webhookUrl });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    groups.g = (await createTestGroups(db, runId, ['go'] as const)).go;
    await pinTestGroupMode(db, groups.g, 'normal');
    await setTestMembership(db, groups.g, idOf.get(HOST) ?? '', 'owner');
    for (const puuid of ten.slice(1)) await setTestMembership(db, groups.g, idOf.get(puuid) ?? '', 'member');
    for (const [key, puuid] of [
      ['host', HOST],
      ['second', ten[1] ?? ''],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `go-${key}-${runId}`,
        group_id: groups.g,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }

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
    await connectChannel();
  });

  afterEach(async () => {
    posts = [];
    answer = (response) => response.writeHead(204).end();
    resetWebhookWarning();
    // Each scenario opens its own party and leaves it live; end them, so the next scenario is a
    // one-lobby night and its post carries no lobby label (M22.7 labels a post while two are live).
    const ended = await db
      .from('lobbies')
      .update({ status: 'abandoned' })
      .eq('group_id', groups.g)
      .in('status', ['open', 'balanced', 'in_game']);
    if (ended.error) throw new Error(ended.error.message);
  });

  afterAll(async () => {
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', ten);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('(1, 2) rolled then swapped: one new Game on post; a second companion and a retry send none', async () => {
    const { partyId, lobbyId } = await rolledThenSwapped();
    const gameId = testGameId();
    expect(await start(partyId, gameId)).toBe(200);
    expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'in_game', kickoff_kind: 'custom' });
    expect(posts).toHaveLength(1);
    expect(titleOf(0)).toBe(GAME_ON_CUSTOM_TITLE);
    expect(descriptionLines(0)[0]).toBe(GAME_ON_CUSTOM_DESCRIPTION);
    expect(descriptionLines(0)[1]).toMatch(/^\*\*Blue \d+%\*\* · \*\*\d+% Red\*\*$/);
    // Mentions off as for every post: embeds only (no `content`, so nothing can ping) and names
    // escaped by `renderName`; a plain new message (the fake only sees POSTs, never an edit).
    expect(Object.keys(posts[0] ?? {}).sort()).toEqual(['embeds', 'username']);

    expect(await start(partyId, gameId, tokens.second)).toBe(200);
    expect(await start(partyId, gameId)).toBe(200);
    expect(posts).toHaveLength(1);
  });

  it('(3) rolled and kept, and rolled on swapped sides: no Game on post', async () => {
    for (const swap of [false, true]) {
      const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
      await rollForTest(db, lobbyId);
      const split = await chosenTeams(lobbyId);
      await postMembers(partyId, swap ? sided(split.red, split.blue) : sided(split.blue, split.red));
      posts = [];
      expect(await start(partyId, testGameId())).toBe(200);
      expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'in_game', kickoff_kind: 'rolled' });
      expect(posts).toHaveLength(0);
    }
  });

  it('nobody rolled: one Game on post with the odds', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    expect(await start(partyId, testGameId())).toBe(200);
    expect(await lobbyRow(lobbyId)).toMatchObject({ kickoff_kind: 'unrolled' });
    expect(posts).toHaveLength(1);
    expect(titleOf(0)).toBe(GAME_ON_UNROLLED_TITLE);
    expect(descriptionLines(0)[0]).toBe(GAME_ON_UNROLLED_DESCRIPTION);
    expect(descriptionLines(0)).toHaveLength(4);
  });

  it('a not-rated game: the not-rated line, no odds', async () => {
    const card = await db.from('group_modes').update({ rated_override: false }).eq('group_id', groups.g);
    expect(card.error).toBeNull();
    try {
      const { partyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
      expect(await start(partyId, testGameId())).toBe(200);
      expect(posts).toHaveLength(1);
      expect(descriptionLines(0)).toEqual([GAME_ON_UNROLLED_DESCRIPTION, '**This game: not rated.**']);
    } finally {
      await db.from('group_modes').update({ rated_override: null }).eq('group_id', groups.g);
    }
  });

  it('(2) a Discord failure is logged, never fails the post, and the retry neither moves nor posts again', async () => {
    answer = (response) => response.writeHead(500).end();
    const { partyId, lobbyId } = await rolledThenSwapped();
    const gameId = testGameId();
    expect(await start(partyId, gameId)).toBe(200);
    expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'in_game', kickoff_kind: 'custom' });
    const attempts = posts.length;
    expect(attempts).toBeGreaterThan(0);
    answer = (response) => response.writeHead(204).end();
    expect(await start(partyId, gameId)).toBe(200);
    expect(posts).toHaveLength(attempts);
  });

  it('a slow Discord never delays the in_progress answer or the live signal', async () => {
    // The fake takes the post and does not answer until the test lets it.
    const held: ServerResponse[] = [];
    const { partyId, lobbyId } = await rolledThenSwapped();
    answer = (response) => held.push(response);
    const { data: before } = await db.from('group_live').select('version').eq('group_id', groups.g).single();
    const began = Date.now();
    const outcome = await Promise.race([
      startOnly(partyId, testGameId()).then((response) => response.status),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 2_000)),
    ]);
    expect(outcome).toBe(200);
    expect(Date.now() - began).toBeLessThan(2_000);
    // Answered with the kickoff written and the group already told (the flush did not wait either).
    expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'in_game', kickoff_kind: 'custom' });
    const { data: after } = await db.from('group_live').select('version').eq('group_id', groups.g).single();
    expect(Number(after?.version)).toBe(Number(before?.version) + 1);
    // The post is still on its way: wait for it to reach the fake, then let it land.
    for (let waited = 0; held.length === 0 && waited < 5_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(held).toHaveLength(1);
    for (const response of held) response.writeHead(204).end();
    await settleDetached();
    expect(posts).toHaveLength(1);
    expect(titleOf(0)).toBe(GAME_ON_CUSTOM_TITLE);
  }, 15_000);

  it('(5) no channel connected: no message, the post still answers 200', async () => {
    await db.from('discord_config').delete().eq('group_id', groups.g);
    try {
      const { partyId, lobbyId } = await rolledThenSwapped();
      expect(await start(partyId, testGameId())).toBe(200);
      expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'in_game', kickoff_kind: 'custom' });
      expect(posts).toHaveLength(0);
    } finally {
      await connectChannel();
    }
  });
}
