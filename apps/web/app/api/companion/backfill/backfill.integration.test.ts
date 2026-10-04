import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { clearLobbyHooks, type GameFinishedEvent, registerLobbyHook } from '@/lib/ingest/hooks';
import { ensurePlayers } from '@/lib/ingest/players';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Backfill's server half (M5.1) against the Supabase CLI local stack: the scan route and the game
 * route's two `source: 'backfill'` turns. There is no approval step any more
 * (`04-decisions.md`, 2026-10-03): every member's scan is answered, and the admin action that
 * used to gate it is retired with a 410.
 *
 * The contract being checked is the doc comment on `companionBackfillScanRequestSchema` in
 * `packages/db/src/schemas/companionResponses.ts`, which the companion half implements against.
 * Anything here that disagrees with that comment is this file's bug.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`). Every row is namespaced
 * with a run id and deleted afterwards.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('backfill against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';
  // M3.3's poster reads this at module load; with no webhook there is nothing to post to, and
  // the hook spy below is what actually proves a backfilled game announces nothing.
  process.env.DISCORD_WEBHOOK_URL = '';

  const { POST: postScan } = await import('./scan/route');
  const { POST: postGame } = await import('../game/route');
  const { POST: postLobby } = await import('../lobby/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const puuids = testPuuids(runId);
  const ownerPuuid = puuids[0] as string;
  const outsiderPuuid = `it-${runId}-outsider`;
  const allPuuids = [...puuids, outsiderPuuid];

  const partyId = `it-party-${runId}-bf`;
  const baseGameId = testGameId();
  const backfillGameId = baseGameId + 1;
  const eogFirstGameId = baseGameId + 2;
  const lobbyControlGameId = baseGameId + 3;
  const outsiderGameId = baseGameId + 4;
  const scanKnownGameId = baseGameId + 5;
  const scanUnknownGameId = baseGameId + 6;
  const staleNameGameId = baseGameId + 7;
  const staleBackfillGameId = baseGameId + 8;
  const banMergeGameId = baseGameId + 9;
  const gameIds = [
    backfillGameId,
    eogFirstGameId,
    lobbyControlGameId,
    outsiderGameId,
    scanKnownGameId,
    scanUnknownGameId,
    staleNameGameId,
    staleBackfillGameId,
    banMergeGameId,
  ];

  let ownerToken = '';
  let outsiderToken = '';
  let ownerPlayerId = '';
  let rosterPlayerIds: string[] = [];

  const finished: GameFinishedEvent[] = [];

  async function mintToken(puuid: string, label: string): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const playerId = ids.get(puuid);
    if (playerId === undefined) throw new Error(`no player for ${puuid}`);

    const { token, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ group_id: ORIGINAL_GROUP_ID, player_id: playerId, token_hash: tokenHash, label });
    if (error) throw new Error(`mintToken: ${error.message}`);
    return token;
  }

  /** Every `ratings` row for the ten, ordered: the thing a backfill post must not move. */
  async function readRatings(): Promise<unknown[]> {
    const { data, error } = await db
      .from('ratings')
      .select('*')
      .in('player_id', rosterPlayerIds)
      .order('player_id')
      .order('group_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  function post(body: unknown, token: string | null): Request {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
   * The owner's membership row, whole. The two retired M5.1 columns are still in the schema and
   * must stay exactly as they are: nothing reads or writes them any more.
   */
  async function readMembership(): Promise<unknown> {
    const { data, error } = await db
      .from('group_memberships')
      .select('*')
      .eq('group_id', ORIGINAL_GROUP_ID)
      .eq('player_id', ownerPlayerId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** The ten `players` rows, whole and ordered: what a backfill post must not rewrite. */
  async function readPlayers(): Promise<unknown[]> {
    const { data, error } = await db
      .from('players')
      .select('id, puuid, summoner_id, game_name, tag_line, display_name')
      .in('puuid', puuids)
      .order('puuid');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** A backfill body: the eog body with `source`, no `partyId` key, and `role: null` on all ten. */
  function backfillBody(gameId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const body = eogBody({ gameId, puuids, startedAt: '2026-08-20T19:00:00.000Z' }) as Record<
      string,
      unknown
    >;
    const { partyId: _dropped, ...rest } = body;
    const participants = (body.participants as Record<string, unknown>[]).map((participant) => ({
      ...participant,
      role: null,
    }));
    return { ...rest, participants, source: 'backfill', ...overrides };
  }

  beforeAll(async () => {
    ownerToken = await mintToken(ownerPuuid, `it-${runId}-owner`);
    outsiderToken = await mintToken(outsiderPuuid, `it-${runId}-outsider`);
    const roster = await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    rosterPlayerIds = puuids.map((puuid) => roster.get(puuid) ?? '');

    const ids = await ensurePlayers(db, [{ puuid: ownerPuuid }]);
    ownerPlayerId = ids.get(ownerPuuid) ?? '';

    // Only this file's listener, so "no Discord post" is an assertion about what ingest emitted
    // rather than about a webhook being unset.
    clearLobbyHooks();
    registerLobbyHook({
      onFinished: (event) => {
        finished.push(event);
      },
    });
  });

  afterAll(async () => {
    clearLobbyHooks();
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('players').delete().in('puuid', allPuuids);
  });

  describe('POST /api/companion/backfill/scan', () => {
    it('answers a member who was never approved, and writes nothing to the membership', async () => {
      const before = (await readMembership()) as {
        backfill_requested_at: string | null;
        backfill_approved_at: string | null;
      };
      // The case M5.1 refused: nobody ever pressed Allow for this player.
      expect(before.backfill_requested_at).toBeNull();
      expect(before.backfill_approved_at).toBeNull();

      const first = await postScan(post({ gameIds: [scanUnknownGameId] }, ownerToken));
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true, approved: true, unknown: [scanUnknownGameId] });

      // The same scan twice is the same answer, and the membership row never moves.
      const second = await postScan(post({ gameIds: [scanUnknownGameId] }, ownerToken));
      expect(await second.json()).toEqual({ ok: true, approved: true, unknown: [scanUnknownGameId] });
      expect(await readMembership()).toEqual(before);
    });

    it('refuses a bad batch and an anonymous caller before it reads anything', async () => {
      expect((await postScan(post({ gameIds: [] }, ownerToken))).status).toBe(400);
      expect((await postScan(post({ gameIds: [0] }, ownerToken))).status).toBe(400);
      expect(
        (await postScan(post({ gameIds: Array.from({ length: 101 }, (_, i) => i + 1) }, ownerToken))).status,
      ).toBe(400);
      expect((await postScan(post({ gameIds: [scanUnknownGameId] }, null))).status).toBe(401);
    });

    it('answers with only the ids we do not already have', async () => {
      // One game the database already has, from an ordinary end-of-game post.
      const stored = await postGame(
        post(eogBody({ gameId: scanKnownGameId, puuids, partyId: null }), ownerToken),
      );
      expect(stored.status).toBe(200);

      const response = await postScan(
        post({ gameIds: [scanKnownGameId, scanUnknownGameId, scanUnknownGameId] }, ownerToken),
      );
      expect(response.status).toBe(200);
      // The live eog row is stored but has no `teams[].bans`, so it still needs a
      // match-history detail. De-duplicated, in the order asked.
      expect(await response.json()).toEqual({
        ok: true,
        approved: true,
        unknown: [scanKnownGameId, scanUnknownGameId],
      });
    });
  });

  describe('POST /api/companion/game with source backfill', () => {
    it('stores the game and its ten players without rating any of them', async () => {
      finished.length = 0;
      // Some of these ten already have a rating, from the end-of-game post the scan test made.
      // "Not rated inline" is that nothing moves, not that nobody has a number.
      const ratingsBefore = await readRatings();

      const response = await postGame(post(backfillBody(backfillGameId), ownerToken));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({
        ok: true,
        phase: 'eog',
        created: true,
        participants: 10,
        rated: false,
        reason: 'backfill',
      });
      expect(json.lobbyId).toBeNull();

      const { data: game } = await db
        .from('games')
        .select('id, source, lobby_id, started_at')
        .eq('lcu_game_id', backfillGameId)
        .single();
      expect(game?.source).toBe('backfill');
      expect(game?.lobby_id).toBeNull();

      const { data: rows } = await db
        .from('game_players')
        .select('player_id, role, mu_before, sigma_before, mu_after, sigma_after')
        .eq('game_id', game?.id ?? '');
      expect(rows).toHaveLength(10);
      for (const row of rows ?? []) {
        expect(row.role).toBeNull();
        expect(row.mu_before).toBeNull();
        expect(row.sigma_before).toBeNull();
        expect(row.mu_after).toBeNull();
        expect(row.sigma_after).toBeNull();
      }

      // Not one `ratings` row moved, `updated_at` included.
      expect(await readRatings()).toEqual(ratingsBefore);

      // And nothing was announced: an unrated custom from three weeks ago is not tonight's game.
      expect(finished).toHaveLength(0);
    });

    it('is idempotent, and never overwrites a game we captured live', async () => {
      // The live capture first: a real end-of-game post, rated inline.
      const live = await postGame(
        post(eogBody({ gameId: eogFirstGameId, puuids, partyId: null }), ownerToken),
      );
      expect(live.status).toBe(200);
      expect((await live.json()).rated).toBe(true);

      const beforeGame = await db
        .from('games')
        .select('id, source, raw, started_at, duration_s, winning_side')
        .eq('lcu_game_id', eogFirstGameId)
        .single();
      const beforeRows = await db
        .from('game_players')
        .select('*')
        .eq('game_id', beforeGame.data?.id ?? '')
        .order('player_id');

      const beforePlayers = await readPlayers();

      finished.length = 0;
      // Carrying names, so the assertion below is about the rule and not about an empty field:
      // a re-post of a stored game claims no name at all (M5.1 review).
      const repost = backfillBody(eogFirstGameId, {
        startedAt: '2020-01-01T00:00:00.000Z',
        durationS: 999,
      }) as Record<string, unknown>;
      const response = await postGame(
        post(
          {
            ...repost,
            participants: (repost.participants as Record<string, unknown>[]).map((participant) => ({
              ...participant,
              gameName: 'NameFromAnOldGame',
              tagLine: 'OLD',
            })),
          },
          ownerToken,
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: false, rated: false, reason: 'backfill' });

      const afterGame = await db
        .from('games')
        .select('id, source, raw, started_at, duration_s, winning_side')
        .eq('lcu_game_id', eogFirstGameId)
        .single();
      const afterRows = await db
        .from('game_players')
        .select('*')
        .eq('game_id', afterGame.data?.id ?? '')
        .order('player_id');

      // Not one column: `source` is still eog, and the ten rated rows are byte-identical.
      expect(afterGame.data).toEqual(beforeGame.data);
      expect(afterGame.data?.source).toBe('eog');
      expect(afterRows.data).toEqual(beforeRows.data);
      expect(finished).toHaveLength(0);
      // And not one `players` row either: a re-post of a game we have says nothing about who
      // anybody is (M5.1 review).
      expect(await readPlayers()).toEqual(beforePlayers);
    });

    it('copies teams[].bans onto a live eog row that never stored them', async () => {
      const live = await postGame(
        post(
          eogBody({
            gameId: banMergeGameId,
            puuids,
            partyId: null,
            raw: {
              gameMode: 'CLASSIC',
              teams: [
                { teamId: 100, players: [{ puuid: ownerPuuid }] },
                { teamId: 200, players: [] },
              ],
            },
          }),
          ownerToken,
        ),
      );
      expect(live.status).toBe(200);

      const before = await db
        .from('games')
        .select('id, source, raw')
        .eq('lcu_game_id', banMergeGameId)
        .single();
      expect(before.data?.source).toBe('eog');

      const detail = backfillBody(banMergeGameId, {
        raw: {
          gameMode: 'CLASSIC',
          teams: [
            { teamId: 100, bans: [{ championId: 11, pickTurn: 1 }] },
            { teamId: 200, bans: [{ championId: 154, pickTurn: 6 }] },
          ],
        },
      });
      const response = await postGame(post(detail, ownerToken));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: false });

      const after = await db.from('games').select('source, raw').eq('lcu_game_id', banMergeGameId).single();
      expect(after.data?.source).toBe('eog');
      const teams =
        (after.data?.raw as { teams?: { bans?: { championId: number }[] }[] } | null)?.teams ?? [];
      expect(teams.flatMap((team) => team.bans ?? []).map((ban) => ban.championId)).toEqual([11, 154]);

      const scan = await postScan(post({ gameIds: [banMergeGameId] }, ownerToken));
      expect(await scan.json()).toEqual({ ok: true, approved: true, unknown: [] });
    });

    it('never walks a name backwards: an old detail does not rename a player we know', async () => {
      // Today's name, arriving the way names really arrive: an end-of-game post.
      const renamed = puuids[3] as string;
      const named = await postGame(
        post(
          {
            ...eogBody({ gameId: staleNameGameId, puuids, partyId: null }),
            participants: (
              eogBody({ gameId: staleNameGameId, puuids, partyId: null }).participants as Record<
                string,
                unknown
              >[]
            ).map((participant) =>
              participant.puuid === renamed
                ? { ...participant, gameName: 'NameToday', tagLine: 'EUW' }
                : participant,
            ),
          },
          ownerToken,
        ),
      );
      expect(named.status).toBe(200);

      const { data: before } = await db
        .from('players')
        .select('game_name, tag_line, display_name')
        .eq('puuid', renamed)
        .single();
      expect(before?.game_name).toBe('NameToday');
      expect(before?.display_name).toBe('NameToday');

      // Now a backfilled game from months ago, carrying the name they had then. It creates a
      // new game row (so the name path is not skipped for being a duplicate) and must still
      // leave every stored name exactly where it is.
      const stale = backfillBody(staleBackfillGameId) as Record<string, unknown>;
      const response = await postGame(
        post(
          {
            ...stale,
            participants: (stale.participants as Record<string, unknown>[]).map((participant) =>
              participant.puuid === renamed
                ? { ...participant, gameName: 'NameLastYear', tagLine: 'OLD' }
                : participant,
            ),
          },
          ownerToken,
        ),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).created).toBe(true);

      const { data: after } = await db
        .from('players')
        .select('game_name, tag_line, display_name')
        .eq('puuid', renamed)
        .single();
      expect(after).toEqual(before);
    });

    it('403s a poster who is not on the scoreboard, even from inside the lobby', async () => {
      // The outsider is a lobby member, which is exactly what M2.8's fallback exists for.
      const lobby = await postLobby(
        post(
          {
            partyId,
            lobbyName: 'customs night',
            lobbyPassword: null,
            members: [
              ...puuids.map((puuid, index) => ({
                puuid,
                gameName: null,
                tagLine: null,
                summonerId: null,
                side: index < 5 ? 100 : 200,
                isSpectator: false,
              })),
              {
                puuid: outsiderPuuid,
                gameName: null,
                tagLine: null,
                summonerId: null,
                side: null,
                isSpectator: true,
              },
            ],
          },
          outsiderToken,
        ),
      );
      expect(lobby.status).toBe(200);

      // The control: as an ordinary end-of-game post the same caller is accepted (M2.8).
      const control = await postGame(
        post(eogBody({ gameId: lobbyControlGameId, puuids, partyId }), outsiderToken),
      );
      expect(control.status).toBe(200);

      // The rule: for backfill the lobby half does not apply, whatever party id is claimed.
      const refused = await postGame(post(backfillBody(outsiderGameId, { partyId }), outsiderToken));
      expect(refused.status).toBe(403);

      const { count } = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('lcu_game_id', outsiderGameId);
      expect(count).toBe(0);
    });
  });
}
