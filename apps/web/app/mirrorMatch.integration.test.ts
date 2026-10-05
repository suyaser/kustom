import type { Role } from '@customs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPickType } from '@/lib/lobbyStart';
import { MIRROR_HOST_FILLING_REST, MIRROR_HOST_LEAD } from '@/lib/mode/ruleCopy';
import { resolveLocalStack } from '@/lib/testing/localStack';
import {
  descriptionOf,
  modeNight,
  seededRng,
  sortIds,
  stackWithModes,
  titleOf,
} from '@/lib/testing/modeNight';

/**
 * M15.11, Mirror match end to end, the M15.8 way: a scratch group's fixture night through the real
 * routes on the local stack. Mirror is the first rated rule (R4): it rates like a normal game and
 * feeds the Fearless pool; Start a lobby opens the Blind Pick custom itself (M17.17, was the host's by hand, R10).
 *
 * 1. Standing Fearless and one rated game; Spin, twenty times over, lands on mirror sometimes (M17.17).
 * 2. Mirror picked: rated; `Start the next lobby` stays after a result (no host line) and the
 *    create_lobby it queues asks for blind (`readPickType`). While a lobby fills, the host line
 *    says what to do if it is Draft Pick, and Spin never lands on mirror (QA fix 2026-10-04).
 * 3. Roll locks it; the teams post says `Blind Pick lobby` and `Rated`.
 * 4. Every lane kept: rated, ratings move, exactly its five champions join the pool, and the card
 *    is back on Fearless with `Start the next lobby` back.
 * 5. Mid broken and a seat with no detected position: the poster and the result post flag it, the
 *    game still rates; the lane with no position is `couldn't check`.
 * 6. Played in a Draft lobby (bans in the blob, no lane could match) with two seats on one lane:
 *    checked and rated like any other; the doubled lane and the empty one are `couldn't check`.
 *
 * Skipped without the local stack (or before `0032`).
 */

const stack = await stackWithModes(await resolveLocalStack());

type Lanes = Record<Role, number>;
const lanes = (top: number, jungle: number, mid: number, adc: number, support: number): Lanes => ({
  top,
  jungle,
  mid,
  adc,
  support,
});

const GAME0 = [266, 24, 13, 236, 412, 1, 9, 26, 35, 267];
// Garen, Lee Sin, Ahri, Jinx, Leona on both sides.
const KEPT = lanes(86, 64, 103, 222, 89);
// Darius, Vi, Zed / Syndra, Ezreal, Lulu.
const BROKE_BLUE = lanes(122, 254, 238, 81, 117);
const BROKE_RED = lanes(122, 254, 134, 81, 117);
// A Draft lobby: no champion twice. Maokai, Sejuani, Lux, Ashe, Janna / Shen, Kha'Zix, Twisted Fate, Caitlyn, Braum.
const DRAFT_BLUE = lanes(57, 113, 99, 22, 40);
const DRAFT_RED = lanes(98, 121, 4, 51, 201);

if (stack === null) {
  describe.skip('mirror match end to end against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'mm');
  const { ruleLineOf } = await import('./_mode/RuleLine');

  const host = () => ({ kind: 'linked' as const, puuid: night.ten[0] ?? '', isAdmin: true, isMember: true });

  /** Roll, play and post one mirror game; champions by the split's lanes, roles as detected. */
  async function playMirror(
    blue: Lanes,
    red: Lanes,
    detected?: (seat: { role: Role; side: 'blue' | 'red' }) => Role | null,
    raw?: Record<string, unknown>,
  ) {
    const { partyId, lobbyId } = await night.openLobby();
    await night.roll(lobbyId);
    const lock = await night.lockOf(lobbyId);
    const gameId = await night.startGame(partyId);
    const seats = await night.seatsOf(lobbyId);
    const sided = seats.map((seat, index) => ({
      ...seat,
      side: index < 5 ? ('blue' as const) : ('red' as const),
    }));
    const body = await night.eogFor(
      lobbyId,
      partyId,
      gameId,
      sided.map((seat) => (seat.side === 'blue' ? blue : red)[seat.role]),
      {
        roles: sided.map((seat) => (detected === undefined ? seat.role : detected(seat))),
        ...(raw === undefined ? {} : { raw }),
      },
    );
    const answer = await night.postEog(body);
    return { answer, game: await night.gameRow(gameId), lock, lobbyId };
  }

  async function posterLine() {
    const snapshot = await night.snapshot();
    const stamp = snapshot.lobby?.status === 'finished' ? (snapshot.lobby.result?.stamp ?? null) : null;
    return ruleLineOf(stamp);
  }

  const resultPost = () => night.posts.find((post) => /wins/.test(titleOf(post)));

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe('mirror match, one fixture night', () => {
    it('1. standing Fearless, a rated game, and Spin lands on mirror sometimes (M17.17)', async () => {
      await night.card({ mode: 'normal' });
      await night.card({ mode: 'fearless' });
      const { answer } = await night.playGame(GAME0);
      expect(answer).toMatchObject({ created: true, rated: true });
      const spun = new Set<unknown>();
      for (let seed = 1; seed <= 20; seed += 1) {
        const { status, json } = await night.spin(seededRng(seed));
        expect(status).toBe(200);
        spun.add(json.spun);
      }
      expect(spun.has('mirror')).toBe(true);
      night.clearPosts();
    });

    it('2. picked: rated; Start a lobby stays and asks for Blind Pick; filling: the host line, and Spin never mirror', async () => {
      const answer = await night.card({ mode: 'mirror' });
      expect(answer).toMatchObject({
        state: { standing: 'fearless', pending: { id: 'mirror' }, nextRated: true },
      });
      expect(await readPickType(night.db, night.group.id)).toBe('blind');

      const afterResult = await night.tonightPaint(host());
      expect(afterResult).toContain('Mirror match');
      expect(afterResult).toContain('Start the next lobby');
      expect(afterResult).not.toContain('Mirror match next.');
      expect(afterResult).not.toContain('Blind Pick custom in League yourself');

      // Filling: six in the lobby.
      const party = `${night.group.slug}-filling`;
      const lobbyId = await night.companionLobby(party, night.ten.slice(0, 6));
      const filling = await night.tonightPaint(host());
      // QA fix 2026-10-04: this lobby already exists and may be Draft Pick, so the host line is back.
      expect(filling).toContain(MIRROR_HOST_LEAD);
      expect(filling).toContain(MIRROR_HOST_FILLING_REST);

      // While a lobby is open, Spin never hands it mirror, twenty times over.
      for (let seed = 1; seed <= 20; seed += 1) {
        const { status, json } = await night.spin(seededRng(seed));
        expect(status).toBe(200);
        expect(json.spun).not.toBe('mirror');
      }
      await night.card({ mode: 'mirror' });
      // Close that half lobby out of the way: everybody leaves.
      const { error } = await night.db.from('lobbies').update({ status: 'abandoned' }).eq('id', lobbyId);
      if (error) throw new Error(error.message);
    });

    it('3. Roll locks it, rated; the teams post says Blind Pick lobby; 4. every lane kept rates and feeds the pool', async () => {
      const ratingsBefore = await night.ratingsOfTen();
      const poolBefore = await night.poolIds();

      const { answer, game, lock } = await playMirror(KEPT, KEPT);
      // M20.7: Rated is moved as it was (null = mirror's default, rated).
      expect(lock).toMatchObject({ lock_mode: 'fearless', lock_rule: 'mirror', lock_rated: null });
      expect(descriptionOf(night.posts[0])).toContain(
        `This game: mirror match, same champion as your lane opponent. Blind Pick lobby. Rated. How it works: https://kustom.test/g/${night.group.slug}/mode`,
      );

      expect(answer).toMatchObject({ created: true, rated: true });
      expect(game).toMatchObject({ mode: 'fearless', rule: 'mirror', rated: true, rule_checked: true });
      const after = await night.ratingsOfTen();
      expect(after.map((row) => row.games)).toEqual(ratingsBefore.map((row) => row.games + 1));
      expect(after.some((row, index) => row.mu !== ratingsBefore[index]?.mu)).toBe(true);
      expect(await night.poolIds()).toEqual(sortIds([...poolBefore, ...Object.values(KEPT)]));

      const line = 'Mirror match: kept in every lane.';
      expect(await posterLine()).toBe(line);
      const result = descriptionOf(resultPost());
      expect(result).toContain(line);
      expect(result).not.toContain('Not rated');
      // A rated game: the Fearless pool post follows the result.
      expect(night.posts.some((post) => /fearless/i.test(titleOf(post)))).toBe(true);

      // Back on Fearless, `Start the next lobby` back in the host's strip.
      expect(await night.cardRow()).toMatchObject({ mode: 'fearless', pending_rule: null });
      const page = await night.tonightPaint(host());
      expect(page).toContain('Start the next lobby');
      expect(await readPickType(night.db, night.group.id)).toBe('draft');
      night.clearPosts();
    });

    it('5. a broken lane flags the poster and the post and still rates; no position is couldn’t check', async () => {
      await night.card({ mode: 'mirror' });
      const ratingsBefore = await night.ratingsOfTen();
      const { answer, game } = await playMirror(BROKE_BLUE, BROKE_RED, (seat) =>
        seat.side === 'blue' && seat.role === 'top' ? null : seat.role,
      );
      expect(answer).toMatchObject({ created: true, rated: true });
      expect(game).toMatchObject({ rule: 'mirror', rated: true, rule_checked: true });
      expect(game.rule_check).toMatchObject({ kind: 'lanes' });
      const byLane = Object.fromEntries(
        ((game.rule_check as { lanes: { lane: string; verdict: string }[] }).lanes ?? []).map((lane) => [
          lane.lane,
          lane.verdict,
        ]),
      );
      expect(byLane).toEqual({ top: 'unknown', jungle: 'kept', mid: 'broke', adc: 'kept', support: 'kept' });
      expect((await night.ratingsOfTen()).map((row) => row.games)).toEqual(
        ratingsBefore.map((row) => row.games + 1),
      );

      const line = "Mirror match: kept in 3 lanes. Top: couldn't check. Mid: Zed vs Syndra.";
      expect(await posterLine()).toBe(line);
      expect(descriptionOf(resultPost())).toContain(line);
      night.clearPosts();
    });

    it('6. a Draft lobby with two seats on one lane is checked and rated like any other', async () => {
      await night.card({ mode: 'mirror' });
      const poolBefore = await night.poolIds();
      const draftBlob = {
        teams: [
          { teamId: 100, bans: [{ championId: 7, pickTurn: 1 }] },
          { teamId: 200, bans: [{ championId: 10, pickTurn: 2 }] },
        ],
      };
      // Blue's top laner is detected mid: blue has no top and two mids.
      const { answer, game } = await playMirror(
        DRAFT_BLUE,
        DRAFT_RED,
        (seat) => (seat.side === 'blue' && seat.role === 'top' ? 'mid' : seat.role),
        draftBlob,
      );
      expect(answer).toMatchObject({ created: true, rated: true });
      expect(game).toMatchObject({ rule: 'mirror', rated: true, rule_checked: true });
      const byLane = Object.fromEntries(
        ((game.rule_check as { lanes: { lane: string; verdict: string }[] }).lanes ?? []).map((lane) => [
          lane.lane,
          lane.verdict,
        ]),
      );
      expect(byLane).toEqual({
        top: 'unknown',
        jungle: 'broke',
        mid: 'unknown',
        adc: 'broke',
        support: 'broke',
      });
      // Rated, so its ten champions join the pool like any rated game's.
      expect(await night.poolIds()).toEqual(
        sortIds([...poolBefore, ...Object.values(DRAFT_BLUE), ...Object.values(DRAFT_RED)]),
      );
      const line = await posterLine();
      expect(line).toMatch(/^Mirror match: kept in no lane\./);
      expect(line).toContain("Top: couldn't check.");
      expect(line).toContain("Mid: couldn't check.");
      expect(descriptionOf(resultPost())).toContain(line ?? '');
      for (const who of [...night.names, ...night.ten]) expect(line).not.toContain(who);
    });
  });
}
