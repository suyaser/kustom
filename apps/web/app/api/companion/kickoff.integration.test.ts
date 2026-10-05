import { randomUUID } from 'node:crypto';
import { winProbability } from '@customs/core';
import type { Database } from '@customs/db';
import { KICKOFF_COLUMNS, kickoffFromRow } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { readAssignments } from '@/lib/discord/assemble';
import { readLobbyKickoff } from '@/lib/ingest/kickoff';
import { ensurePlayers } from '@/lib/ingest/players';
import { rebuildRatings } from '@/lib/ingest/rebuild';
import { moveLobby } from '@/lib/lobbyState';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import {
  createTestGroups,
  deleteTestGroups,
  pinTestGroupMode,
  setTestMembership,
} from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * M21.4 against the local stack: the kickoff record the `in_progress` post writes on the lobby
 * (`0046_lobby_kickoff.sql`), through the real companion routes and the real roll.
 *
 * One group on Normal, twelve players (ten who played a seed game, so their Ratings differ, and
 * two who never played: no `ratings` row, so 1200), two companion tokens (the host's and a second
 * companion in the same game). Every scenario opens its own party.
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
  describe.skip('kickoff record against the local Supabase stack', () => {
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

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createClient<Database>(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 12 }, (_, index) => `it-${runId}-ko${index}`);
  const ten = all.slice(0, 10);
  /** Never played in the group: no `ratings` row. */
  const fresh = all.slice(10);
  const HOST = ten[0] ?? '';
  const groups = { g: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const tokens = { host: '', second: '' };
  let party = 0;

  type Member = { puuid: string; side: 100 | 200 | null; isSpectator?: boolean };

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
          lobbyName: 'kickoff night',
          members: members.map((member) => ({
            puuid: member.puuid,
            gameName: `P${all.indexOf(member.puuid)}`,
            tagLine: 'EUW',
            summonerId: 9_000 + all.indexOf(member.puuid),
            side: member.side,
            isSpectator: member.isSpectator ?? false,
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
    const partyId = `it-${runId}-party-${party}`;
    const { lobbyId } = await postMembers(partyId, members);
    return { partyId, lobbyId };
  }

  /** The chosen split's teams, as puuids. */
  async function chosenTeams(lobbyId: string) {
    const { data, error } = await db
      .from('splits')
      .select('blue, red, blue_win_prob')
      .eq('lobby_id', lobbyId)
      .eq('is_chosen', true)
      .single();
    if (error) throw new Error(error.message);
    return {
      blue: readAssignments(data.blue).map((a) => a.puuid),
      red: readAssignments(data.red).map((a) => a.puuid),
      blueWinProb: data.blue_win_prob,
    };
  }

  async function splitRows(lobbyId: string) {
    const { data, error } = await db.from('splits').select('*').eq('lobby_id', lobbyId).order('rank');
    if (error) throw new Error(error.message);
    return data;
  }

  async function lobbyRow(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select(`status, lock_rated, ${KICKOFF_COLUMNS}`)
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function membersOf(lobbyId: string) {
    const { data, error } = await db
      .from('lobby_members')
      .select('player_id, side, is_spectator')
      .eq('lobby_id', lobbyId)
      .order('player_id');
    if (error) throw new Error(error.message);
    return data;
  }

  async function liveVersion(): Promise<number> {
    const { data, error } = await db.from('group_live').select('version').eq('group_id', groups.g).single();
    if (error) throw new Error(error.message);
    return Number(data.version);
  }

  /** `in_progress` through the real route; returns the answer and how far `group_live` moved. */
  async function start(partyId: string, gameId: number, token = tokens.host, gameMode?: string) {
    const before = await liveVersion();
    const response = await postGame(
      jsonRequest(
        '/api/companion/game',
        { phase: 'in_progress', gameId, partyId, ...(gameMode === undefined ? {} : { gameMode }) },
        token,
      ),
    );
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Record<string, unknown>;
    return { answer, bumps: (await liveVersion()) - before };
  }

  async function rOf(puuids: readonly string[]): Promise<number> {
    const ids = puuids.map((puuid) => idOf.get(puuid) ?? '');
    const { data, error } = await db
      .from('ratings')
      .select('player_id, r')
      .eq('group_id', groups.g)
      .in('player_id', ids);
    if (error) throw new Error(error.message);
    const byId = new Map((data ?? []).map((row) => [row.player_id, row.r ?? 1200]));
    return ids.reduce((sum, id) => sum + (byId.get(id) ?? 1200), 0);
  }

  async function postEog(
    partyId: string | null,
    blue: readonly string[],
    red: readonly string[],
    gameId: number,
    startedAt: Date,
  ) {
    gameIds.push(gameId);
    const response = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({ gameId, partyId, puuids: [...blue, ...red], startedAt: startedAt.toISOString() }),
        tokens.host,
      ),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  async function dryRebuild() {
    const result = await rebuildRatings(db, {
      groupId: groups.g,
      dryRun: true,
      force: true,
      timeZone: 'Africa/Cairo',
    });
    if (!result.ok) throw new Error(result.message);
    return result.report;
  }

  const sorted = (puuids: readonly string[]) => [...puuids].sort();

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    groups.g = (await createTestGroups(db, runId, ['ko'] as const)).ko;
    await pinTestGroupMode(db, groups.g, 'normal');
    await setTestMembership(db, groups.g, idOf.get(HOST) ?? '', 'owner');
    for (const puuid of all.slice(1)) await setTestMembership(db, groups.g, idOf.get(puuid) ?? '', 'member');
    for (const [key, puuid] of [
      ['host', HOST],
      ['second', ten[1] ?? ''],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `ko-${key}-${runId}`,
        group_id: groups.g,
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }
    // A seed game with no lobby, folded live: blue (ten[0..4]) wins, so the ten have different
    // Ratings and the two fresh players have none.
    await postEog(null, ten.slice(0, 5), ten.slice(5), testGameId(), new Date(Date.now() - 2 * 3600_000));
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', all);
  });

  it('(1) rolled, two swapped by hand: custom, the real ten, Kustom odds; splits untouched; one bump; eog folds on its sides; a dry rebuild changes nothing', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    const split = await chosenTeams(lobbyId);
    // Trade a seed winner for a seed loser, so the real teams' odds are not the split's.
    const won = new Set(ten.slice(0, 5));
    const fromBlue = split.blue.find((puuid) => won.has(puuid)) ?? split.blue[0] ?? '';
    const fromRed = split.red.find((puuid) => won.has(puuid) !== won.has(fromBlue)) ?? '';
    expect(fromRed).not.toBe('');
    const realBlue = [fromRed, ...split.blue.filter((puuid) => puuid !== fromBlue)];
    const realRed = [fromBlue, ...split.red.filter((puuid) => puuid !== fromRed)];
    expect((await postMembers(partyId, sided(realBlue, realRed))).status).toBe('balanced');
    const splitsBefore = await splitRows(lobbyId);
    expect((await dryRebuild()).gamePlayerRowsChanged).toBe(0);

    const gameId = testGameId();
    const { answer, bumps } = await start(partyId, gameId);
    // (7) the companion's answer is exactly what it was before M21.
    expect(answer).toEqual({
      ok: true,
      phase: 'in_progress',
      created: false,
      gameId: null,
      lobbyId,
      participants: 0,
    });
    // (5) the move, the start lock and the kickoff record: one bump.
    expect(bumps).toBe(1);

    const row = await lobbyRow(lobbyId);
    expect(row).toMatchObject({
      status: 'in_game',
      kickoff_kind: 'custom',
      kickoff_blue: sorted(realBlue),
      kickoff_red: sorted(realRed),
      kickoff_swapped: false,
      kickoff_odds_model: 'kustom',
    });
    const expected = winProbability(await rOf(realBlue), await rOf(realRed));
    expect(row.kickoff_blue_win_prob).toBeCloseTo(expected, 12);
    // The rolled split's odds are for other teams.
    expect(row.kickoff_blue_win_prob).not.toBeCloseTo(split.blueWinProb, 6);
    expect(await splitRows(lobbyId)).toEqual(splitsBefore);
    // Readable as Tonight reads it (anon, column grants), and through the shared parser.
    const anonRow = await anon.from('lobbies').select(KICKOFF_COLUMNS).eq('id', lobbyId).single();
    expect(anonRow.error).toBeNull();
    expect(kickoffFromRow(anonRow.data ?? (row as never))).toEqual(await readLobbyKickoff(db, lobbyId));

    // A second companion in the same game: no move, no write, no bump.
    const kickoffAt = row.kickoff_at;
    const second = await start(partyId, gameId, tokens.second);
    expect(second.bumps).toBe(0);
    expect((await lobbyRow(lobbyId)).kickoff_at).toBe(kickoffAt);

    // (4) the eog lands on the real sides and folds on them; the split is still untouched.
    const eog = await postEog(partyId, realBlue, realRed, gameId, new Date());
    expect(eog).toMatchObject({ rated: true });
    const { data: seats } = await db
      .from('game_players')
      .select('side, players!inner(puuid), games!inner(lcu_game_id)')
      .eq('games.lcu_game_id', gameId);
    expect(sorted((seats ?? []).filter((s) => s.side === 100).map((s) => s.players.puuid))).toEqual(
      sorted(realBlue),
    );
    expect(await splitRows(lobbyId)).toEqual(splitsBefore);
    expect(await lobbyRow(lobbyId)).toMatchObject({
      status: 'finished',
      kickoff_kind: 'custom',
      kickoff_at: kickoffAt,
    });
    const report = await dryRebuild();
    expect(report.gamePlayerRowsChanged).toBe(0);
    expect(report.ratingRowsChanged).toBe(0);
    expect(report.problems).toEqual([]);
  });

  it('(2) rolled and nobody moved: rolled, no odds written, the split keeps its odds; a repeat writes nothing', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    const split = await chosenTeams(lobbyId);
    // The roll's sides are what the companion reports after the side moves land.
    await postMembers(partyId, sided(split.blue, split.red));
    const gameId = testGameId();
    expect((await start(partyId, gameId)).bumps).toBe(1);
    expect(await lobbyRow(lobbyId)).toMatchObject({
      kickoff_kind: 'rolled',
      kickoff_blue: sorted(split.blue),
      kickoff_red: sorted(split.red),
      kickoff_swapped: false,
      kickoff_blue_win_prob: null,
      kickoff_odds_model: null,
    });
    expect((await start(partyId, gameId)).bumps).toBe(0);
  });

  it('rolled teams on swapped sides: rolled, flagged swapped, no odds (M21.1 note a)', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    const split = await chosenTeams(lobbyId);
    await postMembers(partyId, sided(split.red, split.blue));
    await start(partyId, testGameId());
    expect(await lobbyRow(lobbyId)).toMatchObject({
      kickoff_kind: 'rolled',
      kickoff_blue: sorted(split.red),
      kickoff_red: sorted(split.blue),
      kickoff_swapped: true,
      kickoff_blue_win_prob: null,
    });
  });

  it('(3) open -> in_game with no roll: unrolled with odds; a player with no ratings row counts 1200', async () => {
    const blue = [ten[0] ?? '', ten[1] ?? '', ten[5] ?? '', ten[6] ?? '', fresh[0] ?? ''];
    const red = [ten[2] ?? '', ten[3] ?? '', ten[7] ?? '', ten[8] ?? '', ten[9] ?? ''];
    const { partyId, lobbyId } = await openLobby(sided(blue, red));
    expect((await start(partyId, testGameId())).bumps).toBe(1);
    const row = await lobbyRow(lobbyId);
    expect(row).toMatchObject({ status: 'in_game', kickoff_kind: 'unrolled', kickoff_odds_model: 'kustom' });
    expect(row.kickoff_blue_win_prob).toBeCloseTo(winProbability(await rOf(blue), await rOf(red)), 12);
    expect(await rOf([fresh[0] ?? ''])).toBe(1200);
    // An older companion sends no mode: nothing stored (M21.12).
    expect(row.kickoff_game_mode).toBeNull();
  });

  it('(M21.12) the in_progress game mode is stored with the record and never rewritten; a Rift mode is stored too', async () => {
    const aram = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    expect((await start(aram.partyId, testGameId(), tokens.host, 'ARAM')).bumps).toBe(1);
    const row = await lobbyRow(aram.lobbyId);
    expect(row).toMatchObject({ kickoff_kind: 'unrolled', kickoff_game_mode: 'ARAM' });
    // A second companion with another answer (or none) writes nothing.
    await start(aram.partyId, testGameId(), tokens.second, 'CLASSIC');
    expect((await lobbyRow(aram.lobbyId)).kickoff_game_mode).toBe('ARAM');
    expect(kickoffFromRow(row)).toMatchObject({ gameMode: 'ARAM' });
  });

  it('a 4v4: a kickoff record with four a side (M21.1 note b)', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 4), ten.slice(5, 9)));
    await start(partyId, testGameId());
    expect(await lobbyRow(lobbyId)).toMatchObject({
      status: 'in_game',
      kickoff_kind: 'unrolled',
      kickoff_blue: sorted(ten.slice(0, 4)),
      kickoff_red: sorted(ten.slice(5, 9)),
    });
  });

  it('someone in the spectator slot among the ten (5v4): no record, the lobby still moves and bumps once', async () => {
    const { partyId, lobbyId } = await openLobby([
      ...sided(ten.slice(0, 5), ten.slice(5, 9)),
      { puuid: ten[9] ?? '', side: null, isSpectator: true },
    ]);
    expect((await start(partyId, testGameId())).bumps).toBe(1);
    expect(await lobbyRow(lobbyId)).toMatchObject({
      status: 'in_game',
      kickoff_kind: null,
      kickoff_blue: null,
    });
  });

  it('more than ten: the sitters (side null) are on no team', async () => {
    const { partyId, lobbyId } = await openLobby([
      ...sided(ten.slice(0, 5), ten.slice(5)),
      { puuid: fresh[0] ?? '', side: null, isSpectator: true },
      { puuid: fresh[1] ?? '', side: null, isSpectator: true },
    ]);
    await start(partyId, testGameId());
    expect(await lobbyRow(lobbyId)).toMatchObject({
      kickoff_kind: 'unrolled',
      kickoff_blue: sorted(ten.slice(0, 5)),
      kickoff_red: sorted(ten.slice(5)),
    });
  });

  it('someone leaves in champ select: the teams come down, no in_progress, nothing stored', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    expect((await postMembers(partyId, sided(ten.slice(0, 5), ten.slice(5, 9)))).status).toBe('open');
    expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'open', kickoff_kind: null });
  });

  it('the companion disconnects before in_progress: no record, the eog still finishes the lobby', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await rollForTest(db, lobbyId);
    const split = await chosenTeams(lobbyId);
    await postEog(partyId, split.blue, split.red, testGameId(), new Date());
    expect(await lobbyRow(lobbyId)).toMatchObject({ status: 'finished', kickoff_kind: null });
  });

  it('a late lobby post after the freeze is ignored: members and record unchanged', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    await start(partyId, testGameId());
    const before = { row: await lobbyRow(lobbyId), members: await membersOf(lobbyId) };
    await postMembers(partyId, sided(ten.slice(5), ten.slice(0, 5)));
    expect(await membersOf(lobbyId)).toEqual(before.members);
    expect(await lobbyRow(lobbyId)).toEqual(before.row);
  });

  it('a retry after a start whose answer was lost (lobby already in_game, no record): written then, one bump', async () => {
    const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    expect(await moveLobby(db, { lobbyId, from: ['open'], to: 'in_game' })).toBe(true);
    expect((await start(partyId, testGameId())).bumps).toBe(1);
    expect(await lobbyRow(lobbyId)).toMatchObject({ kickoff_kind: 'unrolled' });
  });

  it('a not-rated game: kind, teams and odds stored all the same (showing them is the reader rule)', async () => {
    const card = await db.from('group_modes').update({ rated_override: false }).eq('group_id', groups.g);
    expect(card.error).toBeNull();
    try {
      const { partyId, lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
      await start(partyId, testGameId());
      const row = await lobbyRow(lobbyId);
      expect(row).toMatchObject({
        lock_rated: false,
        kickoff_kind: 'unrolled',
        kickoff_odds_model: 'kustom',
      });
      expect(row.kickoff_blue_win_prob).not.toBeNull();
    } finally {
      await db.from('group_modes').update({ rated_override: null }).eq('group_id', groups.g);
    }
  });

  it('the database refuses a half record or odds on a rolled one', async () => {
    const { lobbyId } = await openLobby(sided(ten.slice(0, 5), ten.slice(5)));
    const half = await db.from('lobbies').update({ kickoff_kind: 'custom' }).eq('id', lobbyId);
    expect(half.error?.message).toMatch(/lobbies_kickoff/);
    const rolledOdds = await db
      .from('lobbies')
      .update({
        kickoff_kind: 'rolled',
        kickoff_blue: ['a'],
        kickoff_red: ['b'],
        kickoff_at: new Date().toISOString(),
        kickoff_blue_win_prob: 0.5,
        kickoff_odds_model: 'kustom',
      })
      .eq('id', lobbyId);
    expect(rolledOdds.error?.message).toMatch(/lobbies_kickoff_odds/);
    const unequal = await db
      .from('lobbies')
      .update({
        kickoff_kind: 'unrolled',
        kickoff_blue: ['a', 'b'],
        kickoff_red: ['c'],
        kickoff_at: new Date().toISOString(),
        kickoff_blue_win_prob: 0.5,
        kickoff_odds_model: 'kustom',
      })
      .eq('id', lobbyId);
    expect(unequal.error?.message).toMatch(/lobbies_kickoff_sides/);
  });
}
