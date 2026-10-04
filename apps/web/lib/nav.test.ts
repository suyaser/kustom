import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP, type PageGroup } from './groups/pageGroup';
import {
  currentMainTab,
  groupHref,
  groupNavItems,
  isCurrentTab,
  mainTabs,
  type NavItem,
  RELEASE_ASSET,
  RELEASE_EXE_SHA256_URL,
  RELEASE_EXE_URL,
  RELEASES_URL,
  WORDMARK,
} from './nav';

/**
 * The nav's rules (05-design.md, "The app shell"; M13.9), which are the ones a later engineer
 * breaks by adding a tab or moving a page: **only routes that exist**, **one destination is
 * underlined**, and **every in-app link stays inside the page's group**.
 */

/** A group that is not the original one: the case every other group is. */
const GROUP_A: PageGroup = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'thursday-flex',
  name: 'Thursday Flex',
};

const labels = (items: readonly NavItem[]) => items.map((item) => item.label);

describe('the nav list', () => {
  it('is the routes that exist for the original group, with one kind-neutral word for the daily game', () => {
    expect(labels(groupNavItems(ORIGINAL_GROUP, { isAdmin: false }))).toEqual([
      'Board',
      'Games',
      'Stats',
      'Fun',
      '1v1',
      // `Daily`, not `Mystery`: the shell renders on every page and does not know which of the
      // two daily games today is (M8.4).
      'Daily',
      'Get Kustom ↗',
    ]);
  });

  it('sends the original group to its moved tonight page and to the old paths of the pages that have not moved', () => {
    const hrefs = Object.fromEntries(
      groupNavItems(ORIGINAL_GROUP, { isAdmin: true }).map((item) => [item.label, item.href]),
    );
    expect(hrefs).toMatchObject({
      // Moved under the group by M14.15, M14.16, M14.17 and M14.22.
      Board: '/g/customs/leaderboard',
      Games: '/g/customs/games',
      Stats: '/g/customs/stats',
      Fun: '/g/customs/stats/champions',
      '1v1': '/g/customs/stats/1v1',
      Daily: '/g/customs/mystery',
      Admin: '/g/customs/admin',
    });
  });

  it('sends the companion tab at the releases page, never at the exe', () => {
    const companion = groupNavItems(GROUP_A, { isAdmin: false }).find((item) => item.external === true);
    expect(companion?.href).toBe(RELEASES_URL);
    expect(companion?.href).not.toContain('latest/download/');
    // The direct download exists, for the PC that will run Kustom only.
    expect(RELEASE_EXE_URL).toBe(
      'https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom-setup.exe',
    );
  });

  it('builds the direct download from the one asset switch, the Kustom 1.0 installer (M17.12)', () => {
    // 2.0 and the Rust Kustom 1.0 ship together (decision row 2026-10-04), so the download is the
    // installer from the first 2.0 deploy on.
    expect(RELEASE_ASSET).toBe('Kustom-setup.exe');
    expect(RELEASE_EXE_URL).toBe(`${RELEASES_URL}/download/${RELEASE_ASSET}`);
    expect(RELEASE_EXE_SHA256_URL).toBe(`${RELEASE_EXE_URL}.sha256`);
  });

  it('says Kustom', () => {
    expect(WORDMARK).toBe('KUSTOM');
  });
});

describe('a group that is not the original (M13.9 acceptance 4)', () => {
  it('has no Tonight tab: the wordmark is the way home (the product owner, M13.9)', () => {
    for (const group of [ORIGINAL_GROUP, GROUP_A]) {
      expect(labels(groupNavItems(group, { isAdmin: true }))).not.toContain('Tonight');
    }
  });

  it('links only inside /g/<slug>/ or outside the site, admin or not', () => {
    for (const isAdmin of [false, true]) {
      for (const item of groupNavItems(GROUP_A, { isAdmin })) {
        if (item.external === true) {
          expect(item.href).toMatch(/^https:\/\//);
        } else {
          expect(
            item.href === '/g/thursday-flex' || item.href.startsWith('/g/thursday-flex/'),
            item.href,
          ).toBe(true);
        }
      }
    }
  });

  it('draws no tab for a page that still only exists at its old path, so nothing shows the original group under its name', () => {
    // Every in-app page has moved under the group (M14.15 to M14.22), so a new group has them all.
    expect(labels(groupNavItems(GROUP_A, { isAdmin: true }))).toEqual([
      'Board',
      'Games',
      'Stats',
      'Fun',
      '1v1',
      'Daily',
      'Admin',
      'Get Kustom ↗',
    ]);
  });

  it('has a game page, a board, a player page, its daily page and its admin page', () => {
    expect(groupHref(GROUP_A, { page: 'tonight' })).toBe('/g/thursday-flex');
    expect(groupHref(GROUP_A, { page: 'game', gameId: 'abc' })).toBe('/g/thursday-flex/games/abc');
    expect(groupHref(GROUP_A, { page: 'leaderboard' })).toBe('/g/thursday-flex/leaderboard');
    expect(groupHref(GROUP_A, { page: 'player', puuid: 'p1' })).toBe('/g/thursday-flex/p/p1');
    expect(groupHref(GROUP_A, { page: 'mystery' })).toBe('/g/thursday-flex/mystery');
    expect(groupHref(GROUP_A, { page: 'admin' })).toBe('/g/thursday-flex/admin');
  });
});

describe('the Admin tab', () => {
  it('is drawn only for an admin of the group, after the in-app tabs and before Companion', () => {
    expect(labels(groupNavItems(ORIGINAL_GROUP, { isAdmin: false }))).not.toContain('Admin');
    const items = labels(groupNavItems(ORIGINAL_GROUP, { isAdmin: true }));
    expect(items.slice(-2)).toEqual(['Admin', 'Get Kustom ↗']);
  });
});

describe('which tab is current', () => {
  const tab = (group: PageGroup, label: string) => {
    const found = groupNavItems(group, { isAdmin: true }).find((item) => item.label === label);
    if (found === undefined) throw new Error(`no tab ${label}`);
    return found;
  };
  const original = (label: string) => tab(ORIGINAL_GROUP, label);

  it('underlines nothing on the tonight page, whose way in is the wordmark', () => {
    for (const item of groupNavItems(ORIGINAL_GROUP, { isAdmin: true })) {
      expect(isCurrentTab(item, '/g/customs', ORIGINAL_GROUP), item.label).toBe(false);
    }
  });

  it('counts a player page as the leaderboard, because that is where the link came from', () => {
    expect(isCurrentTab(original('Board'), '/leaderboard', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Board'), '/p/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Board'), '/g/customs/leaderboard', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Board'), '/g/customs/p/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Board'), '/g/customs', ORIGINAL_GROUP)).toBe(false);
  });

  it('underlines Games on its own page and on a game page, and never on the board', () => {
    expect(isCurrentTab(original('Games'), '/games', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Games'), '/g/customs/games/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Games'), '/leaderboard', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Board'), '/games', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Games'), '/p/abc', ORIGINAL_GROUP)).toBe(false);
  });

  it('underlines Stats, Fun, 1v1 and Daily on their own pages only', () => {
    expect(isCurrentTab(original('Stats'), '/stats', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Stats'), '/p/abc', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Fun'), '/fun', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Fun'), '/stats', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('1v1'), '/1v1', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('1v1'), '/fun', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Daily'), '/mystery', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Daily'), '/g/customs', ORIGINAL_GROUP)).toBe(false);
  });

  it('never underlines Admin or an external destination', () => {
    expect(isCurrentTab(original('Admin'), '/g/customs/admin', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Get Kustom ↗'), '/g/customs', ORIGINAL_GROUP)).toBe(false);
  });
});

describe('the 2.0 sections (M14.7, five since M14.7b)', () => {
  it('are Tonight, Board, Games, Stats and You for the original group, unmoved pages at their old paths', () => {
    expect(mainTabs(ORIGINAL_GROUP).map((tab) => [tab.label, tab.href])).toEqual([
      ['Tonight', '/g/customs'],
      ['Board', '/g/customs/leaderboard'],
      ['Games', '/g/customs/games'],
      ['Stats', '/g/customs/stats'],
      ['You', '/g/customs/you'],
    ]);
  });

  it('are all five for any group, now that every section lives under the group', () => {
    expect(mainTabs(GROUP_A).map((tab) => [tab.label, tab.href])).toEqual([
      ['Tonight', '/g/thursday-flex'],
      ['Board', '/g/thursday-flex/leaderboard'],
      ['Games', '/g/thursday-flex/games'],
      ['Stats', '/g/thursday-flex/stats'],
      ['You', '/g/thursday-flex/you'],
    ]);
  });

  it('give every page one section, and an unknown path none', () => {
    const at = (path: string) => currentMainTab(path, ORIGINAL_GROUP);
    expect(at('/g/customs')).toBe('tonight');
    expect(at('/g/customs/')).toBe('tonight');
    expect(at('/mystery')).toBe('tonight');
    expect(at('/g/customs/mode')).toBe('tonight');
    expect(at('/leaderboard')).toBe('board');
    expect(at('/g/customs/p/abc')).toBe('board');
    expect(at('/g/customs/games/abc')).toBe('games');
    expect(at('/stats')).toBe('stats');
    expect(at('/fun')).toBe('stats');
    expect(at('/1v1')).toBe('stats');
    expect(at('/g/customs/you')).toBe('you');
    expect(at('/g/customs/more')).toBeNull();
    expect(at('/g/customs/zzz')).toBeNull();
  });

  it("never match another group, nor the original group's old paths for another group", () => {
    expect(currentMainTab('/g/customs', GROUP_A)).toBeNull();
    expect(currentMainTab('/leaderboard', GROUP_A)).toBeNull();
    expect(currentMainTab('/g/thursday-flex/you', GROUP_A)).toBe('you');
  });

  it('has no More destination left', () => {
    for (const group of [ORIGINAL_GROUP, GROUP_A]) {
      expect(mainTabs(group).map((tab) => tab.label)).not.toContain('More');
    }
  });
});
