import { describe, expect, it } from 'vitest';
import type { StatsGame } from '../stats/types';
import { puuidOf, rosterFor, tenPlayerGame } from '../testing/statsFixtures';
import { headToHead, versusGames } from './fold';
import { pickTwoHref, youVsEveryone, youVsOne } from './you';
import { laneLine, neverMet, youAndThem } from './youCopy';

/**
 * You vs them (M14.35): one fold for the card and the list, equal to the 1v1 page's own
 * `headToHead` for the pair, both orders.
 */

let n = 0;
function at(): string {
  n += 1;
  return new Date(Date.UTC(2026, 8, 1, 10, n)).toISOString();
}

/** Ana and Bo on the same side, `winner` 100 means they won. */
function together(winner: 100 | 200): StatsGame {
  return tenPlayerGame({ at: at(), winner, blue: ['ana', 'bo'] });
}

/** Ana blue top against Bo red top. */
function againstTop(winner: 100 | 200): StatsGame {
  return tenPlayerGame({
    at: at(),
    winner,
    blue: [{ key: 'ana', role: 'top' }],
    red: [{ key: 'bo', role: 'top' }],
  });
}

function againstOffLane(winner: 100 | 200): StatsGame {
  return tenPlayerGame({
    at: at(),
    winner,
    blue: [{ key: 'ana', role: 'mid' }],
    red: [{ key: 'bo', role: 'adc' }],
  });
}

const GAMES = [
  ...[100, 100, 100, 200].map((w) => together(w as 100 | 200)),
  ...[200, 200, 100].map((w) => againstTop(w as 100 | 200)),
  againstOffLane(200),
  // An ARAM never counts.
  tenPlayerGame({ at: at(), winner: 100, blue: ['ana'], red: ['bo'], gameMode: 'ARAM' }),
];
const PLAYERS = rosterFor(GAMES, ['cy']);

describe('youVsEveryone', () => {
  it("is the 1v1 page's headToHead for the pair, from the viewer's side", () => {
    const row = youVsOne(youVsEveryone(GAMES, PLAYERS, puuidOf('ana')), puuidOf('bo'));
    const pair = headToHead(versusGames(GAMES), PLAYERS, 'p-ana', 'p-bo');
    expect(row?.together).toEqual({ wins: pair?.allyWins, losses: pair?.allyLosses });
    expect(row?.against).toEqual({ wins: pair?.aWins, losses: pair?.bWins });
    expect(row?.together).toEqual({ wins: 3, losses: 1 });
    expect(row?.against).toEqual({ wins: 1, losses: 3 });
    expect(row?.lanes).toEqual([{ role: 'top', you: 1, them: 2 }]);
  });

  it('is the mirror image from the other side (both orders)', () => {
    const fromAna = youVsOne(youVsEveryone(GAMES, PLAYERS, puuidOf('ana')), puuidOf('bo'));
    const fromBo = youVsOne(youVsEveryone(GAMES, PLAYERS, puuidOf('bo')), puuidOf('ana'));
    expect(fromBo?.together).toEqual(fromAna?.together);
    expect(fromBo?.against).toEqual({ wins: fromAna?.against.losses, losses: fromAna?.against.wins });
    expect(fromBo?.lanes).toEqual([{ role: 'top', you: 2, them: 1 }]);
  });

  it('lists everyone met, most games first, and nobody never met', () => {
    const rows = youVsEveryone(GAMES, PLAYERS, puuidOf('ana'));
    expect(rows[0]?.them.puuid).toBe(puuidOf('bo'));
    expect(rows[0]?.games).toBe(8);
    expect(rows.some((row) => row.them.puuid === puuidOf('cy'))).toBe(false);
    expect(youVsOne(rows, puuidOf('cy'))).toBeNull();
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]?.games ?? 0) >= (rows[i]?.games ?? 0)).toBe(true);
    }
  });

  it('is empty for a viewer with no game', () => {
    expect(youVsEveryone(GAMES, PLAYERS, puuidOf('cy'))).toEqual([]);
  });

  it('links each row to Pick two with both filled in', () => {
    expect(pickTwoHref({ slug: 'customs' }, 'u-ana', 'u-bo')).toBe('/g/customs/stats/1v1?a=u-ana&b=u-bo');
  });
});

describe('the words', () => {
  it('says the card sentence, the lane lines and the never-met line, with no gendered word', () => {
    expect(youAndThem('Bo', { wins: 9, losses: 3 }, { wins: 2, losses: 6 })).toBe(
      'You and Bo: 9–3 together, 2–6 against.',
    );
    expect(laneLine('Bo', { role: 'top', you: 2, them: 5 })).toBe('In lane: top, Bo leads 5–2.');
    expect(laneLine('Bo', { role: 'mid', you: 4, them: 1 })).toBe('In lane: mid, you lead 4–1.');
    expect(laneLine('Bo', { role: 'adc', you: 3, them: 3 })).toBe('In lane: adc, 3–3.');
    expect(neverMet('Bo')).toBe("You haven't played with or against Bo yet.");
    for (const text of [laneLine('Bo', { role: 'top', you: 1, them: 2 }), neverMet('Bo')]) {
      expect(text).not.toMatch(/\b(he|she|his|her)\b/i);
    }
  });
});
