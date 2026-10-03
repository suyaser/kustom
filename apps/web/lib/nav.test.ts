import { describe, expect, it } from 'vitest';
import { ORIGINAL_GROUP, type PageGroup } from './groups/pageGroup';
import {
  groupHref,
  groupNavItems,
  isCurrentTab,
  type NavItem,
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
      'Leaderboard',
      'Games',
      'Stats',
      'Fun',
      '1v1',
      // `Daily`, not `Mystery`: the shell renders on every page and does not know which of the
      // two daily games today is (M8.4).
      'Daily',
      'Companion ↗',
    ]);
  });

  it('sends the original group to its moved tonight page and to the old paths of the pages that have not moved', () => {
    const hrefs = Object.fromEntries(
      groupNavItems(ORIGINAL_GROUP, { isAdmin: true }).map((item) => [item.label, item.href]),
    );
    expect(hrefs).toMatchObject({
      Leaderboard: '/leaderboard',
      Games: '/games',
      Stats: '/stats',
      Fun: '/fun',
      '1v1': '/1v1',
      Daily: '/mystery',
      // The product owner (M13.9): the existing admin page until M13.14 moves it.
      Admin: '/admin',
    });
  });

  it('sends the companion tab at the releases page, never at the exe', () => {
    const companion = groupNavItems(GROUP_A, { isAdmin: false }).find((item) => item.external === true);
    expect(companion?.href).toBe(RELEASES_URL);
    expect(companion?.href).not.toContain('latest/download/Kustom.exe');
    // The direct download exists, for `/admin` only.
    expect(RELEASE_EXE_URL).toBe(
      'https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe',
    );
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
    expect(labels(groupNavItems(GROUP_A, { isAdmin: true }))).toEqual(['Companion ↗']);
  });

  it('has a game page and no player, daily or admin page yet', () => {
    expect(groupHref(GROUP_A, { page: 'tonight' })).toBe('/g/thursday-flex');
    expect(groupHref(GROUP_A, { page: 'game', gameId: 'abc' })).toBe('/g/thursday-flex/games/abc');
    expect(groupHref(GROUP_A, { page: 'player', puuid: 'p1' })).toBeNull();
    expect(groupHref(GROUP_A, { page: 'mystery' })).toBeNull();
    expect(groupHref(GROUP_A, { page: 'admin' })).toBeNull();
  });
});

describe('the Admin tab', () => {
  it('is drawn only for an admin of the group, after the in-app tabs and before Companion', () => {
    expect(labels(groupNavItems(ORIGINAL_GROUP, { isAdmin: false }))).not.toContain('Admin');
    const items = labels(groupNavItems(ORIGINAL_GROUP, { isAdmin: true }));
    expect(items.slice(-2)).toEqual(['Admin', 'Companion ↗']);
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
    expect(isCurrentTab(original('Leaderboard'), '/leaderboard', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Leaderboard'), '/p/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Leaderboard'), '/g/customs/leaderboard', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Leaderboard'), '/g/customs/p/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Leaderboard'), '/g/customs', ORIGINAL_GROUP)).toBe(false);
  });

  it('underlines Games on its own page and on a game page, and never on the board', () => {
    expect(isCurrentTab(original('Games'), '/games', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Games'), '/g/customs/games/abc', ORIGINAL_GROUP)).toBe(true);
    expect(isCurrentTab(original('Games'), '/leaderboard', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Leaderboard'), '/games', ORIGINAL_GROUP)).toBe(false);
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
    expect(isCurrentTab(original('Admin'), '/admin', ORIGINAL_GROUP)).toBe(false);
    expect(isCurrentTab(original('Companion ↗'), '/g/customs', ORIGINAL_GROUP)).toBe(false);
  });
});
