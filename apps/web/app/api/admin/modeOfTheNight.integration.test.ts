import { randomUUID } from 'node:crypto';
import { nextGame } from '@customs/core';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listSplits, promoteSplit } from '@/lib/admin/reroll';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import { mintCompanionToken } from '@/lib/companionAuth';
import { loadFearless } from '@/lib/fearless/load';
import { supabaseGroupRole } from '@/lib/groups/membership';
import { ensurePlayers } from '@/lib/ingest/players';
import { rebuildRatings } from '@/lib/ingest/rebuild';
import { moveLobby } from '@/lib/lobbyState';
import { modeCardView } from '@/lib/mode/card';
import { championTable } from '@/lib/mode/champions';
import { loadLobbyLock, loadModeState } from '@/lib/mode/tonightRead';
import { eogBody, testGameId } from '@/lib/testing/fixtures';
import { createTestGroups, deleteTestGroups, setTestMembership } from '@/lib/testing/groups';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { rollForTest } from '@/lib/testing/roll';

/**
 * M15.3 against the local stack, on M20.7's one-row model: the pending rule on the card, Roll moving
 * it onto the lobby's lock, the rated stamp, the hand-backs and Spin, through the real routes
 * (`/api/admin/mode`, Spin included, `/api/companion/lobby`, `/api/companion/game`) and the real roll
 * and reroll. The M20.7 acceptance (races, one update per action, the pair) is
 * `modeOneRow.integration.test.ts`.
 *
 * One group (on Fearless, `createTestGroups`), ten fresh players, the first of them the owner and
 * the host. Every scenario opens its own party, so lobbies never collide; the games start now, so
 * they are tonight's.
 *
 * Skipped, not failed, without the local stack, and skipped on a stack that has not applied
 * `0047_mode_one_row.sql` (no `group_modes.pending_region_blue`).
 */

const stack = await resolveLocalStack();

async function has0047(url: string, key: string): Promise<boolean> {
  const probe = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await probe.from('group_modes').select('pending_region_blue').limit(1);
  return error === null;
}

const ready = stack !== null && (await has0047(stack.url, stack.serviceRoleKey));

if (stack === null || !ready) {
  describe.skip('mode of the night against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`, then apply 0047', () => {
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
  const { POST: postLobby } = await import('../companion/lobby/route');
  const { POST: postGame } = await import('../companion/game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-mn${index}`);
  const OWNER = ten[0] ?? '';
  const ownerDiscord = `9${runId.replace(/\D/g, '') || '1'}0001`;
  const groups = { g: '' };
  const idOf = new Map<string, string>();
  const gameIds: number[] = [];
  let token = '';
  let party = 0;

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
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    });

  /** One card write through the real route. */
  async function card(body: Record<string, unknown>) {
    const response = await setGroupModeRoute(adminOptions)(
      jsonRequest('/api/admin/mode', { groupId: groups.g, ...body }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  }

  async function cardRow() {
    const { data, error } = await db
      .from('group_modes')
      .select(
        'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at, pending_set_by',
      )
      .eq('group_id', groups.g)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function lockOf(lobbyId: string) {
    const { data, error } = await db
      .from('lobbies')
      .select('lock_mode, lock_rule, lock_class_tag, lock_region_blue, lock_region_red, lock_rated')
      .eq('id', lobbyId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Opens a lobby of the ten through the companion route; returns its party and id. */
  async function openLobby(): Promise<{ partyId: string; lobbyId: string }> {
    party += 1;
    const partyId = `it-${runId}-party-${party}`;
    const response = await postLobby(
      jsonRequest(
        '/api/companion/lobby',
        {
          partyId,
          lobbyName: 'mode night',
          members: ten.map((puuid, index) => ({
            puuid,
            gameName: `P${index}`,
            tagLine: 'EUW',
            summonerId: 9_000 + index,
            side: index < 5 ? 100 : 200,
            isSpectator: false,
          })),
        },
        token,
      ),
    );
    expect(response.status).toBe(200);
    const { lobbyId } = (await response.json()) as { lobbyId: string };
    return { partyId, lobbyId };
  }

  async function openAndRoll() {
    const opened = await openLobby();
    await rollForTest(db, opened.lobbyId);
    return opened;
  }

  async function startGame(partyId: string, gameId: number) {
    const response = await postGame(
      jsonRequest('/api/companion/game', { phase: 'in_progress', gameId, partyId }, token),
    );
    expect(response.status).toBe(200);
  }

  /** Posts the end-of-game block; `champions` are the ten picks in seat order. */
  async function record(
    partyId: string | null,
    options: { gameId?: number; champions?: number[]; durationS?: number; gameMode?: string } = {},
  ) {
    const gameId = options.gameId ?? testGameId() + gameIds.length;
    gameIds.push(gameId);
    const body = eogBody({
      gameId,
      partyId,
      puuids: ten,
      startedAt: new Date().toISOString(),
      ...(options.durationS === undefined ? {} : { durationS: options.durationS }),
      ...(options.gameMode === undefined ? {} : { raw: { gameMode: options.gameMode } }),
    });
    (body.participants as Record<string, unknown>[]).forEach((participant, index) => {
      participant.championId = options.champions?.[index] ?? 100 + index;
    });
    const response = await postGame(jsonRequest('/api/companion/game', body, token));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Record<string, unknown>;
    const { data, error } = await db
      .from('games')
      .select(
        'id, mode, rule, rule_class_tag, rule_region_blue, rule_region_red, rated, rule_checked, rule_check',
      )
      .eq('lcu_game_id', gameId)
      .single();
    if (error) throw new Error(error.message);
    return { answer, game: data, gameId };
  }

  async function ratingsOfTen() {
    const { data, error } = await db
      .from('ratings')
      .select('player_id, mu, sigma, games, wins')
      .eq('group_id', groups.g)
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

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    for (const [puuid, id] of ids) idOf.set(puuid, id);
    Object.assign(
      groups,
      await createTestGroups(db, runId, ['mn'] as const).then((made) => ({ g: made.mn })),
    );
    const ownerId = idOf.get(OWNER) ?? '';
    const linked = await db.from('players').update({ discord_id: ownerDiscord }).eq('id', ownerId);
    if (linked.error) throw new Error(linked.error.message);
    await setTestMembership(db, groups.g, ownerId, 'owner');
    for (const puuid of ten.slice(1)) await setTestMembership(db, groups.g, idOf.get(puuid) ?? '', 'member');
    const minted = mintCompanionToken();
    const inserted = await db.from('companion_tokens').insert({
      player_id: ownerId,
      token_hash: minted.tokenHash,
      label: `mn-${runId}`,
      group_id: groups.g,
    });
    if (inserted.error) throw new Error(inserted.error.message);
    token = minted.token;
  });

  afterAll(async () => {
    await db.from('games').delete().in('lcu_game_id', gameIds);
    await deleteTestGroups(db, Object.values(groups));
    await db.from('players').delete().in('puuid', ten);
  });

  describe('the card', () => {
    it('a rule pick is pending on the group, names the setter, and moves updated_at', async () => {
      const before = await cardRow();
      const answer = await card({ mode: 'class:Tank' });
      expect(answer).toMatchObject({
        mode: 'fearless',
        state: { standing: 'fearless', pending: { id: 'class', tag: 'Tank' }, rated: null, nextRated: false },
        notice: 'Next game: Class wars, tanks only. Not rated.',
        next: { rule: 'class:Tank', rated: false },
      });
      const after = await cardRow();
      expect(after).toMatchObject({
        mode: 'fearless',
        pending_rule: 'class',
        pending_class_tag: 'Tank',
        rated_override: null,
        pending_set_by: idOf.get(OWNER),
      });
      expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
    });

    it('anon reads the card state but never who set it (0029 rule)', async () => {
      const anon = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });
      const allowed = await anon
        .from('group_modes')
        .select(
          'mode, pending_rule, pending_class_tag, pending_region_blue, pending_region_red, rated_override, updated_at',
        )
        .eq('group_id', groups.g)
        .single();
      expect(allowed.error).toBeNull();
      const refused = await anon.from('group_modes').select('pending_set_by').eq('group_id', groups.g);
      expect(refused.error?.code).toBe('42501');
    });
  });

  describe('the lock at Roll', () => {
    it('Roll moves the rule onto the lock, Reroll keeps it, a pick after Roll is for the next game, teams coming down drop it', async () => {
      await card({ mode: 'class:Tank' });
      const { lobbyId, partyId } = await openAndRoll();
      const locked = await lockOf(lobbyId);
      // M20.7: Rated is moved as it was (null = the rule's default), and the row is emptied.
      expect(locked).toEqual({
        lock_mode: 'fearless',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_region_blue: null,
        lock_region_red: null,
        lock_rated: null,
      });
      expect(await cardRow()).toMatchObject({ pending_rule: null, rated_override: null });

      // Reroll: split 2 promoted, the lock untouched.
      const splits = await listSplits(db, lobbyId);
      const second = splits.find((split) => split.rank === 2);
      expect(second).toBeDefined();
      const promoted = await promoteSplit(db, { lobbyId, splitId: second?.id ?? '' });
      expect(promoted).toMatchObject({ ok: true, value: { promoted: true } });
      expect(await lockOf(lobbyId)).toEqual(locked);

      // A pick after Roll: pending for the next game, the lobby keeps its copy.
      await card({ mode: 'class:Mage' });
      expect(await lockOf(lobbyId)).toEqual(locked);
      expect(await cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Mage' });

      // The teams come down: the lock goes; the newer pick keeps the row (no hand-back over it), and
      // the next Roll locks it.
      expect(await moveLobby(db, { lobbyId, from: ['balanced'], to: 'open' })).toBe(true);
      expect(await lockOf(lobbyId)).toMatchObject({ lock_mode: null, lock_rule: null, lock_rated: null });
      expect(await cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Mage' });
      await rollForTest(db, lobbyId);
      expect(await lockOf(lobbyId)).toMatchObject({ lock_rule: 'class', lock_class_tag: 'Mage' });

      // Close this lobby with its game so the next scenario starts clean.
      const closed = await record(partyId);
      expect(closed.game).toMatchObject({ rule: 'class', rule_class_tag: 'Mage' });
    });

    it('region wars is drawn when chosen (M20 D9), Roll locks that pair, and Reroll keeps it', async () => {
      await card({ mode: 'region' });
      const chosen = await cardRow();
      expect(chosen.pending_rule).toBe('region');
      expect(chosen.pending_region_blue).not.toBeNull();
      expect(chosen.pending_region_red).not.toBe(chosen.pending_region_blue);
      expect([chosen.pending_region_blue, chosen.pending_region_red]).not.toContain('unaffiliated');
      const { lobbyId, partyId } = await openAndRoll();
      const locked = await lockOf(lobbyId);
      expect(locked).toMatchObject({
        lock_rule: 'region',
        lock_region_blue: chosen.pending_region_blue,
        lock_region_red: chosen.pending_region_red,
      });
      expect(await cardRow()).toMatchObject({
        pending_rule: null,
        pending_region_blue: null,
        pending_region_red: null,
      });
      const second = (await listSplits(db, lobbyId)).find((split) => split.rank === 2);
      await promoteSplit(db, { lobbyId, splitId: second?.id ?? '' });
      expect(await lockOf(lobbyId)).toEqual(locked);
      const { game } = await record(partyId);
      expect(game).toMatchObject({
        rule: 'region',
        rule_region_blue: locked.lock_region_blue,
        rule_region_red: locked.lock_region_red,
        rated: false,
      });
    });
  });

  describe('the stamp and what a record writes', () => {
    it('a mid-game standing switch does not change the running game (R2)', async () => {
      await card({ mode: 'fearless' });
      await card({ mode: 'class:Tank' });
      const { partyId } = await openAndRoll();
      const gameId = testGameId() + 500;
      await startGame(partyId, gameId);
      // Mid-game: Normal, which also clears the pending rule (R1).
      await card({ mode: 'normal' });
      // Sejuani, Nautilus, Shyvana, Volibear, Malphite | Sejuani... red breaks it with Jinx (222).
      const { game, answer } = await record(partyId, {
        gameId,
        champions: [113, 111, 102, 106, 54, 3, 12, 14, 32, 222],
      });
      expect(game).toMatchObject({
        mode: 'fearless',
        rule: 'class',
        rule_class_tag: 'Tank',
        rated: false,
        rule_checked: true,
      });
      expect(game.rule_check).toMatchObject({
        kind: 'sides',
        blue: { verdict: 'kept', broke: [] },
        red: { verdict: 'broke', broke: [222] },
      });
      expect(answer).toMatchObject({ rated: false, reason: 'not-rated' });
      expect(await cardRow()).toMatchObject({ mode: 'normal', pending_rule: null });
    });

    it('a rule queued mid-game survives the record; with nothing queued, the rule is used up', async () => {
      await card({ mode: 'class:Tank' });
      const first = await openAndRoll();
      const gameId = testGameId() + 600;
      await startGame(first.partyId, gameId);
      await card({ mode: 'class:Mage' });
      const queued = await record(first.partyId, { gameId });
      expect(queued.game).toMatchObject({ rule: 'class', rule_class_tag: 'Tank' });
      expect(await cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Mage' });

      const second = await openAndRoll();
      const used = await record(second.partyId);
      expect(used.game).toMatchObject({ rule: 'class', rule_class_tag: 'Mage' });
      expect(await cardRow()).toMatchObject({
        pending_rule: null,
        pending_class_tag: null,
        rated_override: null,
      });
    });

    it('the Rated switch locks at Roll and resets after the game', async () => {
      await card({ rated: false });
      const { partyId, lobbyId } = await openAndRoll();
      expect((await lockOf(lobbyId)).lock_rated).toBe(false);
      const { game } = await record(partyId);
      expect(game).toMatchObject({ mode: 'normal', rule: null, rated: false, rule_checked: false });
      expect(await cardRow()).toMatchObject({ rated_override: null });
    });

    it('a remake and an ARAM hand the rule back; a live game with no lobby plays the pending rule and uses it up', async () => {
      await card({ mode: 'class:Support' });
      const remake = await openAndRoll();
      const short = await record(remake.partyId, { durationS: 200 });
      expect(short.game).toMatchObject({
        rule: 'class',
        rated: false,
        rule_checked: false,
        rule_check: null,
      });
      expect(await cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Support' });

      const aram = await openAndRoll();
      const abyss = await record(aram.partyId, { gameMode: 'ARAM' });
      expect(abyss.game).toMatchObject({ rule: 'class', rated: false, rule_checked: false });
      expect(await cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Support' });

      // M20.6/M20.7 (decision row 2026-10-05): a live Rift game with no lock plays the pending
      // rule and Rated and uses them up.
      const loose = await record(null);
      expect(loose.game).toMatchObject({
        mode: 'normal',
        rule: 'class',
        rule_class_tag: 'Support',
        rated: false,
        rule_checked: true,
      });
      expect(loose.answer).toMatchObject({ rated: false });
      expect(await cardRow()).toMatchObject({
        pending_rule: null,
        pending_class_tag: null,
        rated_override: null,
      });
      await card({ mode: 'normal' });
    });
  });

  describe('a not-rated game', () => {
    it('leaves ratings, roles and the Fearless pool untouched, and a rebuild agrees with ingest', async () => {
      await card({ mode: 'fearless' });
      // A rated Fearless game first, so there are ratings and a pool to keep.
      const rated = await openAndRoll();
      const ratedGame = await record(rated.partyId);
      expect(ratedGame.answer).toMatchObject({ rated: true });
      const ratingsBefore = await ratingsOfTen();
      const rolesBefore = await rolesOfTen();
      const poolBefore = (await loadFearless(db, groups.g)).champions.map((champion) => champion.id).sort();
      expect(poolBefore.length).toBeGreaterThan(0);

      await card({ mode: 'class:Mage' });
      const off = await openAndRoll();
      const { game, answer } = await record(off.partyId, { champions: [1, 4, 7, 8, 13, 25, 26, 30, 34, 38] });
      expect(answer).toMatchObject({ created: true, rated: false, reason: 'not-rated' });
      expect(game.rated).toBe(false);
      const { data: seats } = await db.from('game_players').select('mu_after').eq('game_id', game.id);
      expect(seats?.every((seat) => seat.mu_after === null)).toBe(true);
      expect(await ratingsOfTen()).toEqual(ratingsBefore);
      expect(await rolesOfTen()).toEqual(rolesBefore);
      expect((await loadFearless(db, groups.g)).champions.map((champion) => champion.id).sort()).toEqual(
        poolBefore,
      );

      // The rebuild skips it as not-rated and lands on the numbers ingest wrote.
      const rebuilt = await rebuildRatings(db, { groupId: groups.g, force: true });
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) expect(rebuilt.report.skipped['not-rated']).toBeGreaterThanOrEqual(1);
      const after = await ratingsOfTen();
      expect(after.map((row) => [row.player_id, row.games, row.wins])).toEqual(
        ratingsBefore.map((row) => [row.player_id, row.games, row.wins]),
      );
      for (const [index, row] of after.entries()) {
        expect(row.mu).toBeCloseTo(ratingsBefore[index]?.mu ?? 0, 6);
      }
      const { data: stillNull } = await db.from('game_players').select('mu_after').eq('game_id', game.id);
      expect(stillNull?.every((seat) => seat.mu_after === null)).toBe(true);
    });

    // The owner's repair for a game stamped rated by mistake (owner bug 2026-10-04): set
    // `games.rated = false` by hand, then `rebuild-ratings`. The game leaves every number.
    it('a game un-rated by hand after it was rated: one rebuild takes it out of every number', async () => {
      await card({ mode: 'normal' });
      const first = await openAndRoll();
      await record(first.partyId);
      const rebuiltFirst = await rebuildRatings(db, { groupId: groups.g, force: true });
      expect(rebuiltFirst.ok).toBe(true);
      const kustom = async () =>
        (
          await db
            .from('ratings')
            .select('player_id, mu, sigma, r, games, wins')
            .eq('group_id', groups.g)
            .order('player_id')
        ).data ?? [];
      const ratingsBefore = await kustom();

      const mistake = await openAndRoll();
      const { game } = await record(mistake.partyId);
      expect(game.rated).toBe(true);
      const ratedSeats = await db.from('game_players').select('r_after, mu_after').eq('game_id', game.id);
      expect(ratedSeats.data?.every((seat) => seat.r_after !== null && seat.mu_after !== null)).toBe(true);
      expect(await kustom()).not.toEqual(ratingsBefore);

      const unrated = await db.from('games').update({ rated: false }).eq('id', game.id);
      expect(unrated.error).toBeNull();
      const rebuilt = await rebuildRatings(db, { groupId: groups.g, force: true });
      expect(rebuilt.ok).toBe(true);
      if (rebuilt.ok) expect(rebuilt.report.skipped['not-rated']).toBeGreaterThanOrEqual(1);

      const after = await kustom();
      expect(after.map((row) => [row.player_id, row.games, row.wins])).toEqual(
        ratingsBefore.map((row) => [row.player_id, row.games, row.wins]),
      );
      for (const [index, row] of after.entries()) {
        expect(row.mu).toBeCloseTo(ratingsBefore[index]?.mu ?? 0, 6);
        expect(row.sigma).toBeCloseTo(ratingsBefore[index]?.sigma ?? 0, 6);
        expect(row.r).toBeCloseTo(ratingsBefore[index]?.r ?? 0, 6);
      }
      const { data: seats, error } = await db
        .from('game_players')
        .select(
          'mu_before, sigma_before, mu_after, sigma_after, fold_p, base_mu_after, award, rated_games_before, r_before, r_after, k, share_rank, week_r_before, week_r_after, week_k, week_fold_p, week_games_before',
        )
        .eq('game_id', game.id);
      expect(error).toBeNull();
      expect(seats).toHaveLength(10);
      for (const seat of seats ?? []) {
        for (const value of Object.values(seat)) expect(value).toBeNull();
      }
    });
  });

  describe('Spin', () => {
    it('is chosen on the server: mirror may land (M17.17), never tonight previous rule', async () => {
      await card({ mode: 'normal' });
      // Tonight's last rule game was Mage (the not-rated game above).
      const spun = new Set<string>();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const body = (await card({ spin: true })) as { spun: string; next: { rule: string } };
        spun.add(body.spun);
        expect(body.spun).not.toBe('class:Mage');
        expect(body.next.rule).toBe(body.spun);
      }
      expect(spun.has('mirror')).toBe(true);
      await card({ mode: 'normal' });
    });
  });
  // Prod fix 2026-10-04 ("the Rated switch doesn't toggle"): the route and Tonight's own read,
  // flip by flip. Last in the file: the after-Roll case records a game.
  describe('the Rated switch', () => {
    const anon = createClient<Database>(stack.url, stack.anonKey, { auth: { persistSession: false } });

    /** What Tonight's server render reads for the switch (anon key, `loadModeState`). */
    async function tonightRated(): Promise<{ rated: boolean; version: number }> {
      const state = await loadModeState(anon, groups.g);
      if (state === null) throw new Error('Tonight could not read the card state');
      return { rated: nextGame(state).rated, version: state.version };
    }

    function formRequest(fields: Record<string, string>) {
      return new Request('http://localhost/api/admin/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
    }

    it('toggles off and on and off again through the route, and Tonight reads every flip', async () => {
      await card({ mode: 'fearless' });
      const start = await tonightRated();
      expect(start.rated).toBe(true);

      // M20.7: no version; Tonight's order is `updated_at`, which every write moves.
      const off = await card({ rated: false });
      expect(off).toMatchObject({ ok: true, changed: true, state: { rated: false }, next: { rated: false } });
      const read1 = await tonightRated();
      expect(read1.rated).toBe(false);
      expect(read1.version).toBeGreaterThan(start.version);

      const on = await card({ rated: true });
      expect(on).toMatchObject({
        ok: true,
        changed: true,
        state: { rated: true },
        notice: 'Next game is rated.',
      });
      const read2 = await tonightRated();
      expect(read2.rated).toBe(true);
      expect(read2.version).toBeGreaterThan(read1.version);

      // The same value twice is still a write (it is a choice for the next game).
      const again = await card({ rated: true });
      expect(again).toMatchObject({ changed: true, state: { rated: true } });

      const offAgain = await card({ rated: false });
      expect(offAgain).toMatchObject({ state: { rated: false } });
      expect((await tonightRated()).rated).toBe(false);
    });

    it('works as a form post with no JS, both ways, and comes back to Tonight saying so', async () => {
      const route = setGroupModeRoute(adminOptions);
      const on = await route(formRequest({ groupId: groups.g, rated: 'true', redirectTo: '/g/somewhere' }));
      expect(on.status).toBe(303);
      expect(on.headers.get('location')).toContain('/g/somewhere');
      expect(decodeURIComponent(on.headers.get('location') ?? '').replaceAll('+', ' ')).toContain(
        'Next game is rated.',
      );
      expect((await tonightRated()).rated).toBe(true);
      const off = await route(formRequest({ groupId: groups.g, rated: 'false', redirectTo: '/g/somewhere' }));
      expect(off.status).toBe(303);
      expect((await tonightRated()).rated).toBe(false);
    });

    it('a body that is not a boolean is refused (400), and nothing moves', async () => {
      const before = await tonightRated();
      const response = await setGroupModeRoute(adminOptions)(
        jsonRequest('/api/admin/mode', { groupId: groups.g, rated: 'maybe' }),
      );
      expect(response.status).toBe(400);
      expect(await tonightRated()).toEqual(before);
    });

    it('after Roll it still toggles, for the next game: the running game keeps its lock', async () => {
      await card({ mode: 'fearless' });
      const { lobbyId, partyId } = await openAndRoll();
      const locked = await lockOf(lobbyId);
      // Rated as moved: null, the standing mode's default (rated).
      expect(locked).toMatchObject({ lock_mode: 'fearless', lock_rated: null });

      await card({ rated: false });
      expect((await tonightRated()).rated).toBe(false);
      await card({ rated: true });
      expect((await tonightRated()).rated).toBe(true);
      await card({ rated: false });
      expect((await tonightRated()).rated).toBe(false);
      expect(await lockOf(lobbyId)).toEqual(locked);

      // The admin foot names the change: the same mode, only Rated differs.
      expect(await adminLine(lobbyId)).toBe('Next game: not rated.');

      // The running game is rated as locked; the flip survives it, for the next game.
      const { game } = await record(partyId);
      expect(game.rated).toBe(true);
      expect(await cardRow()).toMatchObject({ rated_override: false });
      await card({ mode: 'normal' });
    });

    /** The admin foot's `Next game: …` line as Tonight draws it from the reads, while the lobby is set. */
    async function adminLine(lobbyId: string): Promise<string | null> {
      const state = await loadModeState(anon, groups.g);
      const lock = await loadLobbyLock(anon, lobbyId);
      if (state === null || lock === null) throw new Error('no card state or no lock');
      return modeCardView({
        state,
        lobbyStatus: 'balanced',
        lock,
        bans: [],
        table: championTable(),
      }).nextLine;
    }

    // The user's decision 2026-10-04: after Roll, flipping Rated changes only Rated.
    it('after Roll a flip changes only Rated: the rule is used up, the flip is for the next game', async () => {
      await card({ mode: 'fearless' });
      await card({ mode: 'class:Tank' });
      const { lobbyId, partyId } = await openAndRoll();
      expect(await lockOf(lobbyId)).toMatchObject({
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: null,
      });

      await card({ rated: true });
      // The card does not promise Tanks only again.
      expect(await adminLine(lobbyId)).toBe('Next game: Fearless.');
      await card({ rated: false });
      await card({ rated: true });

      const gameId = testGameId() + 900;
      await startGame(partyId, gameId);
      const { game } = await record(partyId, { gameId });
      // The running game kept its lock; the rule is used up; the last flip stands for the next game.
      expect(game).toMatchObject({ rule: 'class', rule_class_tag: 'Tank', rated: false });
      expect(await cardRow()).toMatchObject({
        mode: 'fearless',
        pending_rule: null,
        pending_class_tag: null,
        rated_override: true,
      });
      expect(await tonightRated()).toMatchObject({ rated: true });

      // The next game is a plain Fearless game.
      const next = await openAndRoll();
      expect(await lockOf(next.lobbyId)).toMatchObject({
        lock_mode: 'fearless',
        lock_rule: null,
        lock_rated: true,
      });
      await record(next.partyId);
      await card({ mode: 'normal' });
    });

    it('after Roll a flip then a new rule: the new rule survives the record, Rated said with it', async () => {
      await card({ mode: 'fearless' });
      await card({ mode: 'class:Tank' });
      const { lobbyId, partyId } = await openAndRoll();
      await card({ rated: true });
      await card({ mode: 'class:Mage' });
      await card({ rated: true });
      expect(await adminLine(lobbyId)).toBe('Next game: Mages only. Rated.');
      await record(partyId);
      expect(await cardRow()).toMatchObject({
        pending_rule: 'class',
        pending_class_tag: 'Mage',
        rated_override: true,
      });
      await card({ mode: 'normal' });
    });
  });

  // Owner bug 2026-10-04 (game d1a55a9b): Rated off before Roll, then teams made by hand. Rolling
  // is a suggestion; the switch and the rule belong to the game actually played.
  describe('hand-made teams keep the card (rolling is a suggestion)', () => {
    /** Posts the lobby again with `who` (default the ten), blue for the puuids in `blue`. */
    async function repost(partyId: string, blue: readonly string[], who: readonly string[] = ten) {
      const response = await postLobby(
        jsonRequest(
          '/api/companion/lobby',
          {
            partyId,
            lobbyName: 'mode night',
            members: who.map((puuid) => ({
              puuid,
              gameName: `P${ten.indexOf(puuid)}`,
              tagLine: 'EUW',
              summonerId: 9_000 + ten.indexOf(puuid),
              side: blue.includes(puuid) ? 100 : 200,
              isSpectator: false,
            })),
          },
          token,
        ),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { status: string };
    }

    const handBlue = () => [ten[0], ten[2], ten[4], ten[6], ten[8]] as string[];

    it('Rated off, Roll, sides swapped by hand: the game is not rated', async () => {
      await card({ mode: 'normal' });
      await card({ rated: false });
      const { partyId } = await openAndRoll();
      expect((await repost(partyId, handBlue())).status).toBe('balanced');
      const gameId = testGameId() + 1_001;
      await startGame(partyId, gameId);
      const { game } = await record(partyId, { gameId });
      expect(game).toMatchObject({ mode: 'normal', rated: false });
      expect(await cardRow()).toMatchObject({ rated_override: null });
    });

    it('Rated off, Roll, someone leaves and comes back (teams come down): the game is not rated', async () => {
      await card({ mode: 'normal' });
      await card({ rated: false });
      const { partyId, lobbyId } = await openAndRoll();
      expect(await cardRow()).toMatchObject({ rated_override: null });
      expect((await repost(partyId, handBlue(), ten.slice(0, 9))).status).toBe('open');
      // M20.7: the teams coming down handed Rated back to the row.
      expect(await cardRow()).toMatchObject({ rated_override: false });
      expect((await repost(partyId, handBlue())).status).toBe('open');
      expect((await lockOf(lobbyId)).lock_mode).toBeNull();
      const gameId = testGameId() + 1_002;
      await startGame(partyId, gameId);
      // The game took the card at its start: Tonight's card is this game's, not rated.
      expect(await lockOf(lobbyId)).toMatchObject({ lock_mode: 'normal', lock_rated: false });
      const { game, answer } = await record(partyId, { gameId });
      expect(game).toMatchObject({ mode: 'normal', rated: false });
      expect(answer).toMatchObject({ rated: false });
      // Used up like a rolled game's: the next game is back to the default.
      expect(await cardRow()).toMatchObject({ rated_override: null });
    });

    it('Rated off and never rolled: the game is not rated', async () => {
      await card({ mode: 'normal' });
      await card({ rated: false });
      const { partyId } = await openLobby();
      await repost(partyId, handBlue());
      const gameId = testGameId() + 1_003;
      await startGame(partyId, gameId);
      const { game } = await record(partyId, { gameId });
      expect(game).toMatchObject({ mode: 'normal', rated: false });
      expect(await cardRow()).toMatchObject({ rated_override: null });
    });

    it('no in_progress post at all (a missed start): the eog takes the card, not rated', async () => {
      await card({ mode: 'normal' });
      await card({ rated: false });
      const { partyId } = await openLobby();
      const { game } = await record(partyId);
      expect(game).toMatchObject({ mode: 'normal', rated: false });
      expect(await cardRow()).toMatchObject({ rated_override: null });
    });

    it('a class rule survives hand-made teams and is used up by the game played', async () => {
      await card({ mode: 'normal' });
      await card({ mode: 'class:Tank' });
      const { partyId, lobbyId } = await openAndRoll();
      await repost(partyId, handBlue(), ten.slice(1));
      await repost(partyId, handBlue());
      expect((await lockOf(lobbyId)).lock_mode).toBeNull();
      const gameId = testGameId() + 1_004;
      await startGame(partyId, gameId);
      const { game } = await record(partyId, { gameId });
      expect(game).toMatchObject({ rule: 'class', rule_class_tag: 'Tank', rated: false, rule_checked: true });
      expect(await cardRow()).toMatchObject({ pending_rule: null, rated_override: null });
    });

    it('a flip after the game started is for the next game (R9 still holds)', async () => {
      await card({ mode: 'normal' });
      const { partyId } = await openLobby();
      const gameId = testGameId() + 1_005;
      await startGame(partyId, gameId);
      await card({ rated: false });
      const { game } = await record(partyId, { gameId });
      expect(game).toMatchObject({ rated: true });
      expect(await cardRow()).toMatchObject({ rated_override: false });
      await card({ rated: true });
      await card({ mode: 'normal' });
    });
  });
}
