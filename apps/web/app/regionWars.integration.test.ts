import { drawableRegions, drawRegions, regionOpenCounts } from '@customs/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGION_CREDIT } from '@/lib/champs/regions';
import { resolveLocalStack } from '@/lib/testing/localStack';
import {
  descriptionOf,
  modeNight,
  plain,
  sequenceRng,
  sortIds,
  stackWithModes,
  titleOf,
} from '@/lib/testing/modeNight';

/**
 * M15.10, Region wars end to end, the M15.8 way: a scratch group's fixture night through the real
 * routes (the card, Roll, Reroll, the companion's lobby and game posts) on the local stack. M20.7:
 * the regions are drawn when region wars is chosen (M20 D9), Roll moves them onto the lock, teams
 * coming down hand them back.
 *
 * 1. Standing Fearless; a rated Fearless game bans Kha'Zix and Cho'Gath (the Void, 9 to 7 open),
 *    under the 8 a region needs. Ezreal takes Piltover from 10 to 9 (Singed and Mel count for it by
 *    their Kustom home, M20.3), so Piltover stays drawable.
 * 2. Region wars picked: drawn on the server at the pick, with a pinned RNG that would land on the
 *    Void if the bans were not counted: Shurima vs Bilgewater, in the same write. (The card's
 *    before-Roll copy is still the pre-M20.8 one; M20.8 shows the pair.)
 * 3. Roll locks that pair and empties the row. The teams post names both.
 * 4. Reroll keeps the lock, and its post names the same two.
 * 5. Teams come down (somebody leaves): the lock goes back to the row, pair included; an admin sets
 *    Blue to Ionia and Red to Freljord (set side, next game); back to ten, Roll locks them.
 * 6. The card and the panel show both pools, the seated viewer's side first, and the credit.
 * 7. The game: Blue all Ionia, Red three Freljord, Annie (Noxus by home: broke) and a champion
 *    newer than the pin (no row: couldn't check, named as the client named it). Not rated: no pool,
 *    no rating, no role moves.
 * 8. The result post and the poster carry the check line; the card is back on Fearless.
 * 9. A pending pair the bans made short with no pair left to draw (M20 D6 (d), D11): Roll locks the
 *    standing mode with Rated as moved, the rule and its pair stay pending, the teams post says so.
 *
 * Skipped without the local stack (or before `0047`).
 */

const stack = await stackWithModes(await resolveLocalStack());

// Game 0, rated Fearless: Kha'Zix and Cho'Gath take the Void to 7, Ezreal takes Piltover to 9.
const GAME0 = [121, 31, 86, 122, 222, 412, 99, 238, 67, 81];
/**
 * The first draw: 0.85 is the Void's slot of the 13 drawable regions with no bans, and Shurima's
 * of the 12 left once game 0's bans take the Void under eight; 0.1 is then Bilgewater, second of
 * either region's partners (M20.3: every pair passes M20 D2 here).
 */
const FIRST_DRAW = [0.85, 0.1];
/** Blue: Ahri, Yasuo, Irelia, Karma, Shen (Ionia). Red: Ashe, Sejuani, Braum (Freljord), Annie, a new champion. */
const NEW_CHAMPION = 9_901;
const RULE_GAME = [103, 157, 39, 43, 98, 22, 113, 201, 1, NEW_CHAMPION];

if (stack === null) {
  describe.skip('region wars end to end against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'rw');
  const { ModePanelBody } = await import('./_mode/ModePanelBody');
  const { ruleLineOf } = await import('./_mode/RuleLine');
  const { loadModePanelView } = await import('@/lib/mode/panelView');
  const { championTable, regionIds } = await import('@/lib/mode/champions');
  const { viewerSeat } = await import('@/lib/tonight/screen');
  const { listCapturedGames } = await import('@/lib/admin/games');
  const { ratedLabel } = await import('@/lib/admin/sectionCopy');
  const { eogBody, testGameId } = await import('@/lib/testing/fixtures');

  const shared = {
    lobby: { partyId: '', lobbyId: '' },
    gameId: 0,
    poolBefore: [] as number[],
    ratingsBefore: [] as unknown[],
    rolesBefore: [] as unknown[],
  };

  async function panelHtml(viewerSide: 'blue' | 'red' | null) {
    const panel = await loadModePanelView(night.anon, night.group.id, night.nightStart());
    const html = renderToStaticMarkup(
      createElement(ModePanelBody, {
        mode: panel.mode,
        fearless: panel.fearless,
        view: panel.view,
        lane: 'all',
        viewerLane: null,
        viewerSide,
        isAdmin: false,
        poolSince: null,
        cardHref: `/g/${night.group.slug}#mode`,
        heading: 'h1',
        headingId: 'mode-panel-title',
      }),
    );
    return { panel, html, text: plain(html) };
  }

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe('region wars, one fixture night', () => {
    it('1. standing Fearless, and a rated game takes the Void under eight open', async () => {
      await night.card({ mode: 'normal' });
      await night.card({ mode: 'fearless' });
      const { answer } = await night.playGame(GAME0);
      expect(answer).toMatchObject({ created: true, rated: true });
      expect(await night.poolIds()).toEqual(sortIds(GAME0));
      const open = regionOpenCounts(championTable(), GAME0);
      expect(open.get('void')).toBe(7);
      expect(open.get('piltover')).toBe(9);
      night.clearPosts();
    });

    it('2. picked: the pair is drawn at the pick, counting the Fearless bans, in the same write', async () => {
      // The same RNG with no bans counted would have drawn the Void.
      expect(
        drawRegions(regionIds(), regionOpenCounts(championTable(), []), sequenceRng(FIRST_DRAW)),
      ).toEqual({
        blue: 'void',
        red: 'bilgewater',
      });
      const answer = await night.card({ mode: 'region' }, sequenceRng(FIRST_DRAW));
      expect(answer).toMatchObject({
        state: {
          standing: 'fearless',
          pending: { id: 'region', blue: 'shurima', red: 'bilgewater' },
          rated: null,
          nextRated: false,
        },
        notice: 'Next game: Region wars. Blue: Shurima · Red: Bilgewater. Not rated.',
      });
      // M20.8: the pre-M20.8 client's `mode` and `next` are gone from the answer.
      expect(answer).not.toHaveProperty('next');
      expect(answer).not.toHaveProperty('mode');
      expect(await night.cardRow()).toMatchObject({
        pending_rule: 'region',
        pending_region_blue: 'shurima',
        pending_region_red: 'bilgewater',
      });
      shared.lobby = await night.openLobby();
      // M20.8: the card shows the pair before Roll, for a signed-out visitor, and the panel both pools.
      const page = await night.tonightPaint();
      expect(page).toContain('Region wars');
      expect(page).toContain('Shurima');
      expect(page).toContain('Bilgewater');
      expect(page).not.toContain('drawn when teams are rolled');
      expect(page).toContain('This game only. Then back to Fearless.');
      const { text } = await panelHtml(null);
      expect(text).toContain('Blue picks only from Shurima, Red only from Bilgewater.');
      expect(text).not.toContain('drawn when teams are rolled');
      expect(text).toContain(REGION_CREDIT);
    });

    it('3. Roll locks the pair the card showed and empties the row; the teams post names both regions', async () => {
      await night.roll(shared.lobby.lobbyId);
      expect(await night.lockOf(shared.lobby.lobbyId)).toMatchObject({
        status: 'balanced',
        lock_mode: 'fearless',
        lock_rule: 'region',
        lock_region_blue: 'shurima',
        lock_region_red: 'bilgewater',
        lock_rated: null,
      });
      expect(await night.cardRow()).toMatchObject({
        pending_rule: null,
        pending_region_blue: null,
        pending_region_red: null,
      });
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).toContain(
        `This game: region wars. Blue picks from Shurima, Red from Bilgewater. Not rated. See both pools: https://kustom.test/g/${night.group.slug}/mode`,
      );
      night.clearPosts();
    });

    it('4. Reroll keeps the draw, and its post names the same two', async () => {
      const before = await night.lockOf(shared.lobby.lobbyId);
      await night.reroll(shared.lobby.lobbyId, 2);
      expect(await night.lockOf(shared.lobby.lobbyId)).toEqual(before);
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).toContain('Blue picks from Shurima, Red from Bilgewater.');
      night.clearPosts();
    });

    it('5. teams coming down hand the pair back; an admin sets both sides; the next Roll locks them', async () => {
      const { partyId, lobbyId } = shared.lobby;
      // Somebody leaves: the lobby goes back to filling and the lock goes back to the row.
      expect(await night.companionLobby(partyId, night.ten.slice(0, 9))).toBe(lobbyId);
      expect(await night.lockOf(lobbyId)).toMatchObject({
        status: 'open',
        lock_rule: null,
        lock_region_blue: null,
        lock_region_red: null,
      });
      expect(await night.cardRow()).toMatchObject({
        pending_rule: 'region',
        pending_region_blue: 'shurima',
        pending_region_red: 'bilgewater',
        rated_override: null,
      });
      // Set side, next game (M20 D9): the other side keeps its region.
      expect(await night.card({ side: 'blue', region: 'ionia' })).toMatchObject({
        state: { pending: { id: 'region', blue: 'ionia', red: 'bilgewater' } },
        notice: 'Next game: Ionia vs Bilgewater.',
      });
      expect(await night.card({ side: 'red', region: 'freljord', game: 'next' })).toMatchObject({
        notice: 'Next game: Ionia vs Freljord.',
      });
      expect(await night.companionLobby(partyId)).toBe(lobbyId);
      await night.roll(lobbyId);
      const lock = await night.lockOf(lobbyId);
      expect(lock).toMatchObject({
        lock_rule: 'region',
        lock_region_blue: 'ionia',
        lock_region_red: 'freljord',
      });
      expect(lock.lock_region_blue).not.toBe(lock.lock_region_red);
      expect(descriptionOf(night.posts[0])).toContain('Blue picks from Ionia, Red from Freljord.');
      night.clearPosts();
    });

    it("6. the card and the panel show both pools, the seated viewer's side first, and the credit", async () => {
      const page = await night.tonightPaint();
      expect(page).toContain('Region wars');
      expect(page).toMatch(/BLUE Ionia vs RED Freljord/);

      const snapshot = await night.snapshot();
      const teams = snapshot.lobby?.teams ?? null;
      const redSeat = night.ten.find((puuid) => viewerSeat(teams, puuid)?.side === 'red') ?? null;
      expect(redSeat).not.toBeNull();
      const seat = viewerSeat(teams, redSeat);
      const { panel, html, text } = await panelHtml(seat?.side ?? null);
      expect(panel.view.shown).toEqual({ id: 'region', blue: 'ionia', red: 'freljord' });
      expect(text).toContain('Blue picks only from Ionia, Red only from Freljord.');
      expect(text).toContain(REGION_CREDIT);
      // Both pools, each its own labelled section; the viewer's (red) is the one marked to go first.
      expect(html).toMatch(/<section aria-label="BLUE Ionia" data-side="blue" class="[^"]*"/);
      expect(html).toMatch(/<section aria-label="RED Freljord" data-side="red" data-viewer-side=""/);
      expect(html).not.toMatch(/data-side="blue" data-viewer-side/);
      // Ionia's pool holds Ionia's champions; Freljord's holds Freljord's.
      const ionia = plain(
        html.slice(html.indexOf('aria-label="BLUE Ionia"'), html.indexOf('aria-label="RED Freljord"')),
      );
      const freljord = plain(html.slice(html.indexOf('aria-label="RED Freljord"')));
      expect(ionia).toContain('Ahri');
      expect(ionia).not.toContain('Ashe');
      expect(freljord).toContain('Ashe');
      expect(freljord).not.toContain('Ahri');
    });

    it('7. the game is checked per side, stamped not rated, and moves nothing; a second companion is a no-op', async () => {
      const { partyId, lobbyId } = shared.lobby;
      shared.poolBefore = await night.poolIds();
      shared.ratingsBefore = await night.ratingsOfTen();
      shared.rolesBefore = await night.rolesOfTen();
      shared.gameId = await night.startGame(partyId);
      const seats = await night.seatsOf(lobbyId);
      // The end-of-game block names the new champion the way the client does.
      const body = await night.eogFor(lobbyId, partyId, shared.gameId, RULE_GAME, {
        raw: {
          teams: [
            {
              players: seats.map((seat, index) => ({
                puuid: seat.puuid,
                championId: RULE_GAME[index],
                championName: RULE_GAME[index] === NEW_CHAMPION ? 'Newchamp' : null,
              })),
            },
          ],
        },
      });
      const answer = await night.postEog(body);
      expect(answer).toMatchObject({ created: true, rated: false, reason: 'not-rated' });
      const game = await night.gameRow(shared.gameId);
      expect(game).toMatchObject({
        mode: 'fearless',
        rule: 'region',
        rule_region_blue: 'ionia',
        rule_region_red: 'freljord',
        rated: false,
        rule_checked: true,
      });
      expect(game.rule_check).toMatchObject({
        kind: 'sides',
        blue: { verdict: 'kept', broke: [], unknown: [] },
        red: { verdict: 'broke', broke: [1], unknown: [NEW_CHAMPION] },
      });
      expect(await night.poolIds()).toEqual(shared.poolBefore);
      expect(await night.ratingsOfTen()).toEqual(shared.ratingsBefore);
      expect(await night.rolesOfTen()).toEqual(shared.rolesBefore);

      const posted = night.posts.length;
      expect(await night.postEog(body)).toMatchObject({ created: false });
      expect(night.posts).toHaveLength(posted);
    });

    it('8. the result post and the poster carry the check line; the card is back on Fearless', async () => {
      const line =
        "Ionia vs Freljord: Blue kept the rule. Red: Annie isn't from Freljord. Red: couldn't check Newchamp.";
      expect(night.posts).toHaveLength(1);
      expect(titleOf(night.posts[0])).not.toMatch(/fearless/i);
      const result = descriptionOf(night.posts[0]);
      expect(result).toContain(line);
      expect(result).toContain('Not rated, so no Rating change.');

      const snapshot = await night.snapshot();
      const stamp = snapshot.lobby?.status === 'finished' ? (snapshot.lobby.result?.stamp ?? null) : null;
      const posterLine = ruleLineOf(stamp);
      expect(posterLine).toBe(line);
      const postedLine = result.split('\n').find((row) => row.startsWith('Ionia vs Freljord:'));
      expect(postedLine).toBe(posterLine);
      for (const who of [...night.names, ...night.ten]) expect(posterLine).not.toContain(who);
      const page = await night.tonightPaint();
      expect(page).toContain(line);

      expect(await night.cardRow()).toMatchObject({ mode: 'fearless', pending_rule: null });
      const { panel } = await panelHtml(null);
      expect(panel.view.shown).toEqual({ id: 'fearless' });
    });

    it('9. a pending pair the bans made short, with no pair left: Roll locks the standing mode, the rule stays pending (M20 D6 (d))', async () => {
      // Games with no lobby land (nothing is pending, so they use nothing) and fill the Fearless
      // pool until only Ionia keeps 8 open: every other region is taken down to 7.
      const table = championTable();
      const banned = new Set(await night.poolIds());
      const open = regionOpenCounts(table, [...banned]);
      const toBan: number[] = [];
      for (const [id, facts] of table) {
        // A region set (M20.3): a ban takes one from every region the champion counts for. Never an
        // Ionia champion (Ionia keeps its 8), never an unaffiliated one (the empty set).
        const regions = facts.region ?? [];
        if (regions.length === 0 || regions.includes('ionia') || banned.has(id)) continue;
        if (regions.every((region) => (open.get(region) ?? 0) <= 7)) continue;
        for (const region of regions) open.set(region, (open.get(region) ?? 0) - 1);
        toBan.push(id);
      }
      const padding = [...table]
        .filter(([id, facts]) => facts.region?.length === 0 && !banned.has(id))
        .map(([id]) => id);
      while (toBan.length % 10 !== 0) toBan.push(padding.shift() ?? 0);
      for (let start = 0; start < toBan.length; start += 10) {
        const gameId = testGameId() + start;
        night.gameIds.push(gameId);
        const body = eogBody({
          gameId,
          puuids: night.ten,
          partyId: null,
          startedAt: new Date().toISOString(),
        });
        (body.participants as Record<string, unknown>[]).forEach((participant, index) => {
          participant.championId = toBan[start + index];
        });
        expect(await night.postEog(body)).toMatchObject({ created: true, rated: true });
      }
      const pool = await night.poolIds();
      expect(drawableRegions(regionOpenCounts(table, pool))).toEqual(['ionia']);
      // Region wars chosen before those bans landed: its pair (Ionia vs Zaun) is short now. Written
      // straight to the row, as the pick would have written it then.
      const chosen = await night.db
        .from('group_modes')
        .update({ pending_rule: 'region', pending_region_blue: 'ionia', pending_region_red: 'zaun' })
        .eq('group_id', night.group.id);
      expect(chosen.error).toBeNull();
      night.clearPosts();

      // Roll: no pair passes. The lock is the standing mode with Rated as moved (none: the standing
      // default, rated); the rule and its stale pair stay pending; the teams post says so.
      const { partyId, lobbyId } = await night.openLobby();
      await night.roll(lobbyId);
      expect(await night.lockOf(lobbyId)).toMatchObject({
        lock_mode: 'fearless',
        lock_rule: null,
        lock_region_blue: null,
        lock_rated: null,
      });
      expect(await night.cardRow()).toMatchObject({
        pending_rule: 'region',
        pending_region_blue: 'ionia',
        pending_region_red: 'zaun',
      });
      expect(descriptionOf(night.posts[0])).toContain(
        "This game: region wars couldn't be drawn, too few open champions. Rated.",
      );

      // The game: the standing mode, rated as the lock says (M20 D6 (d): no no-draw column).
      const gameId = await night.startGame(partyId);
      const answer = await night.postEog(
        await night.eogFor(lobbyId, partyId, gameId, [103, 157, 39, 43, 98, 22, 113, 201, 1, 266]),
      );
      expect(answer).toMatchObject({ created: true, rated: true });
      const game = await night.gameRow(gameId);
      expect(game).toMatchObject({ mode: 'fearless', rule: null, rated: true, rule_checked: false });
      // A Rift record from a locked lobby writes nothing to the card: region wars is still next.
      expect(await night.cardRow()).toMatchObject({ pending_rule: 'region', pending_region_blue: 'ionia' });

      // Admin Recording reads it like any standing-mode game; the region wars game before it by its rule.
      const rows = await listCapturedGames(night.db, { timeZone: 'Africa/Cairo', groupId: night.group.id });
      const labels = rows.map((candidate) => ratedLabel(candidate.ratedReason));
      expect(labels).not.toContain("No · Region wars couldn't be drawn");
      expect(labels).toContain('No · Region wars');
      await night.card({ mode: 'fearless' });
    });
  });
}
