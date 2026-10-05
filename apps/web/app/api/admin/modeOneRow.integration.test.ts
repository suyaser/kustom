import { pairDrawable, regionOpenCounts } from '@customs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { regionWord } from '@/lib/discord/modeLines';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { descriptionOf, modeNight, seededRng, sequenceRng, stackWithModes } from '@/lib/testing/modeNight';

/**
 * M20.7 acceptance against the local stack: the Mode card on one row (`0047`), through the real
 * routes (`/api/admin/mode`, the admin Roll and Reroll, the companion's lobby and game posts).
 *
 *  (1) each action is one update of only its fields;
 *  (2) races, two connections, repeated: a pick racing Roll ends in the lock or still pending,
 *      never lost; a pick racing a hand-back is kept; a pick racing a record is never cleared; two
 *      actions on different fields both land;
 *  (3) teams down after a new choice keep it: an admin write after the lock stops the hand-back
 *      (M20.7 review); with none, the rule and Rated come back exactly;
 *  (4) a remake and an ARAM hand back, the pair returned is the one locked (a `this` redraw
 *      included); a second companion's post is a no-op; a dropped lobby hands nothing back and a
 *      late block stamps from its lock;
 *  (5) a Rift record leaves `group_modes` byte-identical;
 *  (7) region wars chosen with no lobby, idle, and beside a lobby of three writes a passing pair;
 *      after 0048 the check constraint refuses a region rule without one (between 0047 and 0048
 *      the pre-M20.7 build may still write one, and this build never does);
 *  (8) Spin landing on region wars writes its pair in the same update;
 *  (9) a pair the bans made short: Roll draws a fresh passing pair and the answer says so (the
 *      no-draw half is `regionWars.integration.test.ts` step 9);
 * (12) one `group_live` bump of kind `mode` per action, none for a refusal;
 *  and the region actions on this game (`game: 'this'`): the lock changes, the teams post goes
 *  again, nothing else moves; refused once the game has started, also when racing the start.
 *
 * (6) Reroll keeping the lock and its pair, (10) the M15 suites and (11) the fold are
 * `regionWars`, `classWars`, `mirrorMatch` and `modeOfTheNight`. Skipped without the local stack
 * (or before `0047`).
 */

const stack = await stackWithModes(await resolveLocalStack());

/** Rounds per race: each one a fresh lobby, so the two writes really meet in the database. */
const ROUNDS = 6;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (stack === null) {
  describe.skip('the one-row mode card against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'or');
  const { championTable } = await import('@/lib/mode/champions');

  type Row = Awaited<ReturnType<typeof night.cardRow>>;

  /** Puts the card in a known state straight in the database (not an action under test). */
  async function setRow(over: Partial<Row> = {}) {
    const { error } = await night.db
      .from('group_modes')
      .update({
        mode: 'normal',
        pending_rule: null,
        pending_class_tag: null,
        pending_region_blue: null,
        pending_region_red: null,
        rated_override: null,
        ...over,
      })
      .eq('group_id', night.group.id);
    if (error) throw new Error(error.message);
  }

  async function liveVersion(): Promise<{ version: number; kind: string }> {
    const { data, error } = await night.db
      .from('group_live')
      .select('version, kind')
      .eq('group_id', night.group.id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Closes a lobby out of the way without handing anything back (abandoned is not teams coming down). */
  async function abandon(lobbyId: string) {
    const { error } = await night.db.from('lobbies').update({ status: 'abandoned' }).eq('id', lobbyId);
    if (error) throw new Error(error.message);
  }

  /** A lobby of the ten, rolled. */
  async function rolled() {
    const lobby = await night.openLobby();
    const answer = await night.roll(lobby.lobbyId);
    return { ...lobby, answer };
  }

  const regionRow = (blue: string, red: string, over: Partial<Row> = {}): Partial<Row> => ({
    pending_rule: 'region',
    pending_region_blue: blue,
    pending_region_red: red,
    ...over,
  });

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe('(1) each action is one update of only its fields', () => {
    it('Rated, a side and a redraw touch nothing else; a rule resets only Rated', async () => {
      await setRow(regionRow('zaun', 'noxus', { rated_override: true }));

      await night.card({ rated: false });
      expect(await night.cardRow()).toMatchObject(
        regionRow('zaun', 'noxus', { mode: 'normal', rated_override: false }),
      );

      await night.card({ side: 'blue', region: 'ionia' });
      expect(await night.cardRow()).toMatchObject(
        regionRow('ionia', 'noxus', { mode: 'normal', rated_override: false }),
      );

      const redrawn = await night.card({ redraw: true });
      const after = await night.cardRow();
      expect(after).toMatchObject({ mode: 'normal', pending_rule: 'region', rated_override: false });
      expect([after.pending_region_blue, after.pending_region_red].sort()).not.toEqual(['ionia', 'noxus']);
      expect(redrawn.notice).toMatch(/^Next game: .+ vs .+\.$/);

      await night.card({ mode: 'class:Mage' });
      expect(await night.cardRow()).toMatchObject({
        mode: 'normal',
        pending_rule: 'class',
        pending_class_tag: 'Mage',
        pending_region_blue: null,
        pending_region_red: null,
        rated_override: null,
      });
    });
  });

  describe('(12) one group_live bump of kind mode per action, none for a refusal', () => {
    it('standing, rule, Rated, Spin, redraw and side each bump once', async () => {
      await setRow();
      const actions: Record<string, unknown>[] = [
        { mode: 'fearless' },
        { mode: 'region' },
        { rated: true },
        { redraw: true },
        { side: 'red', region: 'ionia' },
        { spin: true },
        { mode: 'normal' },
      ];
      for (const action of actions) {
        const before = await liveVersion();
        // `side: red ionia` may collide with blue's region after the redraw: then it is a refusal.
        const { status } = await night.cardAnswer(action);
        const after = await liveVersion();
        if (status === 200) expect(after).toEqual({ version: before.version + 1, kind: 'mode' });
        else expect(after.version).toBe(before.version);
      }
      const before = await liveVersion();
      expect((await night.cardAnswer({ mode: 'normal' })).json).toMatchObject({ changed: false });
      expect((await night.cardAnswer({ redraw: true })).status).toBe(409);
      expect((await liveVersion()).version).toBe(before.version);
    });
  });

  describe('(7) region wars is drawn when chosen, with or without a lobby', () => {
    const passes = (row: Row) =>
      row.pending_region_blue !== null &&
      row.pending_region_red !== null &&
      pairDrawable(row.pending_region_blue, row.pending_region_red, championTable(), []);

    it('on a group with no lobby, idle after a game, and beside a lobby of three', async () => {
      // No lobby at all (this file has opened none yet).
      await setRow();
      await night.card({ mode: 'region' });
      expect(passes(await night.cardRow())).toBe(true);

      // Idle: a game played and finished.
      await setRow();
      await night.playGame([103, 157, 39, 43, 98, 22, 113, 201, 1, 266]);
      await night.card({ mode: 'region' });
      expect(passes(await night.cardRow())).toBe(true);

      // A lobby of three, filling.
      await setRow();
      const partyId = `it-or-three-${Date.now()}`;
      const lobbyId = await night.companionLobby(partyId, night.ten.slice(0, 3));
      await night.card({ mode: 'region' });
      expect(passes(await night.cardRow())).toBe(true);
      await abandon(lobbyId);
      // Open counts never matter on Normal: the check above counts no bans, as the draw did.
      expect(regionOpenCounts(championTable(), []).size).toBeGreaterThan(0);
    });

    it('after 0048 the check refuses a region rule without its pair; between 0047 and 0048 the old build may still write one', async () => {
      // The stage: 0048 drops `group_modes.version` in the same transaction that adds the check.
      const contracted = (await night.db.from('group_modes').select('version').limit(1)).error !== null;
      const writes = [
        { pending_rule: 'region', pending_region_blue: null, pending_region_red: null },
        { pending_rule: 'region', pending_region_blue: 'ionia', pending_region_red: 'ionia' },
        { pending_rule: 'mirror', pending_region_blue: 'ionia', pending_region_red: 'noxus' },
      ];
      for (const write of writes) {
        const { error } = await night.db.from('group_modes').update(write).eq('group_id', night.group.id);
        if (contracted) expect(error?.code).toBe('23514');
        else expect(error).toBeNull();
      }
      await setRow();
      // Either way, the new build never writes one: a pick draws the pair in the same update.
      await night.card({ mode: 'region' });
      expect(passes(await night.cardRow())).toBe(true);
      await setRow();
    });
  });

  describe('(8) Spin landing on region wars writes its pair in the same update', () => {
    it('seeded: the answer and the row carry the pair', async () => {
      let landed = false;
      for (let seed = 1; seed <= 60 && !landed; seed += 1) {
        await setRow();
        const { status, json } = await night.spin(seededRng(seed));
        expect(status).toBe(200);
        if (json.spun !== 'region') continue;
        landed = true;
        const row = await night.cardRow();
        expect(row.pending_rule).toBe('region');
        expect(row.pending_region_blue).not.toBeNull();
        expect(row.pending_region_red).not.toBe(row.pending_region_blue);
        expect(json).toMatchObject({
          state: { pending: { id: 'region', blue: row.pending_region_blue, red: row.pending_region_red } },
        });
        expect(json.notice).toMatch(/^Spin says: Region wars\. Blue: .+ · Red: .+\.$/);
      }
      expect(landed).toBe(true);
    });
  });

  describe('(2) races, two connections, repeated', () => {
    it('a pick racing Roll ends in the lock or still pending, never lost', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await setRow({ pending_rule: 'class', pending_class_tag: 'Tank' });
        const { lobbyId } = await night.openLobby();
        await Promise.all([
          night.roll(lobbyId),
          (async () => {
            await sleep(round * 7);
            await night.card({ mode: 'class:Mage' });
          })(),
        ]);
        const lock = await night.lockOf(lobbyId);
        const row = await night.cardRow();
        const inLock = lock.lock_rule === 'class' && lock.lock_class_tag === 'Mage';
        const pending = row.pending_rule === 'class' && row.pending_class_tag === 'Mage';
        expect(
          inLock || pending,
          `round ${round}: lock ${JSON.stringify(lock)} row ${JSON.stringify(row)}`,
        ).toBe(true);
        // Tanks was taken by this Roll or replaced by the pick, never both lost and kept twice.
        expect(inLock && pending).toBe(false);
        await abandon(lobbyId);
      }
    });

    it("M20.17: a next-game Redraw racing Roll lands in the lock or pending, or is refused as this game's", async () => {
      const refused: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        await setRow(regionRow('zaun', 'noxus'));
        const { lobbyId } = await night.openLobby();
        const [, redraw] = await Promise.all([
          night.roll(lobbyId),
          (async () => {
            await sleep(round * 7);
            return night.cardAnswer({ redraw: true, game: 'next' });
          })(),
        ]);
        const lock = await night.lockOf(lobbyId);
        const row = await night.cardRow();
        if (redraw.status === 409) {
          refused.push(round);
          // Roll took the rule first: the tap answers with the regions being this game's now.
          expect(redraw.json, `round ${round}`).toEqual({
            ok: false,
            error: "Teams were just rolled, so those regions are this game's now.",
          });
          expect(lock).toMatchObject({
            lock_rule: 'region',
            lock_region_blue: 'zaun',
            lock_region_red: 'noxus',
          });
          expect(row.pending_rule).toBeNull();
        } else {
          expect(redraw.status, JSON.stringify(redraw.json)).toBe(200);
          // The redraw first (the lock took its pair) or after Roll's read (still pending): never lost.
          expect(lock.lock_rule === 'region' || row.pending_rule === 'region', `round ${round}`).toBe(true);
        }
        await abandon(lobbyId);
      }
      // With Roll leading (round 0 starts both at once, later rounds delay the redraw), the
      // refusal is the common outcome; record it so a run that never meets the case says so.
      console.info(`M20.17 race: refused in rounds ${refused.join(', ') || 'none'} of ${ROUNDS}`);

      // Roll certainly first: the refusal, for a Redraw and for a side, and nothing written.
      await setRow(regionRow('zaun', 'noxus'));
      const { lobbyId } = await rolled();
      const before = await night.cardRow();
      for (const body of [
        { redraw: true, game: 'next' },
        { side: 'blue', region: 'ionia' },
      ]) {
        expect(await night.cardAnswer(body)).toEqual({
          status: 409,
          json: { ok: false, error: "Teams were just rolled, so those regions are this game's now." },
        });
      }
      expect(await night.cardRow()).toEqual(before);
      await abandon(lobbyId);
      // No lobby holding a region lock: today's answer stays.
      expect((await night.cardAnswer({ redraw: true })).json).toEqual({
        ok: false,
        error: 'Region wars is not on for that game.',
      });
    });

    it('a pick racing a hand-back (teams coming down) is kept, with its own Rated', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await setRow({ pending_rule: 'class', pending_class_tag: 'Tank', rated_override: true });
        const { partyId, lobbyId } = await rolled();
        expect(await night.cardRow()).toMatchObject({ pending_rule: null, rated_override: null });
        await Promise.all([
          night.companionLobby(partyId, night.ten.slice(0, 9)),
          (async () => {
            await sleep(round * 7);
            await night.card({ mode: 'class:Mage' });
          })(),
        ]);
        expect(await night.lockOf(lobbyId)).toMatchObject({ status: 'open', lock_mode: null });
        // Hand-back first then the pick, or the pick first and the hand-back filling nothing: Mage,
        // at Mage's default (the Tanks switch never lands on another rule).
        expect(await night.cardRow()).toMatchObject({
          pending_rule: 'class',
          pending_class_tag: 'Mage',
          rated_override: null,
        });
        await abandon(lobbyId);
      }
    });

    it('a pick racing the record of a rolled Rift game is never cleared', async () => {
      for (let round = 0; round < 3; round += 1) {
        await setRow({ pending_rule: 'class', pending_class_tag: 'Tank' });
        const { partyId, lobbyId } = await rolled();
        const gameId = await night.startGame(partyId);
        const body = await night.eogFor(
          lobbyId,
          partyId,
          gameId,
          [103, 157, 39, 43, 98, 22, 113, 201, 1, 266],
        );
        await Promise.all([
          night.postEog(body),
          (async () => {
            await sleep(round * 10);
            await night.card({ mode: 'class:Mage' });
          })(),
        ]);
        expect((await night.gameRow(gameId)).rule_class_tag).toBe('Tank');
        expect(await night.cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Mage' });
      }
    });

    it('two actions on different fields both land (an action never overwrites what it does not set)', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await setRow(regionRow('zaun', 'noxus', { rated_override: null }));
        const flip = round % 2 === 0;
        await Promise.all([
          night.card({ rated: flip }),
          (async () => {
            await sleep(round * 3);
            await night.card({ side: 'blue', region: 'ionia' });
          })(),
        ]);
        expect(await night.cardRow()).toMatchObject(regionRow('ionia', 'noxus', { rated_override: flip }));
      }
    });
  });

  describe('(3) teams coming down after a new choice', () => {
    it('keep the choice: any admin write after the lock stops the hand-back; none, and the row comes back exactly', async () => {
      // Nothing new: the rule and its Rated come back exactly.
      await setRow({ pending_rule: 'class', pending_class_tag: 'Tank', rated_override: true });
      const first = await rolled();
      await night.companionLobby(first.partyId, night.ten.slice(0, 9));
      expect(await night.cardRow()).toMatchObject({
        pending_rule: 'class',
        pending_class_tag: 'Tank',
        rated_override: true,
      });
      await abandon(first.lobbyId);

      // An admin write after the lock wins outright (M20.7 review): a Rated flip after Roll, and
      // nothing comes back, not even the rule.
      await setRow({ pending_rule: 'class', pending_class_tag: 'Tank', rated_override: true });
      const second = await rolled();
      await night.card({ rated: false });
      await night.companionLobby(second.partyId, night.ten.slice(0, 9));
      expect(await night.cardRow()).toMatchObject({
        pending_rule: null,
        pending_class_tag: null,
        rated_override: false,
      });
      await abandon(second.lobbyId);

      // The lead's example: Tanks locked, the admin picks Normal, the teams come down: still Normal.
      await setRow({ mode: 'fearless', pending_rule: 'class', pending_class_tag: 'Tank' });
      const fourth = await rolled();
      await night.card({ mode: 'normal' });
      await night.companionLobby(fourth.partyId, night.ten.slice(0, 9));
      expect(await night.cardRow()).toMatchObject({
        mode: 'normal',
        pending_rule: null,
        rated_override: null,
      });
      await abandon(fourth.lobbyId);

      // A new rule after Roll: it stays, at its own default.
      await setRow({ pending_rule: 'class', pending_class_tag: 'Tank', rated_override: true });
      const third = await rolled();
      await night.card({ mode: 'mirror' });
      await night.companionLobby(third.partyId, night.ten.slice(0, 9));
      expect(await night.cardRow()).toMatchObject({ pending_rule: 'mirror', rated_override: null });
      await abandon(third.lobbyId);
    });
  });

  describe('(4) remake and ARAM hand back; a dropped lobby does not', () => {
    it("a remake hands back the pair as last changed (a 'this' redraw included); a second post is a no-op", async () => {
      await setRow(regionRow('zaun', 'noxus'));
      const { partyId, lobbyId } = await rolled();
      night.clearPosts();
      const redrawn = await night.card({ redraw: true, game: 'this' });
      const lock = await night.lockOf(lobbyId);
      expect([lock.lock_region_blue, lock.lock_region_red].sort()).not.toEqual(['noxus', 'zaun']);
      expect(redrawn).toMatchObject({
        thisGame: { lobbyId, mode: { id: 'region', blue: lock.lock_region_blue, red: lock.lock_region_red } },
      });
      expect(redrawn.notice).toMatch(
        /^New regions: .+ vs .+\. Picks already made stay, and the check uses the new regions\.$/,
      );
      // The teams post went again, naming the new pair under M20.1's `new regions` line (M20.10).
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).toContain('This game: region wars, new regions.');
      expect(descriptionOf(night.posts[0])).toContain(
        `Blue picks from ${regionWord(lock.lock_region_blue ?? '')}, Red from ${regionWord(lock.lock_region_red ?? '')}.`,
      );

      const gameId = await night.startGame(partyId);
      const body = await night.eogFor(lobbyId, partyId, gameId, [103, 157, 39, 43, 98, 22, 113, 201, 1, 266]);
      body.durationS = 200;
      expect(await night.postEog(body)).toMatchObject({ created: true, rated: false });
      const after = await night.cardRow();
      expect(after).toMatchObject(regionRow(lock.lock_region_blue ?? '', lock.lock_region_red ?? ''));
      // A second companion's identical block: nothing written.
      expect(await night.postEog(body)).toMatchObject({ created: false });
      expect(await night.cardRow()).toEqual(after);
    });

    it('an ARAM hands back; a dropped lobby hands nothing back and its late block stamps from the lock', async () => {
      await setRow({ pending_rule: 'class', pending_class_tag: 'Mage', rated_override: true });
      const aram = await rolled();
      const aramGame = await night.startGame(aram.partyId);
      const aramBody = await night.eogFor(
        aram.lobbyId,
        aram.partyId,
        aramGame,
        [103, 157, 39, 43, 98, 22, 113, 201, 1, 266],
        {
          raw: { gameMode: 'ARAM' },
        },
      );
      await night.postEog(aramBody);
      expect(await night.cardRow()).toMatchObject({
        pending_rule: 'class',
        pending_class_tag: 'Mage',
        rated_override: true,
      });

      const dropped = await rolled();
      const droppedGame = await night.startGame(dropped.partyId);
      const { error } = await night.db
        .from('lobbies')
        .update({ status: 'dropped' })
        .eq('id', dropped.lobbyId);
      if (error) throw new Error(error.message);
      // Nothing came back: Roll moved Mage onto the lock and the row stays empty.
      expect(await night.lockOf(dropped.lobbyId)).toMatchObject({
        status: 'dropped',
        lock_rule: 'class',
        lock_class_tag: 'Mage',
      });
      expect(await night.cardRow()).toMatchObject({ pending_rule: null, rated_override: null });
      await night.card({ mode: 'class:Tank' });
      const late = await night.eogFor(
        dropped.lobbyId,
        dropped.partyId,
        droppedGame,
        [103, 157, 39, 43, 98, 22, 113, 201, 1, 266],
      );
      await night.postEog(late);
      expect(await night.gameRow(droppedGame)).toMatchObject({
        rule: 'class',
        rule_class_tag: 'Mage',
        rated: true,
      });
      expect(await night.cardRow()).toMatchObject({ pending_rule: 'class', pending_class_tag: 'Tank' });
    });
  });

  describe('(5) a Rift record leaves group_modes byte-identical', () => {
    it('with a choice made after Roll, the whole row (updated_at included) is unchanged by the record', async () => {
      await setRow({ pending_rule: 'mirror' });
      const { partyId, lobbyId } = await rolled();
      await night.card({ rated: false });
      const gameId = await night.startGame(partyId);
      const before = await night.db.from('group_modes').select('*').eq('group_id', night.group.id).single();
      await night.postEog(
        await night.eogFor(lobbyId, partyId, gameId, [103, 157, 39, 43, 98, 22, 113, 201, 1, 266]),
      );
      const after = await night.db.from('group_modes').select('*').eq('group_id', night.group.id).single();
      expect(after.data).toEqual(before.data);
    });
  });

  describe("region actions on this game ('this')", () => {
    it('change only the lock while balanced; refused once the game has started, with no lock, or for a pair that is short', async () => {
      await setRow(regionRow('zaun', 'noxus'));
      const { partyId, lobbyId } = await rolled();
      const membersBefore = await night.db
        .from('lobby_members')
        .select('*')
        .eq('lobby_id', lobbyId)
        .order('player_id');
      const splitsBefore = await night.db
        .from('splits')
        .select('id, is_chosen, blue, red')
        .eq('lobby_id', lobbyId)
        .order('id');
      await night.card({ side: 'red', region: 'ionia', game: 'this' });
      expect(await night.lockOf(lobbyId)).toMatchObject({
        lock_region_blue: 'zaun',
        lock_region_red: 'ionia',
        lock_rated: null,
      });
      expect(
        (await night.db.from('lobby_members').select('*').eq('lobby_id', lobbyId).order('player_id')).data,
      ).toEqual(membersBefore.data);
      expect(
        (await night.db.from('splits').select('id, is_chosen, blue, red').eq('lobby_id', lobbyId).order('id'))
          .data,
      ).toEqual(splitsBefore.data);
      // The next game's row was emptied by Roll and is untouched by a `this` change.
      expect(await night.cardRow()).toMatchObject({ pending_rule: null });
      expect((await night.cardAnswer({ side: 'red', region: 'zaun', game: 'this' })).json).toEqual({
        ok: false,
        error: 'Pick two different regions.',
      });

      await night.startGame(partyId);
      expect((await night.cardAnswer({ redraw: true, game: 'this' })).json).toEqual({
        ok: false,
        error: 'The game has started, so the regions stay.',
      });
      expect(await night.lockOf(lobbyId)).toMatchObject({
        lock_region_blue: 'zaun',
        lock_region_red: 'ionia',
      });
      await abandon(lobbyId);
      expect((await night.cardAnswer({ redraw: true, game: 'this' })).status).toBe(409);
    });

    it('racing the game start: applied before in_game or refused, never applied to a game in progress', async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await setRow(regionRow('zaun', 'noxus'));
        const { partyId, lobbyId } = await rolled();
        const [, answer] = await Promise.all([
          night.startGame(partyId),
          (async () => {
            await sleep(round * 5);
            return night.cardAnswer({ side: 'blue', region: 'ionia', game: 'this' });
          })(),
        ]);
        const lock = await night.lockOf(lobbyId);
        if (answer.status === 200) expect(lock.lock_region_blue).toBe('ionia');
        else {
          expect(answer.json).toEqual({ ok: false, error: 'The game has started, so the regions stay.' });
          expect(lock.lock_region_blue).toBe('zaun');
        }
        await abandon(lobbyId);
      }
    });
  });

  describe('(9) a pair the bans made short by Roll', () => {
    it('Roll draws a fresh passing pair under the bans and its answer says so', async () => {
      // A rated Fearless game bans Kha'Zix and Cho'Gath: the Void drops from 9 to 7 open.
      await setRow({ mode: 'fearless' });
      await night.playGame([121, 31, 86, 122, 222, 412, 99, 238, 67, 81]);
      const pool = await night.poolIds();
      expect(regionOpenCounts(championTable(), pool).get('void')).toBeLessThan(8);
      // The Void vs Zaun was chosen before those bans landed.
      await setRow(regionRow('void', 'zaun', { mode: 'fearless' }));
      const { lobbyId } = await night.openLobby();
      const answer = await night.roll(lobbyId, sequenceRng([0.5, 0.5]));
      const lock = await night.lockOf(lobbyId);
      expect(lock.lock_rule).toBe('region');
      expect([lock.lock_region_blue, lock.lock_region_red]).not.toContain('void');
      expect(
        pairDrawable(lock.lock_region_blue ?? '', lock.lock_region_red ?? '', championTable(), pool),
      ).toBe(true);
      expect(answer.modeNotice).toMatch(
        /^The Void vs Zaun ran short after the bans, so Roll drew .+ vs .+\.$/,
      );
      expect(await night.cardRow()).toMatchObject({ pending_rule: null, pending_region_blue: null });
      await abandon(lobbyId);
      await setRow();
    });
  });
}
