import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { descriptionOf, modeNight, plain, sequenceRng, stackWithModes } from '@/lib/testing/modeNight';

/**
 * M20.10: region wars' pair on the Mode card, through the real route and the real Tonight read
 * (M20 D9). A scratch group on a Normal night (every pair passes M20 D2 with no bans, M20.3):
 *
 * 1. Region wars chosen with no lobby at all: the admin's card carries `Redraw regions` and both
 *    side selects on the row's pair; a signed-out visitor sees the pair and no control.
 * 2. Redraw, next game: the route's notice, a different unordered pair on the row, and the card's
 *    selects on it.
 * 3. Set a side, next game: the other side kept, the card on it.
 * 4. Ten join and Roll: this game's controls (headed `This game`), no next-game pair.
 * 5. Redraw, this game: the lock changes, the row does not, the teams post goes again with
 *    `new regions`, the card's selects on the new lock.
 * 6. Set a side, this game: the other side kept.
 * 7. The game starts: no control on the card, and the route refuses `this` with M20.1's words.
 *
 * The admin controls are code-split (`ModeControlsLazy`); here the module is the controls
 * themselves, so the static render carries them. Skipped without the local stack (or before 0047).
 */

vi.mock('@/app/_mode/ModeControlsLazy', async () => ({
  ModeControlsLazy: (await import('@/app/_mode/ModeControls')).ModeControls,
}));

const stack = await stackWithModes(await resolveLocalStack());

const REGIONS = [
  'bandle-city',
  'bilgewater',
  'demacia',
  'freljord',
  'ionia',
  'ixtal',
  'mount-targon',
  'noxus',
  'piltover',
  'shadow-isles',
  'shurima',
  'void',
  'zaun',
] as const;

if (stack === null) {
  describe.skip('region wars controls on the card against the local Supabase stack', () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'rc');
  const { TonightView } = await import('./_tonight/TonightView');
  const { ADMIN_VIEWER } = await import('./_tonight/fixtures');
  const { REGIONS_STAY } = await import('@/lib/mode/ruleNotices');

  const shared = { partyId: '', lobbyId: '', pair: { blue: '', red: '' } };

  async function paint(admin: boolean): Promise<string> {
    return renderToStaticMarkup(
      createElement(TonightView, {
        snapshot: await night.snapshot(),
        viewer: admin ? ADMIN_VIEWER : { kind: 'anonymous' },
        group: night.group,
        topPlayers: [],
      }),
    );
  }

  /** The `Blue's region` and `Red's region` values inside one pair's controls, in that order. */
  function selected(html: string, game: 'next' | 'this'): string[] {
    const start = html.indexOf(`data-slot="region-controls-${game}"`);
    if (start < 0) return [];
    const block = html.slice(start, html.indexOf('Redraw regions', start));
    return [...block.matchAll(/<option value="([a-z-]+)" selected="">/g)].map((match) => match[1] ?? '');
  }

  const other = (...not: string[]) => REGIONS.find((region) => !not.includes(region)) ?? 'zaun';
  const sameUnordered = (a: { blue: string; red: string }, b: { blue: string; red: string }) =>
    (a.blue === b.blue && a.red === b.red) || (a.blue === b.red && a.red === b.blue);

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe('region wars controls on the card', () => {
    it('1. chosen with no lobby: the admin gets the controls on the pair, a visitor the pair only', async () => {
      await night.card({ mode: 'normal' });
      const answer = await night.card({ mode: 'region' }, sequenceRng([0.3, 0.6]));
      const pending = (answer.state as { pending: { blue: string; red: string } }).pending;
      shared.pair = { blue: pending.blue, red: pending.red };
      const admin = await paint(true);
      expect(admin).toContain('Redraw regions');
      expect(plain(admin)).toContain("Blue's region");
      expect(plain(admin)).toContain("Red's region");
      expect(selected(admin, 'next')).toEqual([shared.pair.blue, shared.pair.red]);
      expect(admin).not.toContain('region-controls-this');
      const visitor = await paint(false);
      expect(visitor).not.toContain('Redraw regions');
      expect(plain(visitor)).not.toContain("Blue's region");
      expect(visitor).not.toContain('region-controls-');
    });

    it('2. Redraw, next game: a different pair on the row, the notice, the card on it', async () => {
      const answer = await night.card({ redraw: true, game: 'next' });
      const row = await night.cardRow();
      const pair = { blue: row.pending_region_blue ?? '', red: row.pending_region_red ?? '' };
      expect(sameUnordered(pair, shared.pair)).toBe(false);
      expect(answer.notice).toMatch(/^Next game: .+ vs .+\.$/);
      expect(selected(await paint(true), 'next')).toEqual([pair.blue, pair.red]);
      shared.pair = pair;
    });

    it('3. Set a side, next game: the other side kept, the card on it', async () => {
      const red = other(shared.pair.blue, shared.pair.red);
      const answer = await night.card({ side: 'red', region: red, game: 'next' });
      expect(answer).toMatchObject({ state: { pending: { id: 'region', blue: shared.pair.blue, red } } });
      expect(await night.cardRow()).toMatchObject({
        pending_region_blue: shared.pair.blue,
        pending_region_red: red,
      });
      expect(selected(await paint(true), 'next')).toEqual([shared.pair.blue, red]);
      shared.pair = { blue: shared.pair.blue, red };
    });

    it('4. Roll: this game controls on the lock, no next-game pair', async () => {
      const lobby = await night.openLobby();
      shared.partyId = lobby.partyId;
      shared.lobbyId = lobby.lobbyId;
      await night.roll(lobby.lobbyId);
      expect(await night.lockOf(lobby.lobbyId)).toMatchObject({
        status: 'balanced',
        lock_rule: 'region',
        lock_region_blue: shared.pair.blue,
        lock_region_red: shared.pair.red,
      });
      const admin = await paint(true);
      expect(selected(admin, 'this')).toEqual([shared.pair.blue, shared.pair.red]);
      expect(admin).not.toContain('region-controls-next');
      expect(plain(admin)).toContain('This game');
      night.clearPosts();
    });

    it('5. Redraw, this game: the lock changes, the row does not, the teams post goes again', async () => {
      const rowBefore = await night.cardRow();
      const answer = await night.card({ redraw: true, game: 'this' });
      expect(answer.notice).toMatch(
        /^New regions: .+ vs .+\. Picks already made stay, and the check uses the new regions\.$/,
      );
      const lock = await night.lockOf(shared.lobbyId);
      const pair = { blue: lock.lock_region_blue ?? '', red: lock.lock_region_red ?? '' };
      expect(lock.status).toBe('balanced');
      expect(sameUnordered(pair, shared.pair)).toBe(false);
      const rowAfter = await night.cardRow();
      expect({ ...rowAfter, updated_at: null }).toEqual({ ...rowBefore, updated_at: null });
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).toContain('This game: region wars, new regions.');
      expect(selected(await paint(true), 'this')).toEqual([pair.blue, pair.red]);
      shared.pair = pair;
      night.clearPosts();
    });

    it('6. Set a side, this game: the other side kept', async () => {
      const blue = other(shared.pair.blue, shared.pair.red);
      const answer = await night.card({ side: 'blue', region: blue, game: 'this' });
      expect(answer.notice).toMatch(/^New regions: /);
      expect(await night.lockOf(shared.lobbyId)).toMatchObject({
        lock_region_blue: blue,
        lock_region_red: shared.pair.red,
      });
      expect(selected(await paint(true), 'this')).toEqual([blue, shared.pair.red]);
      night.clearPosts();
    });

    it('7. the game starts: no control on the card, and this game is refused', async () => {
      await night.startGame(shared.partyId);
      expect((await night.lockOf(shared.lobbyId)).status).toBe('in_game');
      const admin = await paint(true);
      expect(admin).not.toContain('Redraw regions');
      expect(admin).not.toContain('region-controls-');
      const refused = await night.cardAnswer({ redraw: true, game: 'this' });
      expect(refused).toEqual({ status: 409, json: { ok: false, error: REGIONS_STAY } });
    });
  });
}
