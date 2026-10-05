import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { descriptionOf, modeNight, seededRng, sequenceRng, stackWithModes } from '@/lib/testing/modeNight';

/**
 * M20.18 against the local stack, through the real routes: until the game starts, mode changes
 * are for this game (the owner, 2026-10-05). One scratch group, one lobby, in order:
 *
 * 1. Before Roll there is no this game: `game: 'this'` is a 409 and nothing moves.
 * 2. While the lobby is `balanced`, a pick, Rated, a standing pick, Spin and region wars with
 *    `game: 'this'` each change only the lobby's lock: the row (`group_modes`) is byte-identical,
 *    the teams post goes again with the lock's rule line, and `group_live` moves once. A standing
 *    pick also sets the row's `mode` (the night's mode, lead's call), and nothing else on the row.
 * 3. Once `in_game` the lock is frozen: every `this` action is a 409 with M20.18's words, nothing
 *    is posted or bumped, and the same action for the next game changes the row, not the lock.
 * 4. The end-of-game block stamps the game from the changed lock (the M15 rule check included),
 *    and leaves the row's next-game rule pending.
 *
 * Skipped without the local stack (or before 0047).
 */

const stack = await stackWithModes(await resolveLocalStack());

if (stack === null) {
  describe.skip('mode changes for this game against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'tg');
  const { NO_THIS_GAME, THIS_GAME_STAYS } = await import('@/lib/mode/ruleNotices');

  const shared = { partyId: '', lobbyId: '' };

  async function fullRow() {
    const { data, error } = await night.db
      .from('group_modes')
      .select('*')
      .eq('group_id', night.group.id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function liveVersion(): Promise<{ version: number; kind: string } | null> {
    const { data, error } = await night.db
      .from('group_live')
      .select('version, kind')
      .eq('group_id', night.group.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * One `this` action that must land: only the lock moves, the row stays byte-identical, the teams
   * post goes once, and `group_live` moves once with kind `mode`. Returns the answer and the post.
   */
  async function onThisGame(
    body: Record<string, unknown>,
    rng?: Parameters<typeof night.card>[1],
    /** A standing pick: the row's `mode` becomes this, and nothing else on the row moves. */
    rowMode?: string,
  ) {
    const rowBefore = await fullRow();
    const liveBefore = (await liveVersion())?.version ?? 0;
    night.clearPosts();
    const answer = await night.card({ ...body, game: 'this' }, rng);
    const rowAfter = await fullRow();
    if (rowMode === undefined) expect(rowAfter).toEqual(rowBefore);
    else {
      const { mode, set_by, updated_at, ...rest } = rowAfter;
      const { mode: _mode, set_by: _setBy, updated_at: _updatedAt, ...restBefore } = rowBefore;
      expect(mode).toBe(rowMode);
      expect(set_by).toBe(night.idOf.get(night.ten[0] ?? ''));
      expect(updated_at > rowBefore.updated_at).toBe(true);
      expect(rest).toEqual(restBefore);
    }
    expect(await liveVersion()).toEqual({ version: liveBefore + 1, kind: 'mode' });
    expect(night.posts).toHaveLength(1);
    const lock = await night.lockOf(shared.lobbyId);
    expect(lock.status).toBe('balanced');
    expect(answer).toMatchObject({ ok: true, changed: true, thisGame: { lobbyId: shared.lobbyId } });
    return { answer, lock, post: descriptionOf(night.posts[0]) };
  }

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe('mode changes for this game (M20.18)', () => {
    it('1. before Roll there is no this game: a 409, nothing written', async () => {
      await night.card({ mode: 'normal' });
      const rowBefore = await fullRow();
      for (const body of [{ mode: 'class:Tank' }, { rated: false }, { spin: true }]) {
        const refused = await night.cardAnswer({ ...body, game: 'this' });
        expect(refused).toEqual({ status: 409, json: { ok: false, error: NO_THIS_GAME } });
      }
      expect(await fullRow()).toEqual(rowBefore);
    });

    it('2a. pick while balanced: the lock takes the rule, the row is untouched, the teams post goes again', async () => {
      const lobby = await night.openLobby();
      shared.partyId = lobby.partyId;
      shared.lobbyId = lobby.lobbyId;
      await night.roll(lobby.lobbyId);
      expect(await night.lockOf(lobby.lobbyId)).toMatchObject({ lock_mode: 'normal', lock_rule: null });

      const { answer, lock, post } = await onThisGame({ mode: 'class:Tank' });
      expect(lock).toMatchObject({
        lock_mode: 'normal',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: null,
      });
      expect(answer).toMatchObject({
        notice: 'This game: Class wars, tanks only. Not rated.',
        state: { standing: 'normal', pending: null, rated: null },
        thisGame: {
          standing: 'normal',
          mode: { id: 'class', tag: 'Tank' },
          rated: null,
          effectiveRated: false,
        },
      });
      expect(post).toContain('This game: tanks only.');
      expect(post).toContain('Not rated.');
    });

    it('2b. Rated while balanced: only the lock switch moves', async () => {
      const { answer, lock, post } = await onThisGame({ rated: true });
      expect(lock).toMatchObject({ lock_rule: 'class', lock_class_tag: 'Tank', lock_rated: true });
      expect(answer).toMatchObject({ notice: 'This game is rated.', thisGame: { effectiveRated: true } });
      expect(post).toContain('This game: tanks only.');
      expect(post).toContain('Rated.');
      expect(post).not.toContain('Not rated.');
    });

    it("2c. a standing pick while balanced: this game is Fearless with no rule, and so is the night's mode", async () => {
      // A next-game rule and Rated on the row (put there by hand): the standing pick leaves both.
      const queued = await night.db
        .from('group_modes')
        .update({ pending_rule: 'mirror', rated_override: false })
        .eq('group_id', night.group.id);
      if (queued.error) throw new Error(queued.error.message);
      const { answer, lock } = await onThisGame({ mode: 'fearless' }, undefined, 'fearless');
      expect(await night.cardRow()).toMatchObject({
        mode: 'fearless',
        pending_rule: 'mirror',
        rated_override: false,
      });
      expect(answer).toMatchObject({
        state: { standing: 'fearless', pending: { id: 'mirror' }, rated: false },
      });
      const cleared = await night.db
        .from('group_modes')
        .update({ pending_rule: null, rated_override: null })
        .eq('group_id', night.group.id);
      if (cleared.error) throw new Error(cleared.error.message);
      expect(lock).toMatchObject({
        lock_mode: 'fearless',
        lock_rule: null,
        lock_class_tag: null,
        lock_rated: null,
      });
      expect(answer).toMatchObject({ notice: 'Rule cleared. This game is Fearless.' });
    });

    it('2d. Spin while balanced: a rule for this game, never mirror (the lobby is already made)', async () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const { answer, lock } = await onThisGame({ spin: true }, seededRng(seed));
        expect(['class', 'region']).toContain(lock.lock_rule);
        expect(lock.lock_mode).toBe('fearless');
        expect(answer.notice).toMatch(/^Spin says: /);
        expect(answer).toHaveProperty('spun');
      }
    });

    it('2e. region wars while balanced: the pair drawn now, the plain region line (no "new regions")', async () => {
      await onThisGame({ mode: 'class:Tank' });
      const { answer, lock, post } = await onThisGame({ mode: 'region' }, sequenceRng([0.2, 0.7]));
      expect(lock.lock_rule).toBe('region');
      expect(lock.lock_region_blue).not.toBeNull();
      expect(lock.lock_region_red).not.toBeNull();
      expect(lock.lock_region_blue).not.toBe(lock.lock_region_red);
      expect(answer.notice).toMatch(/^This game: Region wars\. Blue: .+ · Red: .+\. Not rated\.$/);
      expect(post).toContain('This game: region wars.');
      expect(post).not.toContain('new regions');
      // Back to the rule the record below checks, rated.
      await onThisGame({ mode: 'class:Tank' });
      await onThisGame({ rated: true });
    });

    it('3. in game: every this action is a 409 and the lock is frozen; next changes the row', async () => {
      await night.startGame(shared.partyId);
      const lockBefore = await night.lockOf(shared.lobbyId);
      expect(lockBefore).toMatchObject({
        status: 'in_game',
        lock_mode: 'fearless',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: true,
      });
      const rowBefore = await fullRow();
      const liveBefore = await liveVersion();
      night.clearPosts();
      for (const body of [{ mode: 'mirror' }, { mode: 'normal' }, { rated: false }, { spin: true }]) {
        const refused = await night.cardAnswer({ ...body, game: 'this' });
        expect(refused).toEqual({ status: 409, json: { ok: false, error: THIS_GAME_STAYS } });
      }
      expect(await night.lockOf(shared.lobbyId)).toEqual(lockBefore);
      expect(await fullRow()).toEqual(rowBefore);
      expect(await liveVersion()).toEqual(liveBefore);
      expect(night.posts).toHaveLength(0);

      const next = await night.card({ mode: 'mirror', game: 'next' });
      expect(next).toMatchObject({
        notice: 'Next game: Mirror match. Rated.',
        state: { pending: { id: 'mirror' } },
      });
      expect(next).not.toHaveProperty('thisGame');
      expect(await night.cardRow()).toMatchObject({ pending_rule: 'mirror' });
      expect(await night.lockOf(shared.lobbyId)).toEqual(lockBefore);
    });

    it('4. the record stamps the changed lock and leaves the next game pending', async () => {
      const gameId = night.gameIds[night.gameIds.length - 1] ?? 0;
      const body = await night.eogFor(
        shared.lobbyId,
        shared.partyId,
        gameId,
        [113, 111, 102, 106, 54, 3, 12, 14, 32, 57],
      );
      await night.postEog(body);
      expect(await night.gameRow(gameId)).toMatchObject({
        mode: 'fearless',
        rule: 'class',
        rule_class_tag: 'Tank',
        rule_region_blue: null,
        rule_region_red: null,
        rated: true,
        rule_checked: true,
      });
      expect((await night.gameRow(gameId)).rule_check).not.toBeNull();
      expect(await night.cardRow()).toMatchObject({ pending_rule: 'mirror' });
    });
  });
}
