import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOBBY_WRITES_UNVERIFIED, openingOnPcLine } from '../lobbyStart';
import { type AdminFormKind, adminError, adminNotice, mintedToken } from './notices';

/**
 * M3.20's in-place notices, and the guard that keeps them honest.
 *
 * The route handlers are the API and this task does not touch them, so the sentence a JSON
 * caller shows beside the control is a **second copy** of the one the 303 path carries. Every
 * fixed sentence below is therefore also grepped for in the handler that owns it: if somebody
 * rewords a notice in `app/api`, this file fails rather than the page quietly drifting.
 */

const handler = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../app/api/admin/${path}`, import.meta.url)), 'utf8');

/**
 * The same read, one class over. `Start a lobby` is the one form on `/admin` whose route is
 * **not** an admin route: M4.13 moved it onto `/api/me/*`, where every linked player may press
 * it, and this page's button posts to that one path like everybody else's does.
 */
const meHandler = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../app/api/me/${path}`, import.meta.url)), 'utf8');

const players = handler('players/handler.ts');
const tokens = handler('tokens/handler.ts');
const discord = handler('discord-config/handler.ts');
const reroll = handler('lobbies/[lobbyId]/reroll/handler.ts');
const start = meHandler('lobbies/start/handler.ts');

/** Every form kind the admin area still has. `seasons` left with M5.14's Start button. */
const KINDS: AdminFormKind[] = ['players', 'tokens', 'discord', 'reroll', 'lobby-start'];

describe('players', () => {
  const notice = (values: Record<string, string>) => adminNotice('players', values, { ok: true });

  it('has nothing to say about a role save, because there is no longer one (M5.17)', () => {
    // The action is retired: it answers 410 and the page prints the route's own sentence, so
    // this file must not compose a receipt for a write that never happens.
    expect(notice({ action: 'set-roles', mainRole: 'mid', secondaryRole: 'top' })).toBe('saved');
  });

  it('says both halves of a name save: what it is now, and whether the client may move it', () => {
    expect(notice({ action: 'set-name', displayName: 'Hana' })).toBe('name saved: Hana');
    expect(notice({ action: 'set-name', displayName: '' })).toBe(
      'name cleared: it follows the Riot ID again',
    );
  });

  it('covers the Discord link, the admin flag and backfill', () => {
    expect(notice({ action: 'set-discord', discordId: '123' })).toBe('Discord id linked');
    expect(notice({ action: 'set-discord', discordId: '' })).toBe('Discord id cleared');
    expect(notice({ action: 'set-admin', isAdmin: 'true' })).toBe('admin granted');
    expect(notice({ action: 'set-admin', isAdmin: 'false' })).toBe('admin removed');
    expect(notice({ action: 'set-backfill', approved: 'true' })).toBe(
      'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.',
    );
    expect(notice({ action: 'set-backfill', approved: 'false' })).toBe('backfill revoked');
  });

  it('says the same words the route says', () => {
    for (const sentence of [
      'name cleared: it follows the Riot ID again',
      'name saved: ',
      'Discord id cleared',
      'Discord id linked',
      'admin granted',
      'admin removed',
      'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.',
      'backfill revoked',
    ]) {
      expect(players, sentence).toContain(sentence);
    }
  });
});

describe('tokens, the Discord config and the season', () => {
  it("names the two token outcomes, in the route's words", () => {
    expect(adminNotice('tokens', { action: 'mint' }, { ok: true })).toBe('token minted');
    expect(adminNotice('tokens', { action: 'revoke' }, { ok: true })).toBe('token revoked');
    expect(tokens).toContain("'token minted'");
    expect(tokens).toContain("'token revoked'");
  });

  it('hands back the raw token, which exists in that one response and nowhere else', () => {
    expect(mintedToken({ ok: true, token: 'cnt_live_abc' })).toBe('cnt_live_abc');
    expect(mintedToken({ ok: true })).toBeNull();
  });

  it("confirms the Discord config in the route's words", () => {
    expect(adminNotice('discord', {}, { ok: true })).toBe('Discord config saved');
    expect(discord).toContain("'Discord config saved'");
  });

  /**
   * **There is no seasons form left to answer** (M5.14, 2026-09-10). The kind, its sentence
   * and `POST /api/admin/seasons` went together; `/admin/seasons` is one read-only line.
   */
  it('has no sentence for a season, because nothing starts one', () => {
    expect(KINDS).not.toContain('seasons' as AdminFormKind);
    // Every kind that is left answers with something a reader can act on.
    for (const kind of KINDS) expect(adminNotice(kind, {}, { ok: true }).length).toBeGreaterThan(0);
  });
});

describe('the reroll', () => {
  const notice = (body: Record<string, unknown>) => adminNotice('reroll', {}, { ok: true, ...body });

  it('says which split is up, out of how many, and what Discord did', () => {
    expect(notice({ rank: 2, splitCount: 3, promoted: true, post: 'posted' })).toBe(
      'Split 2 is up: reroll 1 of 2. Posted to Discord.',
    );
    expect(notice({ rank: 1, splitCount: 3, promoted: true, post: 'skipped' })).toBe(
      'Split 1 is back on the board. No webhook is configured, so nothing was posted.',
    );
    expect(notice({ rank: 3, splitCount: 3, promoted: true, post: 'failed' })).toBe(
      'Split 3 is up: reroll 2 of 2. Discord did not take the post, but the teams stand.',
    );
  });

  it('says nothing moved when the split was already on the board: two taps, one message', () => {
    expect(notice({ rank: 2, splitCount: 3, promoted: false, post: null })).toBe(
      'Split 2 was already the one on the board. Nothing was posted.',
    );
  });

  it('says the same words the route says', () => {
    for (const fragment of [
      'was already the one on the board. Nothing was posted.',
      'Split 1 is back on the board.',
      'Posted to Discord.',
      'No webhook is configured, so nothing was posted.',
      'Discord did not take the post, but the teams stand.',
    ]) {
      expect(reroll, fragment).toContain(fragment);
    }
  });
});

describe('the Start a lobby press (M4.2)', () => {
  /** A whole answer, because the notice now parses the route's own response schema. */
  const answer = {
    ok: true,
    commandId: '2f1d6d7e-6c9a-4f0e-9d3f-5f1b8c2a44e1',
    host: { playerId: 'a6f0f4e2-1f77-4a63-9a5e-2c3f0b7d55aa', puuid: 'puuid-hamoodi', name: 'Hamoodi' },
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    cycle: 1,
    expiresAt: '2026-09-10T19:41:00.000Z',
  };

  it('names the host the server picked, in the sentence the route itself composes', () => {
    expect(adminNotice('lobby-start', {}, answer)).toBe(openingOnPcLine('Hamoodi'));
  });

  /**
   * **Not a second copy of the string** — the one case in this file where the page and the
   * handler call the same function, because the sentence has an argument in it. The guard is
   * therefore that the handler still calls it, not that it contains the words.
   */
  it('composes the same function the handler does, rather than spelling it twice', () => {
    expect(start).toContain('openingOnPcLine(value.hostName)');
    expect(openingOnPcLine('Hana')).toBe("Opening a lobby on Hana's PC…");
  });

  it('falls back to a sentence with no name when the answer carries none', () => {
    expect(adminNotice('lobby-start', {}, { ok: true })).toBe('the lobby is being opened');
  });

  it("prints the route's own words for a refusal, including today's gate sentence", () => {
    expect(adminError({ ok: false, error: LOBBY_WRITES_UNVERIFIED }, 'fallback')).toBe(
      LOBBY_WRITES_UNVERIFIED,
    );
  });
});

describe('a refusal', () => {
  it("is the route's own sentence, never one of ours", () => {
    expect(adminError({ ok: false, error: 'that lobby is not balanced' }, 'fallback')).toBe(
      'that lobby is not balanced',
    );
  });

  it('falls back only when the answer carries no sentence at all', () => {
    expect(adminError(null, 'that did not save')).toBe('that did not save');
    expect(adminError({ ok: false }, 'that did not save')).toBe('that did not save');
  });
});
