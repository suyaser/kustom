import { describe, expect, it } from 'vitest';
import { isCurrentTab, NAV_ITEMS, RELEASE_EXE_URL, RELEASES_URL, WORDMARK } from './nav';

/**
 * The nav's two rules (05-design.md, "The app shell"), which are the ones a later engineer
 * breaks by adding a tab: **only routes that exist**, and **one destination is underlined**.
 */

describe('the nav list', () => {
  it('is the routes that exist, with one kind-neutral word for the daily game', () => {
    // `Stats` joined with M5.4, which is the rule working: a tab appears the day its route does.
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Tonight',
      'Leaderboard',
      'Games',
      'Stats',
      'Fun',
      // `Daily`, not `Mystery`: the shell renders on every page and does not know which of the
      // two daily games today is (M8.4).
      'Daily',
      'Companion ↗',
    ]);
  });

  it('sends the companion tab at the releases page, never at the exe', () => {
    const companion = NAV_ITEMS.find((item) => item.external === true);
    expect(companion?.href).toBe(RELEASES_URL);
    expect(companion?.href).not.toContain('latest/download/Kustom.exe');
    // The direct download exists, for `/admin` only.
    expect(RELEASE_EXE_URL).toBe(
      'https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe',
    );
  });

  it('says Kustom, and nothing says the repo codename', () => {
    expect(WORDMARK).toBe('KUSTOM');
  });
});

describe('which tab is current', () => {
  const tab = (label: string) => {
    const found = NAV_ITEMS.find((item) => item.label === label);
    if (found === undefined) throw new Error(`no tab ${label}`);
    return found;
  };

  it('underlines Tonight on the root and nowhere else', () => {
    expect(isCurrentTab(tab('Tonight'), '/')).toBe(true);
    expect(isCurrentTab(tab('Tonight'), '/leaderboard')).toBe(false);
    expect(isCurrentTab(tab('Tonight'), '/p/abc')).toBe(false);
  });

  it('counts a player page as the leaderboard, because that is where the link came from', () => {
    expect(isCurrentTab(tab('Leaderboard'), '/leaderboard')).toBe(true);
    expect(isCurrentTab(tab('Leaderboard'), '/p/abc')).toBe(true);
    expect(isCurrentTab(tab('Leaderboard'), '/')).toBe(false);
  });

  it('underlines Games on its own page and never on the board', () => {
    expect(isCurrentTab(tab('Games'), '/games')).toBe(true);
    expect(isCurrentTab(tab('Games'), '/leaderboard')).toBe(false);
    expect(isCurrentTab(tab('Leaderboard'), '/games')).toBe(false);
    expect(isCurrentTab(tab('Games'), '/p/abc')).toBe(false);
  });

  it('underlines Stats on its own page and never on the board', () => {
    expect(isCurrentTab(tab('Stats'), '/stats')).toBe(true);
    expect(isCurrentTab(tab('Stats'), '/leaderboard')).toBe(false);
    expect(isCurrentTab(tab('Leaderboard'), '/stats')).toBe(false);
    // A player page is still the leaderboard's, which is where those links come from.
    expect(isCurrentTab(tab('Stats'), '/p/abc')).toBe(false);
  });

  it('underlines Fun on its own page and never on Stats', () => {
    expect(isCurrentTab(tab('Fun'), '/fun')).toBe(true);
    expect(isCurrentTab(tab('Fun'), '/stats')).toBe(false);
    expect(isCurrentTab(tab('Stats'), '/fun')).toBe(false);
  });

  it('underlines the daily game on its own page and never on Tonight', () => {
    expect(isCurrentTab(tab('Daily'), '/mystery')).toBe(true);
    expect(isCurrentTab(tab('Daily'), '/')).toBe(false);
    expect(isCurrentTab(tab('Tonight'), '/mystery')).toBe(false);
  });

  it('never underlines an external destination', () => {
    expect(isCurrentTab(tab('Companion ↗'), '/')).toBe(false);
  });
});
