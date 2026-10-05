import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';
import { descriptionOf, modeNight, plain, stackWithModes } from '@/lib/testing/modeNight';

/**
 * M20.18, the card half, through the real route and the real Tonight read: the admin card's own
 * no-JS forms, posted as a browser posts them (their hidden fields, form-encoded), act on this game
 * while the lobby is balanced. A scratch group on a Normal night:
 *
 * 1. Roll: the card's picker and Rated forms are this game's (`game=this`, under `This game`).
 * 2. The picker's form with `mode=class:Tank`: the lock takes the rule, the row is untouched, the
 *    teams post goes again, the redirect carries the route's notice, and the card re-read shows the
 *    rule on the card and in the select.
 * 3. The Rated form as it stands (the button's own `rated` value): the lock's switch flips, the row
 *    is untouched, the teams post goes again, and the re-read card's switch and chip follow it.
 * 4. The game starts: the forms no longer carry `game` (the next game's), and the same `this` post
 *    is refused with M20.18's words.
 *
 * The admin controls are code-split (`ModeControlsLazy`); here the module is the controls
 * themselves, so the static render carries them. Skipped without the local stack (or before 0047).
 */

vi.mock('@/app/_mode/ModeControlsLazy', async () => ({
  ModeControlsLazy: (await import('@/app/_mode/ModeControls')).ModeControls,
}));

const stack = await stackWithModes(await resolveLocalStack());

if (stack === null) {
  describe.skip("the card's this-game forms against the local Supabase stack", () => {
    it('needs the local stack with 0047 applied: `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const night = await modeNight(stack, 'tc');
  const { TonightView } = await import('./_tonight/TonightView');
  const { ADMIN_VIEWER } = await import('./_tonight/fixtures');
  const { THIS_GAME_STAYS } = await import('@/lib/mode/ruleNotices');

  const shared = { partyId: '', lobbyId: '' };

  async function paint(): Promise<string> {
    return renderToStaticMarkup(
      createElement(TonightView, {
        snapshot: await night.snapshot(),
        viewer: ADMIN_VIEWER,
        group: night.group,
        topPlayers: [],
      }),
    );
  }

  const decodeHtml = (value: string) =>
    value
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');

  /** The `<form>` around the first `marker`, as the static markup has it. */
  function formAround(html: string, marker: string): string {
    const at = html.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<form', at);
    return html.slice(start, html.indexOf('</form>', at));
  }

  /** A form's hidden fields, as a browser would send them. */
  function hiddenFields(form: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const match of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
      fields[match[1] ?? ''] = decodeHtml(match[2] ?? '');
    }
    return fields;
  }

  const pickerForm = (html: string) => formAround(html, 'aria-label="Mode settings"');
  const ratedForm = (html: string) => formAround(html, 'role="switch"');
  /** The Rated button's own submit value (`name="rated" value="…"`). */
  const ratedValue = (form: string) => {
    const button = /<button[^>]*name="rated"[^>]*>/.exec(form)?.[0] ?? '';
    return / value="(true|false)"/.exec(button)?.[1] ?? '';
  };
  const ariaChecked = (form: string) => /aria-checked="(true|false)"/.exec(form)?.[1] ?? '';
  const selectedMode = (form: string) => /<option value="([^"]+)" selected="">/.exec(form)?.[1] ?? '';

  async function cardRowWithoutTime() {
    return { ...(await night.cardRow()), updated_at: null };
  }

  beforeAll(night.setup);
  afterAll(night.teardown);

  describe("the card's this-game forms (M20.18)", () => {
    it('1. Roll: the picker and Rated forms post game=this, under This game', async () => {
      await night.card({ mode: 'normal' });
      const lobby = await night.openLobby();
      shared.partyId = lobby.partyId;
      shared.lobbyId = lobby.lobbyId;
      await night.roll(lobby.lobbyId);
      const html = await paint();
      expect(html).toContain('data-slot="mode-this-game"');
      expect(plain(html)).toContain('This game');
      expect(plain(html)).not.toContain('Changes apply from the next game.');
      expect(hiddenFields(pickerForm(html))).toMatchObject({ groupId: night.group.id, game: 'this' });
      expect(hiddenFields(ratedForm(html))).toMatchObject({ groupId: night.group.id, game: 'this' });
      expect(selectedMode(pickerForm(html))).toBe('normal');
      night.clearPosts();
    });

    it("2. the picker's form: the lock takes the rule, the row is untouched, the card re-reads it", async () => {
      const rowBefore = await cardRowWithoutTime();
      const fields = hiddenFields(pickerForm(await paint()));
      const answer = await night.cardForm({ ...fields, mode: 'class:Tank' });
      expect(answer).toMatchObject({
        status: 303,
        notice: 'This game: Class wars, tanks only. Not rated.',
        error: null,
      });
      expect(await night.lockOf(shared.lobbyId)).toMatchObject({
        status: 'balanced',
        lock_mode: 'normal',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: null,
      });
      expect(await cardRowWithoutTime()).toEqual(rowBefore);
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).toContain('This game: tanks only.');
      const html = await paint();
      expect(selectedMode(pickerForm(html))).toBe('class:Tank');
      expect(plain(html)).toContain('Tanks only');
      expect(ariaChecked(ratedForm(html))).toBe('false');
      night.clearPosts();
    });

    it("3. the Rated form as it stands: the lock's switch flips, the row is untouched", async () => {
      const rowBefore = await cardRowWithoutTime();
      const form = ratedForm(await paint());
      expect(ratedValue(form)).toBe('true');
      const answer = await night.cardForm({ ...hiddenFields(form), rated: ratedValue(form) });
      expect(answer).toMatchObject({ status: 303, notice: 'This game is rated.', error: null });
      expect(await night.lockOf(shared.lobbyId)).toMatchObject({
        status: 'balanced',
        lock_rule: 'class',
        lock_class_tag: 'Tank',
        lock_rated: true,
      });
      expect(await cardRowWithoutTime()).toEqual(rowBefore);
      expect(night.posts).toHaveLength(1);
      expect(descriptionOf(night.posts[0])).not.toContain('Not rated.');
      const html = await paint();
      expect(ariaChecked(ratedForm(html))).toBe('true');
      expect(ratedValue(ratedForm(html))).toBe('false');
      expect(plain(html)).toContain('This game is rated.');
      night.clearPosts();
    });

    it('4. the game starts: the forms are the next game again, and a this post is refused', async () => {
      const stale = hiddenFields(ratedForm(await paint()));
      await night.startGame(shared.partyId);
      expect((await night.lockOf(shared.lobbyId)).status).toBe('in_game');
      const html = await paint();
      expect(html).not.toContain('data-slot="mode-this-game"');
      expect(hiddenFields(pickerForm(html)).game).toBeUndefined();
      expect(hiddenFields(ratedForm(html)).game).toBeUndefined();
      // A page still showing the balanced card posts game=this: the route says why, nothing moves.
      const refused = await night.cardForm({ ...stale, rated: 'false' });
      expect(refused).toMatchObject({ status: 303, error: THIS_GAME_STAYS, notice: null });
      expect(await night.lockOf(shared.lobbyId)).toMatchObject({ lock_rated: true });
      expect(night.posts).toHaveLength(0);
    });
  });
}
