import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * M22.4 against the local stack: each lobby has its own mode (decision rows M22 D5 and the
 * 2026-10-05 "M22.2 rulings"), through the real routes: the card route with and without `lobbyId`,
 * the admin Roll, and the companion's lobby and game posts under two hosts' tokens.
 *
 * Ana (the owner) opens A; the group's card is A's. Bo opens B while A is in play: B forks a copy
 * of the card. From then on a rule, a region pair, Rated, Roll's take, the start lock, "this game"
 * and a record each touch only their own lobby, and a body with no `lobbyId` is refused. When Ana's
 * Kustom is gone, B is the only lobby in play and the next call folds B's card onto the group's.
 * A `lobby_modes` row from an earlier night is ignored and deleted.
 *
 * Skipped, not failed, without the local stack.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('per-lobby mode against the local Supabase stack', () => {
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
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { setGroupModeRoute } = await import('./mode/handler');
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { authorizeAdmin, supabaseAdminLookup } = await import('@/lib/adminAuth');
  const { mintCompanionToken } = await import('@/lib/companionAuth');
  const { supabaseGroupRole } = await import('@/lib/groups/membership');
  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { eogBody, testGameId } = await import('@/lib/testing/fixtures');
  const { createTestGroups, deleteTestGroups, pinTestGroupMode, setTestMembership } = await import(
    '@/lib/testing/groups'
  );
  const { rollForTest } = await import('@/lib/testing/roll');
  const { sequenceRng } = await import('@/lib/testing/modeNight');
  const { inPlay, liveTablesWithTokens } = await import('@/lib/liveTables');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const all = Array.from({ length: 20 }, (_, index) => `it-${runId}-lm${index}`);
  const anaTen = all.slice(0, 10);
  const boTen = all.slice(10, 20);
  const ANA = anaTen[0] ?? '';
  const BO = boTen[0] ?? '';
  const anaDiscord = `8${runId.replace(/\D/g, '') || '1'}0422`;
  const group = { id: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  const tokens = { ana: '', bo: '' };
  const party = (name: string) => `it-${runId}-lm-party-${name}`;
  const lobbies = { a: '', b: '' };

  const session = {
    id: randomUUID(),
    email: `${runId}-lm@example.invalid`,
    identities: [{ id: anaDiscord, provider: 'discord', identity_data: {} }],
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
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    });

  /** One card action through the route: the status and the body. */
  async function card(body: Record<string, unknown>, rng?: () => number) {
    const response = await setGroupModeRoute({ ...adminOptions, ...(rng === undefined ? {} : { rng }) })(
      jsonRequest('/api/admin/mode', { groupId: group.id, ...body }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function post(partyId: string, ten: readonly string[], token: string): Promise<string> {
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: `lobby modes ${partyId.slice(-1)}`,
          members: ten.map((puuid, index) => ({
            puuid,
            gameName: `L${all.indexOf(puuid)}`,
            tagLine: 'EUW',
            summonerId: 7_000 + all.indexOf(puuid),
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

  async function groupCard() {
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

  async function forks() {
    const { data, error } = await db
      .from('lobby_modes')
      .select(
        'lcu_party_id, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override',
      )
      .eq('group_id', group.id)
      .order('lcu_party_id');
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function fork(name: string) {
    return (await forks()).find((row) => row.lcu_party_id === party(name)) ?? null;
  }

  async function lockOf(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select('status, lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated')
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function seen(key: keyof typeof tokens, at: Date) {
    const { error } = await db
      .from('companion_tokens')
      .update({ last_seen_at: at.toISOString() })
      .eq('label', `lm-${key}-${runId}`);
    if (error) throw new Error(error.message);
  }

  async function game(phase: 'in_progress', partyId: string, gameId: number, token: string): Promise<void> {
    const response = await postGame(jsonRequest('/api/companion/game', { phase, gameId, partyId }, token));
    expect(response.status).toBe(200);
  }

  async function eog(partyId: string, ten: readonly string[], token: string, durationS?: number) {
    const gameId = testGameId();
    gameIds.push(gameId);
    await game('in_progress', partyId, gameId, token);
    const response = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({
          gameId,
          partyId,
          puuids: ten,
          startedAt: new Date().toISOString(),
          ...(durationS === undefined ? {} : { durationS }),
        }),
        token,
      ),
    );
    expect(response.status).toBe(200);
    const { data, error } = await db
      .from('games')
      .select('mode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated')
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      all.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    group.id = (await createTestGroups(db, runId, ['lm'] as const)).lm ?? '';
    await pinTestGroupMode(db, group.id, 'normal');
    const anaId = idOf.get(ANA) ?? '';
    const linked = await db.from('players').update({ discord_id: anaDiscord }).eq('id', anaId);
    if (linked.error) throw new Error(linked.error.message);
    await setTestMembership(db, group.id, anaId, 'owner');
    for (const puuid of all.slice(1)) await setTestMembership(db, group.id, idOf.get(puuid) ?? '', 'member');
    for (const [key, puuid] of [
      ['ana', ANA],
      ['bo', BO],
    ] as const) {
      const minted = mintCompanionToken();
      const inserted = await db.from('companion_tokens').insert({
        player_id: idOf.get(puuid) ?? '',
        token_hash: minted.tokenHash,
        label: `lm-${key}-${runId}`,
        group_id: group.id,
        last_seen_at: new Date().toISOString(),
      });
      if (inserted.error) throw new Error(inserted.error.message);
      tokens[key] = minted.token;
    }
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, [group.id]);
    await db.from('players').delete().in('puuid', all);
  });

  it('one lobby: the group card, no fork, no lobbyId needed', async () => {
    lobbies.a = await post(party('a'), anaTen, tokens.ana);
    const mirror = await card({ mode: 'mirror' });
    expect(mirror.status, JSON.stringify(mirror.json)).toBe(200);
    expect(await groupCard()).toMatchObject({ pending_rule: 'mirror', rated_override: null });
    expect(await forks()).toEqual([]);
  });

  it('a second lobby forks a copy of the group card, and a body naming no lobby is refused', async () => {
    lobbies.b = await post(party('b'), boTen, tokens.bo);
    expect(await fork('b')).toMatchObject({ pending_rule: 'mirror', rated_override: null });
    expect(await fork('a')).toBeNull();

    const refused = await card({ rated: false });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: 'Pick a lobby first.' });
    expect(await groupCard()).toMatchObject({ pending_rule: 'mirror', rated_override: null });
    expect(await fork('b')).toMatchObject({ pending_rule: 'mirror', rated_override: null });

    // Bo's own Kustom posting B again is a repeat: nothing forks twice.
    expect(await post(party('b'), boTen, tokens.bo)).toBe(lobbies.b);
    expect(await forks()).toHaveLength(1);
  });

  it('a rule, a region pair and Rated set for one lobby are not on the other', async () => {
    const tank = await card({ mode: 'class:Tank', lobbyId: lobbies.a });
    expect(tank.status, JSON.stringify(tank.json)).toBe(200);
    expect(await groupCard()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Tank' });
    expect(await fork('b')).toMatchObject({ pending_rule: 'mirror', pending_class_tag: null });

    // Region wars for B, drawn at selection (M20 D9), on B's row only.
    const region = await card({ mode: 'region', lobbyId: lobbies.b }, sequenceRng([0, 0.5]));
    expect(region.status, JSON.stringify(region.json)).toBe(200);
    const drawn = await fork('b');
    expect(drawn?.pending_rule).toBe('region');
    expect(drawn?.pending_region_blue).not.toBeNull();
    expect(drawn?.pending_region_red).not.toBeNull();
    expect(region.json).toMatchObject({
      state: { pending: { id: 'region', blue: drawn?.pending_region_blue, red: drawn?.pending_region_red } },
    });
    const redraw = await card({ redraw: true, lobbyId: lobbies.b }, sequenceRng([0.9, 0.1]));
    expect(redraw.status, JSON.stringify(redraw.json)).toBe(200);
    const redrawn = await fork('b');
    expect([redrawn?.pending_region_blue, redrawn?.pending_region_red].sort()).not.toEqual(
      [drawn?.pending_region_blue, drawn?.pending_region_red].sort(),
    );

    const off = await card({ rated: false, lobbyId: lobbies.b });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(off.json).toMatchObject({ state: { rated: false, standing: 'normal' } });
    expect(await fork('b')).toMatchObject({ pending_rule: 'region', rated_override: false });
    expect(await groupCard()).toMatchObject({ pending_rule: 'class', rated_override: null });

    // A's Rated off lands on the group's card (A's), and B's stays as B set it.
    const anaOff = await card({ rated: false, lobbyId: lobbies.a });
    expect(anaOff.status, JSON.stringify(anaOff.json)).toBe(200);
    expect(anaOff.json).toMatchObject({
      state: { standing: 'normal', pending: { id: 'class', tag: 'Tank' } },
    });
    expect(await groupCard()).toMatchObject({ pending_rule: 'class', rated_override: false });
    expect(await fork('b')).toMatchObject({ pending_rule: 'region', rated_override: false });
  });

  it("M22.6: Tonight reads each lobby's own card after those writes, whichever lobby is selected", async () => {
    const { loadTonight } = await import('@/lib/tonight/load');
    const { tonightStart } = await import('@/lib/tonight/night');
    const anon = createClient<Database>(stack.url, stack.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const read = (lobbyId: string) =>
      loadTonight(anon, { nightStart: tonightStart(), timeZone: 'Africa/Cairo', groupId: group.id, lobbyId });
    for (const selected of [lobbies.a, lobbies.b]) {
      const snapshot = await read(selected);
      expect(snapshot.selectedLobbyId).toBe(selected);
      const a = snapshot.lobbies?.find((table) => table.partyId === party('a'));
      const b = snapshot.lobbies?.find((table) => table.partyId === party('b'));
      // A has no fork: its card is the group's (Tanks only, Rated off); B's is its own row.
      expect(a?.card).toBeUndefined();
      expect(snapshot.modeRow).toMatchObject({ pending: { id: 'class', tag: 'Tank' }, rated: false });
      expect(b?.card).toMatchObject({ pending: { id: 'region' }, rated: false });
    }
    // A write for B moves only B's card on the next read (then back, as the next tests expect it).
    const on = await card({ rated: true, lobbyId: lobbies.b });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const after = await read(lobbies.a);
    expect(after.modeRow).toMatchObject({ pending: { id: 'class', tag: 'Tank' }, rated: false });
    expect(after.lobbies?.find((table) => table.partyId === party('b'))?.card).toMatchObject({
      pending: { id: 'region' },
      rated: true,
    });
    const back = await card({ rated: false, lobbyId: lobbies.b });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
  });

  it("Roll in A empties only A's rule; this game in A changes only A's lock", async () => {
    const before = await fork('b');
    await rollForTest(db, lobbies.a);
    expect(await lockOf(lobbies.a)).toMatchObject({
      status: 'balanced',
      lock_rule: 'class',
      lock_class_tag: 'Tank',
      lock_rated: false,
    });
    expect(await groupCard()).toMatchObject({ pending_rule: null, rated_override: null });
    expect(await fork('b')).toEqual(before);
    expect(await lockOf(lobbies.b)).toMatchObject({ status: 'open', lock_mode: null });

    const thisGame = await card({ rated: true, game: 'this', lobbyId: lobbies.a });
    expect(thisGame.status, JSON.stringify(thisGame.json)).toBe(200);
    expect(thisGame.json).toMatchObject({ thisGame: { lobbyId: lobbies.a, rated: true } });
    expect(await lockOf(lobbies.a)).toMatchObject({ lock_rated: true });
    expect(await fork('b')).toEqual(before);

    // B has no rolled game: its "this game" is refused, never A's lock.
    const none = await card({ rated: false, game: 'this', lobbyId: lobbies.b });
    expect(none.status).toBe(409);
    expect(await lockOf(lobbies.a)).toMatchObject({ lock_rated: true });
  });

  it("B's game takes B's card at the start; each record stamps its own lock; a remake hands back to B", async () => {
    const pair = await fork('b');
    const gameId = testGameId();
    gameIds.push(gameId);
    await game('in_progress', party('b'), gameId, tokens.bo);
    expect(await lockOf(lobbies.b)).toMatchObject({
      status: 'in_game',
      lock_rule: 'region',
      lock_region_blue: pair?.pending_region_blue,
      lock_region_red: pair?.pending_region_red,
      lock_rated: false,
    });
    expect(await fork('b')).toMatchObject({ pending_rule: null, rated_override: null });
    expect(await groupCard()).toMatchObject({ pending_rule: null, rated_override: null });

    // A's game: stamped with A's lock.
    const a = await eog(party('a'), anaTen, tokens.ana);
    expect(a).toMatchObject({ rule: 'class', rule_class_tag: 'Tank', rated: true });

    // B's game is a remake: the lock goes back to B's own card, never the group's.
    const response = await postGame(
      jsonRequest(
        '/api/companion/game',
        eogBody({
          gameId,
          partyId: party('b'),
          puuids: boTen,
          startedAt: new Date().toISOString(),
          durationS: 200,
        }),
        tokens.bo,
      ),
    );
    expect(response.status).toBe(200);
    expect(await fork('b')).toMatchObject({
      pending_rule: 'region',
      pending_region_blue: pair?.pending_region_blue,
      pending_region_red: pair?.pending_region_red,
      rated_override: false,
    });
    expect(await groupCard()).toMatchObject({ pending_rule: null, rated_override: null });
  });

  it("with Ana's Kustom gone, B is the only lobby in play: the next call folds B's card onto the group's", async () => {
    const survivor = await fork('b');
    await seen('ana', new Date(Date.now() - 60 * 60_000));
    const answer = await card({ mode: 'region' });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await forks()).toEqual([]);
    // Choosing region wars while it is pending keeps the pair: the fold put B's on the group card.
    expect(await groupCard()).toMatchObject({
      mode: 'normal',
      pending_rule: 'region',
      pending_region_blue: survivor?.pending_region_blue,
      pending_region_red: survivor?.pending_region_red,
    });
    expect(answer.json).toMatchObject({
      state: {
        pending: { id: 'region', blue: survivor?.pending_region_blue, red: survivor?.pending_region_red },
      },
    });
  });

  it('a lobby_modes row from an earlier night is ignored and deleted', async () => {
    const card0 = await groupCard();
    const yesterday = new Date(Date.now() - 30 * 60 * 60_000).toISOString();
    const stale = await db.from('lobby_modes').insert({
      group_id: group.id,
      lcu_party_id: party('b'),
      pending_rule: 'mirror',
      rated_override: true,
      created_at: yesterday,
    });
    expect(stale.error).toBeNull();
    const answer = await card({ rated: false, lobbyId: lobbies.b });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({ state: { pending: { id: 'region' }, rated: false } });
    expect(await forks()).toEqual([]);
    expect(await groupCard()).toMatchObject({ ...card0, rated_override: false });
  });

  /**
   * One rule for "in play" (M22.4 review): the same fixtures go through the SQL path (the fork
   * trigger, by inserting a probe lobby) and through `inPlay` over `liveTablesWithTokens`, and the
   * two must agree. Each case is its own scratch group with one other table and the tokens named.
   */
  describe('in play: the fork trigger and inPlay agree on the same rows', () => {
    type TokenFixture = { party: string | null; seenMinutesAgo: number; revoked?: boolean };
    const cases: {
      name: string;
      status: 'open' | 'balanced' | 'in_game' | 'finished';
      tokens: TokenFixture[];
      expected: boolean;
    }[] = [
      {
        name: 'open, a token in it',
        status: 'open',
        tokens: [{ party: 'other', seenMinutesAgo: 1 }],
        expected: true,
      },
      {
        name: 'balanced, a token in it',
        status: 'balanced',
        tokens: [{ party: 'other', seenMinutesAgo: 1 }],
        expected: true,
      },
      {
        name: 'in game, a token in it',
        status: 'in_game',
        tokens: [{ party: 'other', seenMinutesAgo: 1 }],
        expected: true,
      },
      { name: 'in game, no token (an old build)', status: 'in_game', tokens: [], expected: false },
      {
        name: 'finished just now, a token in it',
        status: 'finished',
        tokens: [{ party: 'other', seenMinutesAgo: 1 }],
        expected: true,
      },
      {
        name: 'finished, its token moved on',
        status: 'finished',
        tokens: [{ party: 'probe', seenMinutesAgo: 1 }],
        expected: false,
      },
      {
        name: 'open, its token moved to the probe',
        status: 'open',
        tokens: [{ party: 'probe', seenMinutesAgo: 1 }],
        expected: false,
      },
      {
        name: 'open, a token with no party yet',
        status: 'open',
        tokens: [{ party: null, seenMinutesAgo: 1 }],
        expected: false,
      },
      {
        name: 'open, its token seen 11 minutes ago',
        status: 'open',
        tokens: [{ party: 'other', seenMinutesAgo: 11 }],
        expected: false,
      },
      {
        name: 'open, its token revoked',
        status: 'open',
        tokens: [{ party: 'other', seenMinutesAgo: 1, revoked: true }],
        expected: false,
      },
      {
        name: "open, the probe host's second machine still in it",
        status: 'open',
        tokens: [
          { party: 'probe', seenMinutesAgo: 1 },
          { party: 'other', seenMinutesAgo: 1 },
        ],
        expected: true,
      },
    ];
    const scratch: string[] = [];

    afterAll(async () => {
      await deleteTestGroups(db, scratch);
    });

    it.each(cases)('$name', async ({ status, tokens: fixtures, expected }) => {
      const key = `ip${scratch.length}`;
      const groupId = (await createTestGroups(db, `${runId}${key}`, [key] as const))[key] ?? '';
      scratch.push(groupId);
      const partyOf = (name: string | null) => (name === null ? null : `it-${runId}-${key}-${name}`);
      const other = partyOf('other') ?? '';
      const probe = partyOf('probe') ?? '';
      const otherRow = await db.from('lobbies').insert({ group_id: groupId, lcu_party_id: other, status });
      expect(otherRow.error).toBeNull();
      for (const [index, fixture] of fixtures.entries()) {
        const party = partyOf(fixture.party);
        const inserted = await db.from('companion_tokens').insert({
          player_id: idOf.get(BO) ?? '',
          token_hash: `${key}-${runId}-${index}`,
          group_id: groupId,
          last_seen_at: new Date(Date.now() - fixture.seenMinutesAgo * 60_000).toISOString(),
          current_party_id: party,
          current_party_at: party === null ? null : new Date().toISOString(),
          revoked_at: fixture.revoked === true ? new Date().toISOString() : null,
        });
        expect(inserted.error).toBeNull();
      }

      const { tables, tokens: seenTokens } = await liveTablesWithTokens(db, groupId, new Date());
      const ts = tables.some((table) => table.partyId !== probe && inPlay(table, seenTokens));
      const probeRow = await db.from('lobbies').insert({ group_id: groupId, lcu_party_id: probe });
      expect(probeRow.error).toBeNull();
      const { data, error } = await db.from('lobby_modes').select('lcu_party_id').eq('group_id', groupId);
      expect(error).toBeNull();
      const sql = (data ?? []).some((row) => row.lcu_party_id === probe);

      expect({ ts, sql }).toEqual({ ts: expected, sql: expected });
    });
  });
}
