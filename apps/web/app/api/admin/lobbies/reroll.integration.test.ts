import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NO_MORE_SPLITS, NO_SUCH_LOBBY } from '@/lib/admin/reroll';
import {
  type AdminAuthResult,
  authorizeAdmin,
  NOT_A_GROUP_ADMIN,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { storedRosterKey } from '@/lib/testing/roll';

/**
 * Reroll (M3.2) against the Supabase CLI local stack, with a webhook that is a real HTTP
 * server in this process.
 *
 * The lobby gets to `balanced` the way it really does — the companion posts it through the real
 * route and an admin presses the real roll route (2026-10-03) — so the three splits under test
 * are core's own, ranked and stored by `storeSplits`. Then the real reroll route promotes them.
 *
 * What it is here to prove: two presses put two messages in the channel with the right titles
 * and the right chosen row, a third one is refused with the sentence the group reads on the
 * page, and a lobby that is not `balanced` changes nothing.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('reroll against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';

  const { rerollRoute } = await import('./[lobbyId]/reroll/handler');
  // The real export, environment and all: this is what answers an anonymous request.
  const { POST: rerollRouteExport } = await import('./[lobbyId]/reroll/route');
  const { POST: postLobby } = await import('../../companion/lobby/route');
  // Importing the roll handler is also what registers the Discord hooks.
  const { rollRoute } = await import('./[lobbyId]/roll/handler');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-rr${String(index).padStart(2, '0')}`);
  /** A second lobby of its own ten: the "split of another lobby" and "not balanced" cases. */
  const other = Array.from({ length: 10 }, (_, index) => `it-${runId}-ro${String(index).padStart(2, '0')}`);
  const adminPuuid = `it-${runId}-rr-admin`;
  const allPuuids = [...ten, ...other, adminPuuid];
  const adminDiscordId = `8${runId.replace(/\D/g, '') || '1'}00001`;
  const memberDiscordId = `8${runId.replace(/\D/g, '') || '1'}00002`;
  const guildId = `it-${runId}-rr-guild`;
  const partyIds = new Set<string>();
  /** The file's own group (M13.4): its lobbies, tokens and Discord row, and nobody else's. */
  const groups = { a: '' };

  let token = '';
  let otherToken = '';
  let webhookUrl = '';
  let server: Server | null = null;
  let posts: { body: Record<string, unknown> }[] = [];
  let lobbyId = '';
  let otherLobbyId = '';
  let splits: { id: string; rank: number; explanation: string }[] = [];
  let otherSplitId = '';

  /** A signed-in user carrying a Discord identity, the shape `auth.getUser()` returns. */
  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /** The real gate with only the session injected: the group membership is still read for real. */
  function authorizeAs(user: SessionUserLike | null) {
    return async (_request: Request, client: typeof db, groupId: string | null): Promise<AdminAuthResult> =>
      authorizeAdmin({
        resolveSessionUser: async () => user,
        lookupPlayerByDiscordId: supabaseAdminLookup(client),
        lookupGroupRole: supabaseGroupRole(client),
        groupId,
      });
  }

  function reroll(id: string, user: SessionUserLike | null = sessionUser(adminDiscordId)) {
    return rerollRoute(id, { getClient: () => db, authorize: authorizeAs(user) });
  }

  /** Every admin body names its group (M13.4): this file's, unless the body names one. */
  function post(id: string, body: object): Request {
    return new Request(`http://localhost/api/admin/lobbies/${id}/reroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('groupId' in body ? body : { groupId: groups.a, ...body }),
    });
  }

  function lobbyBody(partyId: string, members: readonly string[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs-night',
      members: members.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 4_000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    };
  }

  function companionRequest(json: unknown, bearer: string): Request {
    return new Request('http://localhost/api/companion/lobby', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(json),
    });
  }

  /** The single embed of a post. */
  function embedOf(index: number): Record<string, unknown> | undefined {
    return ((posts[index]?.body.embeds ?? []) as Record<string, unknown>[])[0];
  }

  /** What a lobby needs: one companion post to open it, and an admin's roll to balance it. */
  async function driveToBalanced(partyId: string, members: readonly string[], bearer: string) {
    partyIds.add(partyId);
    const first = await postLobby(companionRequest(lobbyBody(partyId, members), bearer));
    expect(first.status).toBe(200);
    const { lobbyId: id } = (await first.json()) as { lobbyId: string };

    const rolled = await rollRoute(id, {
      getClient: () => db,
      authorize: authorizeAs(sessionUser(adminDiscordId)),
    })(
      new Request(`http://localhost/api/admin/lobbies/${id}/roll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: groups.a, rosterKey: await storedRosterKey(db, id) }),
      }),
    );
    expect(await rolled.json()).toMatchObject({ status: 'balanced', outcome: 'rolled' });
    return id;
  }

  async function chosenRows(id: string): Promise<{ rank: number }[]> {
    const { data } = await db.from('splits').select('rank').eq('lobby_id', id).eq('is_chosen', true);
    return data ?? [];
  }

  function splitOfRank(rank: number): { id: string; rank: number; explanation: string } {
    const split = splits.find((row) => row.rank === rank);
    if (split === undefined) throw new Error(`no split of rank ${rank}`);
    return split;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      allPuuids.map((puuid) => ({ puuid })),
    );
    Object.assign(groups, await createTestGroups(db, runId, ['a'] as const));

    const { error: adminError } = await db
      .from('players')
      .update({ discord_id: adminDiscordId })
      .eq('id', ids.get(adminPuuid) ?? '');
    if (adminError) throw new Error(adminError.message);
    await setTestMembership(db, groups.a, ids.get(adminPuuid) ?? '', 'admin');

    // Somebody signed in who is not an admin: the button is never rendered for them and the
    // route must refuse them too.
    const { error: memberError } = await db
      .from('players')
      .update({ discord_id: memberDiscordId })
      .eq('id', ids.get(ten[0] ?? '') ?? '');
    if (memberError) throw new Error(memberError.message);

    async function mintFor(puuid: string): Promise<string> {
      const { token: raw, tokenHash } = mintCompanionToken();
      const { error } = await db.from('companion_tokens').insert({
        group_id: groups.a,
        player_id: ids.get(puuid) ?? '',
        token_hash: tokenHash,
        label: `rr-${runId}`,
      });
      if (error) throw new Error(error.message);
      return raw;
    }
    token = await mintFor(ten[0] ?? '');
    otherToken = await mintFor(other[0] ?? '');

    server = createServer((incoming, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
        response.writeHead(204).end();
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;

    const { error: configError } = await db
      .from('discord_config')
      .insert({ group_id: groups.a, guild_id: guildId, webhook_url: webhookUrl });
    if (configError) throw new Error(configError.message);

    lobbyId = await driveToBalanced(`rr-${runId}`, ten, token);
    otherLobbyId = await driveToBalanced(`rr-${runId}-other`, other, otherToken);

    const { data } = await db
      .from('splits')
      .select('id, rank, explanation')
      .eq('lobby_id', lobbyId)
      .order('rank', { ascending: true });
    splits = data ?? [];
    expect(splits.map((split) => split.rank)).toEqual([1, 2, 3]);

    const { data: otherSplit } = await db
      .from('splits')
      .select('id')
      .eq('lobby_id', otherLobbyId)
      .eq('rank', 2)
      .single();
    otherSplitId = otherSplit?.id ?? '';

    // The two balances posted a teams embed each; the reroll cases count their own.
    posts = [];
  });

  afterEach(() => {
    posts = [];
  });

  afterAll(async () => {
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', allPuuids);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  describe('two presses, and no third', () => {
    it('promotes split 2 and posts it as reroll 1 of 2, description verbatim', async () => {
      const target = splitOfRank(2);
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: target.id }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        lobbyId,
        splitId: target.id,
        rank: 2,
        splitCount: 3,
        promoted: true,
        post: 'posted',
      });

      // Exactly one chosen row per lobby, and it is the one that was asked for.
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 2 }]);

      expect(posts).toHaveLength(1);
      expect(embedOf(0)?.title).toBe('Teams are set · reroll 1 of 2');
      // The promoted split's stored sentence, character for character. Never recomposed.
      expect(embedOf(0)?.description).toBe(target.explanation);
    });

    it('is a no-op on the second tap: 200, still one chosen row, and no second message', async () => {
      const target = splitOfRank(2);
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: target.id }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ promoted: false, post: null, rank: 2 });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 2 }]);
      expect(posts).toHaveLength(0);
    });

    it('promotes split 3 as reroll 2 of 2', async () => {
      const target = splitOfRank(3);
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: target.id }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ rank: 3, promoted: true, post: 'posted' });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 3 }]);
      expect(posts).toHaveLength(1);
      expect(embedOf(0)?.title).toBe('Teams are set · reroll 2 of 2');
      expect(embedOf(0)?.description).toBe(target.explanation);
    });

    it('refuses the third press with the sentence the page shows, and posts nothing', async () => {
      // A stale tab pressing again: there is no fourth split, so there is no third reroll.
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: splitOfRank(2).id }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: NO_MORE_SPLITS });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 3 }]);
      expect(posts).toHaveLength(0);
    });

    it('puts split 1 back under the plain title', async () => {
      const target = splitOfRank(1);
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: target.id }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ rank: 1, promoted: true });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);
      expect(embedOf(0)?.title).toBe('Teams are set');
      expect(embedOf(0)?.description).toBe(target.explanation);
    });
  });

  describe('the presses that are refused', () => {
    it('404s a split that belongs to another lobby, and 404s a lobby that does not exist', async () => {
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: otherSplitId }));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'that split does not belong to this lobby',
      });

      const missing = randomUUID();
      const gone = await reroll(missing)(post(missing, { splitId: splitOfRank(2).id }));
      expect(gone.status).toBe(404);

      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);
      expect(posts).toHaveLength(0);
    });

    it('404s a lobby id that is not a uuid at all, rather than letting Postgres 500', async () => {
      // The lobby is a path segment, so anything can arrive in it. `lobbies.id` is a uuid
      // column and an unparsable one is 22P02 — an "our bug" 500 for a request that is only
      // asking about a lobby that does not exist.
      const response = await reroll('not-a-uuid')(post('not-a-uuid', { splitId: splitOfRank(2).id }));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ ok: false, error: NO_SUCH_LOBBY });
      expect(posts).toHaveLength(0);
    });

    it('400s a body that does not name a split', async () => {
      const response = await reroll(lobbyId)(post(lobbyId, { splitId: 'next' }));
      expect(response.status).toBe(400);
      expect(posts).toHaveLength(0);
    });

    it('409s once the game has started: nothing promoted, nothing posted', async () => {
      // Ingest moves the lobby itself when the companion reports the game; the state is what
      // matters here, and every non-`balanced` status is refused the same way.
      const { error } = await db.from('lobbies').update({ status: 'in_game' }).eq('id', otherLobbyId);
      if (error) throw new Error(error.message);

      const response = await reroll(otherLobbyId)(post(otherLobbyId, { splitId: otherSplitId }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'the game has started, so the teams on the rift are the teams',
      });
      expect(await chosenRows(otherLobbyId)).toEqual([{ rank: 1 }]);
      expect(posts).toHaveLength(0);
    });

    it('409s a lobby that is only open, where the teams are not on the board yet', async () => {
      const { error } = await db.from('lobbies').update({ status: 'open' }).eq('id', otherLobbyId);
      if (error) throw new Error(error.message);

      const response = await reroll(otherLobbyId)(post(otherLobbyId, { splitId: otherSplitId }));
      expect(response.status).toBe(409);
      expect(posts).toHaveLength(0);
    });

    it('409s when the ten in that split are not all in the lobby any more', async () => {
      // The narrow window: somebody has left but no companion post has reopened the lobby yet,
      // so the status still says `balanced`. Promoting here and discovering it inside
      // `postTeamsForSplit` would answer `skipped` with the old chosen row already gone.
      const { error: statusError } = await db
        .from('lobbies')
        .update({ status: 'balanced' })
        .eq('id', otherLobbyId);
      if (statusError) throw new Error(statusError.message);

      const { data: leaver } = await db
        .from('players')
        .select('id')
        .eq('puuid', other[3] ?? '')
        .single();
      const { error: deleteError } = await db
        .from('lobby_members')
        .delete()
        .eq('lobby_id', otherLobbyId)
        .eq('player_id', leaver?.id ?? '');
      if (deleteError) throw new Error(deleteError.message);

      const response = await reroll(otherLobbyId)(post(otherLobbyId, { splitId: otherSplitId }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error:
          'the ten in that split are not all in the lobby any more, so nothing was promoted; roll the lobby again for new teams',
      });
      // Nothing moved: the lobby still has the split it was balanced with.
      expect(await chosenRows(otherLobbyId)).toEqual([{ rank: 1 }]);
      expect(posts).toHaveLength(0);
    });
  });

  describe('who may press it', () => {
    it('answers 401 to an anonymous request through the real route export', async () => {
      // No cookies at all: this is what a curl gets.
      const response = await rerollRouteExport(post(lobbyId, { splitId: splitOfRank(2).id }), {
        params: Promise.resolve({ lobbyId }),
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'sign in required' });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);
      expect(posts).toHaveLength(0);
    });

    it('answers 403 to a session whose player is not an admin', async () => {
      const response = await reroll(
        lobbyId,
        sessionUser(memberDiscordId),
      )(post(lobbyId, { splitId: splitOfRank(2).id }));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ ok: false, error: NOT_A_GROUP_ADMIN });
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);
      expect(posts).toHaveLength(0);
    });
  });

  describe('the form path, which is what /admin posts', () => {
    it('303s back to /admin with the notice, having promoted and posted', async () => {
      const target = splitOfRank(2);
      const request = new Request(`http://localhost/api/admin/lobbies/${lobbyId}/reroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ groupId: groups.a, splitId: target.id }).toString(),
      });

      const response = await reroll(lobbyId)(request);
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/admin');
      expect(location.searchParams.get('notice')).toBe('Split 2 is up: reroll 1 of 2. Posted to Discord.');
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 2 }]);
      expect(posts).toHaveLength(1);
    });

    it('comes back to the page the button was on when the body names one (M3.4)', async () => {
      // The tonight page's no-JavaScript fallback. With JavaScript it posts JSON, gets the
      // envelope and never navigates; without it, landing the friend on `/admin` after a
      // press on `/` would be the site answering a question nobody asked.
      const target = splitOfRank(1);
      const request = new Request(`http://localhost/api/admin/lobbies/${lobbyId}/reroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ groupId: groups.a, splitId: target.id, redirectTo: '/' }).toString(),
      });

      const response = await reroll(lobbyId)(request);
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('notice')).toBe('Split 1 is back on the board. Posted to Discord.');
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);
    });

    it('refuses a redirect off this site: the body cannot aim it anywhere', async () => {
      const target = splitOfRank(2);
      const post = (redirectTo: string) =>
        new Request(`http://localhost/api/admin/lobbies/${lobbyId}/reroll`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ groupId: groups.a, splitId: target.id, redirectTo }).toString(),
        });

      // `//evil.example` is protocol-relative: a browser reads it as another origin. The
      // schema refuses it outright, and the form is sent back to the page with `?error=`.
      const offSite = await reroll(lobbyId)(post('//evil.example'));
      expect(offSite.status).toBe(303);
      const refusal = new URL(offSite.headers.get('location') ?? '');
      expect(refusal.host).toBe('localhost');
      expect(refusal.pathname).toBe('/admin');
      expect(refusal.searchParams.get('error')).toBe('that form was not valid');
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 1 }]);

      // And a refusal from the route itself goes back to the page that was pressed, too.
      const refused = await reroll(lobbyId)(post('/'));
      expect(refused.status).toBe(303);
      const location = new URL(refused.headers.get('location') ?? '');
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('notice')).toBe('Split 2 is up: reroll 1 of 2. Posted to Discord.');
      expect(await chosenRows(lobbyId)).toEqual([{ rank: 2 }]);
    });
  });
}
