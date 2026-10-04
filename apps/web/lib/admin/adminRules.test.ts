import { describe, expect, it } from 'vitest';
import { NAMELESS_PLAYER } from '../discord/embeds';
import { maskSecret } from './discordConfig';
import { playerLabel } from './playerName';
import {
  ADMIN_PLAYERS_PAGE_SIZE,
  normalizeSearch,
  pageCountFor,
  parsePageParam,
  playerSearchFilter,
} from './players';

/** The rules the admin pages enforce that are not the database's to enforce. */

/*
 * `isSelfDemotion` (M1.6's "you cannot remove your own admin flag") is gone with M13.4: admin is a
 * membership role per group, and the rule that keeps a group from locking itself out is now "never
 * the last admin", and since M14.11 the owner rules, enforced by `set_group_member_role_v2` and
 * tested against the local stack in `app/api/admin/groups.integration.test.ts` and
 * `app/api/admin/owner.integration.test.ts`.
 */

describe('playerLabel', () => {
  const PUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  it("prefers the admin's name", () => {
    expect(playerLabel({ puuid: PUUID, displayName: 'Hamoodi', gameName: 'Ahmed', tagLine: 'EUW' })).toBe(
      'Hamoodi',
    );
  });

  it('falls back to the Riot ID', () => {
    expect(playerLabel({ puuid: PUUID, displayName: null, gameName: 'Ahmed', tagLine: 'EUW' })).toBe(
      'Ahmed#EUW',
    );
    // A game name with no tag line is still a name, not a reason to show a PUUID.
    expect(playerLabel({ puuid: PUUID, displayName: null, gameName: 'Ahmed', tagLine: null })).toBe('Ahmed');
  });

  it('reads Someone for a player first seen in an eog block, never a PUUID fragment', () => {
    // No `gameName` reaches the API from an end-of-game block, so this row really happens.
    expect(playerLabel({ puuid: PUUID, displayName: null, gameName: null })).toBe(NAMELESS_PLAYER);
  });

  it('treats a blank name as no name at all', () => {
    expect(playerLabel({ puuid: PUUID, displayName: '   ', gameName: 'Ahmed', tagLine: 'EUW' })).toBe(
      'Ahmed#EUW',
    );
    expect(playerLabel({ puuid: PUUID, displayName: null, gameName: '  ', tagLine: 'EUW' })).toBe(
      NAMELESS_PLAYER,
    );
  });

  it('never renders an empty string, whatever the row holds', () => {
    for (const row of [
      { puuid: PUUID, displayName: null, gameName: null, tagLine: null },
      { puuid: 'short', displayName: null, gameName: null },
      { puuid: PUUID, displayName: '', gameName: '', tagLine: '' },
    ]) {
      expect(playerLabel(row).length).toBeGreaterThan(0);
    }
  });
});

describe('a nameless player (admin round 2)', () => {
  it('reads Someone, never a PUUID fragment', () => {
    const puuid = 'a'.repeat(78);
    expect(playerLabel({ puuid, displayName: null, gameName: null })).toBe(NAMELESS_PLAYER);
    expect(playerLabel({ puuid, displayName: ' ', gameName: '', tagLine: 'EUW' })).toBe('Someone');
    expect(playerLabel({ puuid, displayName: null, gameName: null })).not.toContain('aaaa');
  });
});

describe('maskSecret', () => {
  it('keeps the shape of a webhook URL and hides the token', () => {
    const url = 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz-TOKEN';
    const masked = maskSecret(url);

    expect(masked).not.toBeNull();
    expect(masked).toContain('discord.com/api/webhooks/1234567890/');
    expect(masked).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(masked?.endsWith('OKEN')).toBe(true);
  });

  it('never reveals a short value', () => {
    expect(maskSecret('short')).not.toContain('short');
  });

  it('is null for nothing at all', () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret('   ')).toBeNull();
  });
});

/**
 * The paging and search rules behind `/admin/players` (M3.25). Pure on purpose: the query is
 * one `.range()` and one `.or()`, and what those two strings say is the whole of the feature.
 */
describe('the players page query (M3.25)', () => {
  it('pages at fifty', () => {
    expect(ADMIN_PLAYERS_PAGE_SIZE).toBe(50);
  });

  describe('normalizeSearch', () => {
    it('trims, and reads an empty box as no filter', () => {
      expect(normalizeSearch('  Hana  ')).toBe('Hana');
      expect(normalizeSearch('   ')).toBeNull();
      expect(normalizeSearch('')).toBeNull();
      expect(normalizeSearch(null)).toBeNull();
      expect(normalizeSearch(undefined)).toBeNull();
    });

    it('drops the characters PostgREST would read as filter syntax', () => {
      // `,` and `()` end an `or=` term; `%` and `*` are wildcards nobody typed on purpose; and
      // the backslash goes too, so the only one in a pattern is the escape the filter adds.
      expect(normalizeSearch('Hana,Omar')).toBe('Hana Omar');
      expect(normalizeSearch('(Hana)')).toBe('Hana');
      expect(normalizeSearch('%Hana%')).toBe('Hana');
      expect(normalizeSearch('Ha*na')).toBe('Ha na');
      expect(normalizeSearch('"Hana"')).toBe('Hana');
      expect(normalizeSearch('Ha\\na')).toBe('Ha na');
    });

    it('keeps an underscore, because a Riot ID can have one', () => {
      // It is a wildcard in `LIKE`, but it is escaped at the filter, not taken off the reader.
      expect(normalizeSearch('cool_guy')).toBe('cool_guy');
    });

    it('stops at 64 characters, so a pasted PUUID list is not a query', () => {
      expect(normalizeSearch('x'.repeat(200))).toHaveLength(64);
    });
  });

  describe('playerSearchFilter', () => {
    it('is contains on either name and prefix on the PUUID', () => {
      expect(playerSearchFilter('han')).toBe(
        'display_name.ilike.*han*,game_name.ilike.*han*,puuid.ilike.han*',
      );
    });

    it('escapes the underscore, which LIKE reads as any single character', () => {
      // `it_` used to match every `it-` row on the stack (reviewer, 2026-09-10).
      expect(playerSearchFilter('it_')).toBe(
        'display_name.ilike.*it\\_*,game_name.ilike.*it\\_*,puuid.ilike.it\\_*',
      );
    });
  });

  describe('parsePageParam', () => {
    it('reads a page number and refuses anything that is not one', () => {
      expect(parsePageParam('3')).toBe(3);
      expect(parsePageParam(null)).toBe(1);
      expect(parsePageParam('0')).toBe(1);
      expect(parsePageParam('-2')).toBe(1);
      expect(parsePageParam('1.5')).toBe(1);
      expect(parsePageParam('two')).toBe(1);
      expect(parsePageParam('')).toBe(1);
    });

    it('refuses a number no page could be, however integral it looks', () => {
      // `1e21` is an integer to `Number.isInteger` and an offset of 5e22 to `.range()`.
      expect(parsePageParam('1e21')).toBe(1);
      expect(parsePageParam(String(Number.MAX_SAFE_INTEGER + 2))).toBe(1);
      expect(parsePageParam('Infinity')).toBe(1);
      // …and the largest page this app could ever hand out is still a page.
      expect(parsePageParam(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('pageCountFor', () => {
    it('rounds up, and an empty list is still one page', () => {
      expect(pageCountFor(0, 50)).toBe(1);
      expect(pageCountFor(1, 50)).toBe(1);
      expect(pageCountFor(50, 50)).toBe(1);
      expect(pageCountFor(51, 50)).toBe(2);
      expect(pageCountFor(1200, 50)).toBe(24);
    });
  });
});
