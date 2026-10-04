import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from '@customs/db';
import { ORIGINAL_GROUP_ID } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eogBody, lobbyBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The missed-game report (M5.5) against the Supabase CLI local stack, seeded through the ingest
 * path the companion really uses: a lobby post, the state machine, an end-of-game post.
 *
 * The page itself is an admin server component behind `requireAdmin()`; what is asserted here
 * is the pair of queries it renders, which is where every claim in the brief lives. The last
 * describe holds this page's two structural rules — no write anywhere, and no guard of its own.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the missed-game report against the local Supabase stack', () => {
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
  process.env.DISCORD_WEBHOOK_URL = '';

  const { mintCompanionToken } = await import('@/lib/companionAuth');
  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { moveLobby } = await import('@/lib/lobbyState');
  const { formatClock, formatNightOf, listCapturedGames, listMissedLobbies } = await import(
    '@/lib/admin/games'
  );
  const { POST: postLobbyRoute } = await import('@/app/api/companion/lobby/route');
  const { POST: postGameRoute } = await import('@/app/api/companion/game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const options = { timeZone: TIME_ZONE, groupId: ORIGINAL_GROUP_ID };

  const runId = randomUUID().slice(0, 8);
  const ten = testPuuids(runId);
  const ownerPuuid = ten[0] ?? '';
  /** The reporter's name, so `reportedBy` is a name and not a PUUID fragment by accident. */
  const OWNER_NAME = 'Hana';

  /**
   * Party ids whose **first eight characters differ**, because that is what the page prints and
   * an assertion against a shortening every row shares would pass on the wrong row.
   */
  const party = {
    missed: `missed-${runId}`,
    landed: `landed-${runId}`,
    open: `open-${runId}`,
    abandoned: `abandoned-${runId}`,
    dropped: `dropped-${runId}`,
  };
  const partyIds = Object.values(party);

  const base = testGameId();
  const games = {
    missedLobby: base + 1,
    landed: base + 2,
    backfilled: base + 3,
    short: base + 4,
  };

  let token = '';
  const lobbyIds: Record<string, string> = {};

  function request(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  function members(puuids: readonly string[]) {
    return puuids.map((puuid, index) => ({
      puuid,
      gameName: puuid === ownerPuuid ? OWNER_NAME : `Player${index}`,
      tagLine: 'EUW',
      summonerId: 8_000 + index,
      side: (index < 5 ? 100 : 200) as 100 | 200,
    }));
  }

  /** A lobby exactly as the companion posts one, then its id. */
  async function postLobby(partyId: string, puuids: readonly string[] = ten): Promise<string> {
    const response = await postLobbyRoute(request('lobby', lobbyBody({ partyId, members: members(puuids) })));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { lobbyId: string };
    lobbyIds[partyId] = body.lobbyId;
    return body.lobbyId;
  }

  async function statusOf(lobbyId: string): Promise<string> {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  /** Only this run's rows: the stack is shared, and the page's lists are global by design. */
  async function missedRows() {
    const report = await listMissedLobbies(db, options);
    return {
      report,
      rows: report.rows.filter((row) => partyIds.some((id) => id.startsWith(row.partyId))),
    };
  }

  async function capturedRow(lcuGameId: number) {
    const rows = await listCapturedGames(db, options);
    return rows.find((row) => row.lcuGameId === String(lcuGameId));
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    const { token: raw, tokenHash } = mintCompanionToken();
    const { error } = await db.from('companion_tokens').insert({
      group_id: ORIGINAL_GROUP_ID,
      player_id: ids.get(ownerPuuid) ?? '',
      token_hash: tokenHash,
      label: `gm-${runId}`,
    });
    if (error) throw new Error(error.message);
    token = raw;
  });

  afterAll(async () => {
    const { error: gameError } = await db.from('games').delete().in('lcu_game_id', Object.values(games));
    if (gameError) throw new Error(`cleanup: deleting games failed: ${gameError.message}`);

    const { error: lobbyError } = await db.from('lobbies').delete().in('lcu_party_id', partyIds);
    if (lobbyError) throw new Error(`cleanup: deleting lobbies failed: ${lobbyError.message}`);

    const { error: playerError } = await db.from('players').delete().in('puuid', ten);
    if (playerError) throw new Error(`cleanup: deleting players failed: ${playerError.message}`);

    const { data: left } = await db.from('lobbies').select('id').in('lcu_party_id', partyIds);
    expect(left ?? []).toEqual([]);
  });

  describe('Missed: the lobbies that started a game and never came back', () => {
    it('lists a lobby stuck at in_game with the night, the reporter, the ten and the party id', async () => {
      const lobbyId = await postLobby(party.missed);
      expect(await moveLobby(db, { lobbyId, from: ['open'], to: 'in_game' })).toBe(true);

      const { data: lobby } = await db
        .from('lobbies')
        .select('created_at, updated_at')
        .eq('id', lobbyId)
        .single();

      const { rows } = await missedRows();
      const row = rows.find((entry) => entry.id === lobbyId);
      if (row === undefined) throw new Error('the stuck lobby is not in the Missed list');

      expect(row.state).toBe('no game');
      expect(row.status).toBe('in_game');
      expect(row.night).toBe(formatNightOf(new Date(lobby?.created_at ?? ''), TIME_ZONE));
      expect(row.wentInGameAt).toBe(formatClock(new Date(lobby?.updated_at ?? ''), TIME_ZONE));
      // M3.10's chain, not a PUUID fragment: the reporter is the token's own player.
      expect(row.reportedBy).toBe(OWNER_NAME);
      expect(row.reportedByPuuid).toBe(ownerPuuid);
      // The frozen ten (M2.9), by name.
      expect(row.members).toHaveLength(10);
      expect(row.members.map((member) => member.name)).toContain(OWNER_NAME);
      expect(new Set(row.members.map((member) => member.puuid))).toEqual(new Set(ten));
      // Eight characters, so it can be matched against a companion log.
      expect(row.partyId).toBe(party.missed.slice(0, 8));
    });

    it('lists a dropped lobby the same way: nobody will ever see a result for it', async () => {
      const lobbyId = await postLobby(party.dropped);
      await moveLobby(db, { lobbyId, from: ['open'], to: 'in_game' });
      // What the two-hour sweep does to a lobby whose end-of-game block never arrived (M5.11).
      expect(await moveLobby(db, { lobbyId, from: ['in_game'], to: 'dropped' })).toBe(true);

      const { rows } = await missedRows();
      const row = rows.find((entry) => entry.id === lobbyId);

      expect(row?.status).toBe('dropped');
      expect(row?.state).toBe('no game');
      expect(row?.members).toHaveLength(10);
    });

    it('drops the row when the end-of-game block lands, and the game is in Captured', async () => {
      const lobbyId = lobbyIds[party.missed] ?? '';

      const response = await postGameRoute(
        request(
          'game',
          eogBody({
            gameId: games.missedLobby,
            puuids: ten,
            partyId: party.missed,
            durationS: 2_052,
          }),
        ),
      );
      expect(response.status).toBe(200);

      expect(await statusOf(lobbyId)).toBe('finished');
      const { rows } = await missedRows();
      expect(rows.map((row) => row.id)).not.toContain(lobbyId);

      const captured = await capturedRow(games.missedLobby);
      expect(captured).toMatchObject({
        source: 'eog',
        participants: 10,
        rated: true,
        duration: '34 min',
        partyId: party.missed.slice(0, 8),
      });
    });

    it('names the other bug: a game landed and the lobby never closed', async () => {
      const lobbyId = await postLobby(party.landed);
      await moveLobby(db, { lobbyId, from: ['open'], to: 'in_game' });
      const response = await postGameRoute(
        request('game', eogBody({ gameId: games.landed, puuids: ten, partyId: party.landed })),
      );
      expect(response.status).toBe(200);

      // The finish transition failing *after* the insert is the bug this state is for, so the
      // row is put back the way that failure would have left it.
      const { error } = await db.from('lobbies').update({ status: 'in_game' }).eq('id', lobbyId);
      if (error) throw new Error(error.message);

      const { rows } = await missedRows();
      const row = rows.find((entry) => entry.id === lobbyId);

      expect(row?.state).toBe('game landed, lobby never closed');
      // And it is not hiding inside the ordinary word.
      expect(row?.state).not.toBe('no game');
    });

    it('never lists open, balanced, abandoned or finished', async () => {
      const lobbyId = await postLobby(party.open);

      const listed = async (): Promise<boolean> =>
        (await missedRows()).rows.some((row) => row.id === lobbyId);

      expect(await statusOf(lobbyId)).toBe('open');
      expect(await listed()).toBe(false);

      await moveLobby(db, { lobbyId, from: ['open'], to: 'balanced' });
      expect(await listed()).toBe(false);

      // An abandoned lobby that went through `balanced` is not a missed game: it dissolved
      // before it ever started.
      await moveLobby(db, { lobbyId, from: ['balanced'], to: 'abandoned' });
      expect(await listed()).toBe(false);

      // …and the finished one from the block above stays gone.
      expect((await missedRows()).rows.map((row) => row.id)).not.toContain(lobbyIds[party.missed]);
    });

    it('is newest first, stops at the cap, and still prints the real total', async () => {
      const capped = await listMissedLobbies(db, { ...options, cap: 1 });
      const full = await listMissedLobbies(db, options);

      expect(capped.rows).toHaveLength(1);
      expect(capped.cap).toBe(1);
      // The cap truncates the list, never the count: "showing 1 of N" is the whole point.
      expect(capped.total).toBe(full.total);
      expect(capped.total).toBeGreaterThanOrEqual(2);
      expect(capped.rows[0]?.id).toBe(full.rows[0]?.id);

      // Newest `updated_at` first, over the rows this run put there.
      const { data: mine } = await db
        .from('lobbies')
        .select('id, updated_at')
        .in('lcu_party_id', partyIds)
        .in('status', ['in_game', 'dropped'])
        .order('updated_at', { ascending: false });
      const expected = (mine ?? []).map((row) => row.id);
      const listed = full.rows.map((row) => row.id).filter((id) => expected.includes(id));
      expect(listed).toEqual(expected);
    });
  });

  describe('Captured: what the server does have', () => {
    it('reads a backfilled game truthfully: backfill, no lobby, and not rated yet', async () => {
      const body = eogBody({
        gameId: games.backfilled,
        puuids: ten,
        partyId: null,
        startedAt: '2026-08-01T19:00:00.000Z',
        durationS: 1_800,
      });
      const { partyId: _dropped, ...rest } = body;
      const response = await postGameRoute(
        request('game', {
          ...rest,
          source: 'backfill',
          participants: (body.participants as Record<string, unknown>[]).map((participant) => ({
            ...participant,
            role: null,
          })),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ created: true, rated: false });

      const before = await capturedRow(games.backfilled);
      expect(before).toMatchObject({
        source: 'backfill',
        participants: 10,
        rated: false,
        // M14.53: nothing refuses it; it waits for a rebuild.
        ratedReason: { kind: 'waiting' },
        duration: '30 min',
        // Never a lobby: a backfilled game belongs to no cycle, and it never appears in Missed.
        partyId: null,
      });

      // What `pnpm --filter web rebuild-ratings --force` does to those rows. The rebuild itself
      // is proved in `rebuild.integration.test.ts`; its *effect* on this page is what is
      // asserted here: a `mu_after` on every row.
      const { data: game } = await db.from('games').select('id').eq('lcu_game_id', games.backfilled).single();
      const { error } = await db
        .from('game_players')
        .update({ mu_before: 25, sigma_before: 8.333, mu_after: 26, sigma_after: 8.2 })
        .eq('game_id', game?.id ?? '');
      if (error) throw new Error(error.message);

      expect(await capturedRow(games.backfilled)).toMatchObject({
        rated: true,
        ratedReason: { kind: 'rated' },
      });
    });

    it('shows a game the fold refused with its real length and rated: no', async () => {
      const response = await postGameRoute(
        request('game', eogBody({ gameId: games.short, puuids: ten, partyId: null, durationS: 200 })),
      );
      expect(response.status).toBe(200);

      expect(await capturedRow(games.short)).toMatchObject({
        duration: '3 min',
        participants: 10,
        rated: false,
        ratedReason: { kind: 'gate' },
        source: 'eog',
        partyId: null,
      });
    });

    it('is newest started_at first and stops at the cap it is given', async () => {
      const rows = await listCapturedGames(db, options);
      expect(rows.length).toBeGreaterThan(0);

      // Read the instants back rather than comparing against a second copy of the same query:
      // several games in this stack share a `started_at` to the millisecond (backfill produces
      // exactly that), and two runs of one query may break a tie either way.
      const { data: stored, error } = await db
        .from('games')
        .select('id, started_at')
        .in(
          'id',
          rows.map((row) => row.id),
        );
      if (error) throw new Error(error.message);
      const startedAt = new Map((stored ?? []).map((row) => [row.id, Date.parse(row.started_at)]));
      const times = rows.map((row) => startedAt.get(row.id) ?? 0);
      expect(times).toEqual([...times].sort((left, right) => right - left));

      // This run's oldest game is the backfilled one, and it is behind the live ones.
      const mine = rows.filter((row) => Object.values(games).map(String).includes(row.lcuGameId));
      expect(mine.at(-1)?.lcuGameId).toBe(String(games.backfilled));

      expect(await listCapturedGames(db, { ...options, cap: 2 })).toHaveLength(2);
    });
  });

  /**
   * The two rules that are about the page's *shape* rather than its rows, and both are read off
   * the source because that is where they can be broken: a `<form>` added to the page, or a
   * route handler added beside it, would both pass every assertion above.
   */
  describe('the page itself', () => {
    const pageSource = readFileSync(
      fileURLToPath(new URL('../../app/(group)/g/[slug]/admin/games/page.tsx', import.meta.url)),
      'utf8',
    );

    it('issues no write: no form, no post, no route under /api/admin/games', () => {
      expect(pageSource).not.toContain('AdminForm');
      expect(pageSource).not.toContain('method="post"');
      expect(pageSource).not.toContain('<form');
      expect(pageSource).not.toContain('fetch(');
      expect(existsSync(fileURLToPath(new URL('../../app/api/admin/games', import.meta.url)))).toBe(false);
    });

    it('uses the same gate every group admin section page uses, and invents none of its own', () => {
      expect(pageSource).toContain("import { sectionAccess } from '../_components/sectionAccess'");
      expect(pageSource).toContain("await sectionAccess((await params).slug, 'games')");
    });
  });
}
