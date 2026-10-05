import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { settleDetached } from '../afterResponse';
import { mintCompanionToken } from '../companionAuth';
import { ensurePlayers } from '../ingest/players';
import { eogBody, testGameId } from '../testing/fixtures';
import { createTestGroups, deleteTestGroups, pinTestGroupMode, setTestMembership } from '../testing/groups';
import { resolveLocalStack } from '../testing/localStack';
import { rollForTest } from '../testing/roll';

/**
 * M22.7 against the local stack: a post names its lobby while two or more are live at send time
 * (`liveTables`, the post's own table counted), through the real companion routes, the real roll
 * and a webhook that is a real HTTP server in this process. Then the other lobby ends: the posted
 * label stays (posts are never edited; the AI recap edit re-sends the stored E1), and the next post
 * is the one-lobby post again.
 *
 * One group of its own, two hosts (Ana's Kustom in X, Bo's in Y). Skipped without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('lobby labels on Discord against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const ORIGIN = 'https://kustom.example';
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  // Importing the game route registers the Discord hooks (`lib/ingest/discord.ts`).
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { resetWebhookWarning } = await import('./webhook');
  const { postTeamsForSplit } = await import('./post');
  const { editResultWithRecap } = await import('./aiEdit');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 14 }, (_, index) => `it-${runId}-ll${index}`);
  const ANA = all[0] ?? '';
  const BO = all[1] ?? '';
  /** X: Ana and nine; Y: Bo and three. */
  const tenX = [ANA, ...all.slice(2, 11)];
  const fourY = [BO, ...all.slice(11, 14)];
  const NAMES = new Map([
    [ANA, 'Ana'],
    [BO, 'Bo'],
  ]);
  const idOf = new Map<string, string>();
  const tokens = { ana: '', bo: '' };
  let groupId = '';
  let slug = '';
  const gameIds: number[] = [];

  let server: Server | null = null;
  let webhookUrl = '';
  let posts: { method: string; body: Record<string, unknown> }[] = [];

  const jsonRequest = (path: string, body: unknown, bearer: string) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });

  async function postMembers(partyId: string, puuids: readonly string[], bearer: string) {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `labels ${partyId.slice(-1)}`,
          members: puuids.map((puuid, index) => ({
            puuid,
            gameName: NAMES.get(puuid) ?? `Ll${all.indexOf(puuid)}`,
            tagLine: 'EUW',
            summonerId: 9_100 + all.indexOf(puuid),
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        bearer,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { lobbyId: string };
  }

  async function chosenSplitId(lobbyId: string): Promise<string> {
    const { data, error } = await db
      .from('splits')
      .select('id')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  const e1 = (post: { body: Record<string, unknown> } | undefined) =>
    ((post?.body.embeds ?? []) as { title?: string; url?: string; author?: { url?: string } }[])[0];

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    groupId = (await createTestGroups(db, runId, ['ll'] as const)).ll;
    const group = await db.from('groups').select('slug').eq('id', groupId).single();
    if (group.error) throw new Error(group.error.message);
    slug = group.data.slug;
    await pinTestGroupMode(db, groupId, 'normal');
    await setTestMembership(db, groupId, idOf.get(ANA) ?? '', 'owner');
    for (const puuid of all.slice(1)) await setTestMembership(db, groupId, idOf.get(puuid) ?? '', 'member');
    for (const [key, puuid] of [
      ['ana', ANA],
      ['bo', BO],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `ll-${key}-${runId}`,
        group_id: groupId,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }

    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({
          method: incoming.method ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
        // An edit answers the message, as Discord does; a plain post answers 204.
        if (incoming.method === 'PATCH') {
          response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"m-1"}');
        } else {
          response.writeHead(204).end();
        }
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;
    const config = await db
      .from('discord_config')
      .upsert({ group_id: groupId, guild_id: `it-${runId}-llguild`, webhook_url: webhookUrl });
    if (config.error) throw new Error(config.error.message);
  });

  afterEach(() => {
    resetWebhookWarning();
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, [groupId]);
    await db.from('players').delete().in('puuid', all);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  it('one live lobby, then two: the teams post is today’s, then leads with the label', async () => {
    const X = `it-${runId}-party-X`;
    const Y = `it-${runId}-party-Y`;
    const x = await postMembers(X, tenX, tokens.ana);
    posts = [];

    // One table: the roll's teams post is byte for byte the one-lobby post.
    await rollForTest(db, x.lobbyId, { requestOrigin: ORIGIN });
    await settleDetached();
    expect(posts).toHaveLength(1);
    expect(e1(posts[0])?.title).toBe('Teams are set');
    expect(e1(posts[0])?.url).toBe(`${ORIGIN}/g/${slug}`);

    // Bo's Kustom opens Y: two tables live. The same split posted again names Ana's lobby.
    const y = await postMembers(Y, fourY, tokens.bo);
    const splitId = await chosenSplitId(x.lobbyId);
    posts = [];
    expect((await postTeamsForSplit(db, splitId, { requestOrigin: ORIGIN })).status).toBe('posted');
    expect(posts).toHaveLength(1);
    const labelled = e1(posts[0]);
    expect(labelled?.title).toBe("Ana's lobby · Teams are set");
    expect(labelled?.url).toBe(`${ORIGIN}/g/${slug}?lobby=${x.lobbyId}`);
    expect(labelled?.author?.url).toBe(`${ORIGIN}/g/${slug}?lobby=${x.lobbyId}`);
    const e4 = ((posts[0]?.body.embeds ?? []) as { url?: string }[])[3];
    expect(e4?.url).toBe(`${ORIGIN}/g/${slug}?lobby=${x.lobbyId}#how-the-bot-decided`);

    // X's game ends while Y is live: the result names Ana's lobby; its title still links the game.
    const gameId = testGameId() + 71;
    gameIds.push(gameId);
    posts = [];
    const eog = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({
          gameId,
          partyId: X,
          puuids: tenX,
          startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        }),
        tokens.ana,
      ),
    );
    expect(eog.status).toBe(200);
    await settleDetached();
    const results = posts.filter((post) => /wins/.test(e1(post)?.title ?? ''));
    expect(results).toHaveLength(1);
    const result = results[0];
    const game = await db.from('games').select('id').eq('lcu_game_id', gameId).single();
    if (game.error) throw new Error(game.error.message);
    expect(e1(result)?.title).toBe("Ana's lobby · Blue wins · 32 min");
    expect(e1(result)?.url).toBe(`${ORIGIN}/g/${slug}/games/${game.data.id}`);
    expect(e1(result)?.author?.url).toBe(`${ORIGIN}/g/${slug}?lobby=${x.lobbyId}`);

    // A second companion's copy of the same block: no second post.
    const before = posts.length;
    const again = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({
          gameId,
          partyId: X,
          puuids: tenX,
          startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        }),
        tokens.ana,
      ),
    );
    expect(again.status).toBe(200);
    await settleDetached();
    expect(posts).toHaveLength(before);

    // Y ends. The result post keeps its label: the AI recap edit re-sends the stored E1.
    const ended = await db.from('lobbies').update({ status: 'abandoned' }).eq('id', y.lobbyId);
    expect(ended.error).toBeNull();
    const posted = result?.body as unknown as import('./embeds').WebhookPayload;
    posts = [];
    const edit = await editResultWithRecap(
      db,
      { gameId: game.data.id, line: 'Blue closed it out.', now: new Date() },
      { record: { groupId, messageId: 'm-1', postedAt: new Date(), payload: posted } },
    );
    expect(edit).toEqual({ status: 'edited' });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.method).toBe('PATCH');
    expect(e1(posts[0])).toEqual(e1(result));
    expect(e1(posts[0])?.title).toBe("Ana's lobby · Blue wins · 32 min");

    // One table left (X, finished, in its walk back): the next post is the one-lobby post again.
    posts = [];
    expect((await postTeamsForSplit(db, splitId, { requestOrigin: ORIGIN })).status).toBe('posted');
    expect(e1(posts[0])?.title).toBe('Teams are set');
    expect(e1(posts[0])?.url).toBe(`${ORIGIN}/g/${slug}`);
  });
}
