import { describe, expect, it } from 'vitest';
import type { PublicClient } from '../publicClient';
import { rosterFor, statsGame } from '../testing/statsFixtures';
import { awardsView } from './awards';
import { BEST_OFF_ROLE, CURSED_DUO } from './copy';
import { countedGames } from './fold';
import { loadAwardWinners } from './load';
import type { AwardBlock, AwardsView, StatsGame } from './types';
import { awardWinners } from './winners';

/**
 * Who a closed window's awards name, keyed by puuid (M8.3) — the lookup `/leaderboard` badges a
 * row from.
 *
 * The point of every test here is that **nothing computes an award twice**: the winners are read
 * out of `awardsView`'s own blocks, so a badge can only ever name the person the award line on
 * `/stats` and in the Sunday post names.
 */

/**
 * A week of six games:
 *
 * - **Nadia** plays all six on mid, away from her main, on the side that wins every one: best
 *   off-role (`Most improved`, her second badge until M14.57, is retired).
 * - **Yuki and Theo** spend all six on the losing side together: `0W 6L`, the cursed duo, and
 *   both halves of it.
 * - The three seats beside them rotate at half time, so no other pair reaches the award's four
 *   games together and the duo is one line rather than ten.
 */
function week(): StatsGame[] {
  const games: StatsGame[] = [];

  for (let index = 0; index < 6; index += 1) {
    const nadia =
      index === 0
        ? { key: 'nadia', role: 'mid' as const, mu: [21.1, 21.5] as [number, number] }
        : index === 5
          ? { key: 'nadia', role: 'mid' as const, mu: [24.4, 24.6333333] as [number, number] }
          : { key: 'nadia', role: 'mid' as const };

    games.push(
      statsGame({
        at: `2026-09-0${1 + Math.floor(index / 3)}T${String(10 + (index % 3)).padStart(2, '0')}:00:00Z`,
        blue: index < 3 ? ['yuki', 'theo', 'f1', 'f2', 'f3'] : ['yuki', 'theo', 'f4', 'f5', 'f6'],
        red: [nadia, 'f7', 'f8', 'f9', 'f10'],
        winner: 200,
      }),
    );
  }

  return countedGames(games);
}

function winnersOf(window: 'last-week' | 'this-week' | 'all-time') {
  const games = week();
  const players = rosterFor(games, ['nadia:top']);
  return awardWinners(awardsView(window, games, players));
}

/** A winner's badges as the row would print them, `undefined` for a row with none. */
function badges(window: 'last-week', key: string): readonly string[] | undefined {
  return winnersOf(window).get(`u-${key}`);
}

describe('the winners of a closed window', () => {
  it('names the people the award lines name, and nobody else', () => {
    const winners = winnersOf('last-week');

    expect([...winners.keys()].sort()).toEqual(['u-nadia', 'u-theo', 'u-yuki']);
  });

  /** M14.57: Most improved is retired, so Nadia's row carries the one award she won. */
  it('gives a row the awards it won and no retired one', () => {
    expect(badges('last-week', 'nadia')).toEqual([BEST_OFF_ROLE]);
  });

  /** Both halves of the pair get it: two rows, the same two words, and the pair explains itself. */
  it('badges both halves of a cursed duo', () => {
    expect(badges('last-week', 'yuki')).toEqual([CURSED_DUO]);
    expect(badges('last-week', 'theo')).toEqual([CURSED_DUO]);
  });

  /**
   * The titles are the award blocks' own labels, which are `lib/stats/copy.ts`'s constants —
   * never a second spelling of `Cursed duo` kept somewhere near the board.
   */
  it('prints the award titles and nothing else: no count, no delta, no partner', () => {
    for (const titles of winnersOf('last-week').values()) {
      for (const title of titles) {
        expect([BEST_OFF_ROLE, CURSED_DUO]).toContain(title);
      }
    }
  });
});

describe('the windows that hand nothing out', () => {
  /**
   * M5.4's rule, which M8.3 does not reopen: an award that changes every night is a statistic.
   * `All time` has no block at all.
   */
  it('are the running week and all time, which name nobody', () => {
    expect(winnersOf('this-week').size).toBe(0);
    expect(winnersOf('all-time').size).toBe(0);
  });

  /** Nobody cleared a minimum: no badges, and the board is the board it was before M8.3. */
  it('include a closed window nobody qualified in', () => {
    // The same roster over a closed week with no games in it: nobody clears 4 and 4.
    const players = rosterFor(week(), ['nadia:top']);
    expect(awardWinners(awardsView('last-week', [], players)).size).toBe(0);
  });
});

describe('the shapes awardWinners is handed', () => {
  const closed = (blocks: AwardBlock[]): AwardsView => ({
    kind: 'closed',
    intro: 'Two awards for the week. Nobody votes; the numbers pick.',
    blocks,
  });

  it('skips the sentence an award nobody won prints, key and all', () => {
    const winners = awardWinners(
      closed([
        {
          label: BEST_OFF_ROLE,
          rule: 'rule',
          lines: [{ key: 'nobody', text: 'Nobody spent 4 games off their main.' }],
          won: false,
          note: null,
        },
      ]),
    );

    expect(winners.size).toBe(0);
  });

  /** A tie names two winners, and both rows carry the badge. */
  it('badges every winner of a tied award', () => {
    const winners = awardWinners(
      closed([
        {
          label: BEST_OFF_ROLE,
          rule: 'rule',
          lines: [
            { key: 'u-nadia', text: 'Nadia · 6W 0L · 100% · their main is top' },
            { key: 'u-omar', text: 'Omar · 6W 0L · 100% · their main is top' },
          ],
          won: true,
          note: null,
        },
      ]),
    );

    expect(winners.get('u-nadia')).toEqual([BEST_OFF_ROLE]);
    expect(winners.get('u-omar')).toEqual([BEST_OFF_ROLE]);
  });

  /** Two tied pairs sharing a player is one badge on that row: twice says nothing. */
  it('gives a player named by two tied pairs one badge', () => {
    const winners = awardWinners(
      closed([
        {
          label: CURSED_DUO,
          rule: 'rule',
          lines: [
            { key: 'u-yuki|u-theo', text: 'Yuki and Theo · 0W 6L · 0%' },
            { key: 'u-yuki|u-omar', text: 'Yuki and Omar · 0W 6L · 0%' },
          ],
          won: true,
          note: null,
        },
      ]),
    );

    expect(winners.get('u-yuki')).toEqual([CURSED_DUO]);
    expect(winners.get('u-theo')).toEqual([CURSED_DUO]);
  });

  it('is empty for a running window and for no awards at all', () => {
    expect(awardWinners({ kind: 'running', line: 'Awards are handed out when the week ends.' }).size).toBe(0);
    expect(awardWinners(null).size).toBe(0);
  });
});

describe('the read the lookup makes', () => {
  /**
   * **A window with no awards makes no query.** That is what keeps `This week` and
   * `All time` byte-identical to the board before M8.3 *and* free: the client below throws on any
   * use, so a single read would fail the test.
   */
  const refuses = new Proxy(
    {},
    {
      get() {
        throw new Error('the award lookup must not read anything on a window with no awards');
      },
    },
  ) as PublicClient;

  it('is nothing at all on the two windows that hand nothing out', async () => {
    for (const window of ['this-week', 'all-time'] as const) {
      expect((await loadAwardWinners(refuses, { window })).size).toBe(0);
    }
  });
});
