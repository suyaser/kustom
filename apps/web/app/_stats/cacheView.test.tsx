import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { funForRender, MUSEUM_OPENINGS_KEPT } from '@/lib/stats/cacheView';
import { assembleFunFacts } from '@/lib/stats/funView';
import { playerFacts, type RawGameFacts } from '@/lib/stats/rawFacts';
import type { StatsGame } from '@/lib/stats/types';
import { statsView } from '@/lib/stats/view';
import { puuidOf, rosterFor, type Seat, statsGame } from '@/lib/testing/statsFixtures';
import { ChampionsSegment } from './ChampionsSegment';
import type { StatsLinks } from './parts';
import { RecordsSegment } from './RecordsSegment';

/**
 * The Stats cache stores the view trimmed to what the page prints (`lib/stats/cacheView.ts`). This
 * renders both segments from the whole view and from the trimmed one, expanded or not, and asks for
 * the same page, byte for byte.
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const BLUE = ['hana', 'iris', 'omar', 'lena', 'theo'];
const RED = ['yuki', 'mira', 'rami', 'sara', 'noor'];

/** Thirty games where people keep taking first blood and multi-kills, so every museum row has many openings. */
function season(): StatsGame[] {
  return Array.from({ length: 30 }, (_, g) => {
    const seat = (key: string, i: number, side: 0 | 1): Seat => ({
      key,
      role: ROLES[i],
      championId: 1 + ((g * 7 + i + side * 5) % 40),
      kills: (g + i) % 12,
      deaths: 1 + ((g + i + side) % 7),
      assists: (g * 3 + i) % 15,
      gold: 9_000 + i * 500,
      damageToChamps: 10_000 + ((g * 977 + i * 331) % 20_000),
      cs: 100 + i * 20,
      visionScore: 20,
      damageSelfMitigated: 8_000,
      damageToObjectives: 3_000,
    });
    const byPuuid: RawGameFacts['byPuuid'] = {};
    [...BLUE, ...RED].forEach((key, i) => {
      byPuuid[puuidOf(key)] = playerFacts({
        championName: `Champ ${(g + i) % 9}`,
        firstBloodKill: i === g % 10,
        firstBloodDeath: i === (g + 3) % 10,
        doubleKills: (g + i) % 3,
        tripleKills: (g + i) % 5 === 0 ? 1 : 0,
        quadraKills: (g + i) % 11 === 0 ? 1 : 0,
        pentaKills: (g + i) % 17 === 0 ? 1 : 0,
        firstTowerKill: i === (g + 1) % 10,
      });
    });
    return statsGame({
      id: `game-${g}`,
      at: `2026-09-${String((g % 28) + 1).padStart(2, '0')}T${String(18 + (g % 4)).padStart(2, '0')}:00:00Z`,
      winner: g % 3 === 0 ? 200 : 100,
      blue: BLUE.map((key, i) => seat(key, i, 0)),
      red: RED.map((key, i) => seat(key, i, 1)),
      rawFacts: { byPuuid, bans: [] },
    });
  });
}

function links(expanded: string | null): StatsLinks {
  return {
    player: (puuid) => `/g/x/p/${puuid}`,
    game: (id) => `/g/x/games/${id}`,
    playerGames: (puuid) => `/g/x/games?window=all-time&player=${puuid}`,
    showAll: (id) => `/g/x/stats?all=${id}#${id}`,
    showFewer: (id) => `/g/x/stats#${id}`,
    expanded,
    roasts: false,
  };
}

describe('the cached Stats view renders the same page', () => {
  const games = season();
  const input = {
    window: 'all-time' as const,
    games,
    players: rosterFor(games),
    range: { start: null, end: null },
    capped: false,
    cap: 2_000,
  };
  const stats = statsView(input);
  const fun = assembleFunFacts(input, 'sr');
  const trimmed = funForRender(fun);

  it('trims something: museum rows had more openings than a row prints', () => {
    const rows = [fun.museum, fun.donated, ...fun.halls].flatMap((section) => section.rows);
    expect(rows.some((row) => row.openings.length > MUSEUM_OPENINGS_KEPT)).toBe(true);
    expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(fun).length);
  });

  it.each([null, 'first-blood', 'hall-0', 'hall-1', 'donated'])('Records, expanded %s', (expanded) => {
    const whole = render(<RecordsSegment stats={stats} fun={fun} links={links(expanded)} />).container
      .innerHTML;
    const cached = render(<RecordsSegment stats={stats} fun={trimmed} links={links(expanded)} />).container
      .innerHTML;
    expect(cached).toBe(whole);
  });

  it('Champions', () => {
    const whole = render(<ChampionsSegment fun={fun} links={links(null)} />).container.innerHTML;
    const cached = render(<ChampionsSegment fun={trimmed} links={links(null)} />).container.innerHTML;
    expect(cached).toBe(whole);
  });
});
