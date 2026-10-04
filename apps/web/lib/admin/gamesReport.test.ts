import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../games/duration';
import {
  CAPTURED_CAP,
  formatClock,
  formatNightOf,
  GAMES_COPY,
  MISSED_CAP,
  MISSED_LOBBY_STATUSES,
  type RatedReasonInput,
  ratedReason,
  shortPartyId,
} from './games';
import { ratedLabel } from './sectionCopy';

/**
 * The pure half of the missed-game report (M5.5): the strings the page prints and the two
 * statuses the `Missed` list is made of.
 */

const CAIRO = 'Africa/Cairo';

describe('MISSED_LOBBY_STATUSES', () => {
  it('is both halves of "a game started and no result came back"', () => {
    // `in_game` may still be being played; `dropped` is one the sweep gave up on (M5.11).
    // One constant, so no query anywhere lists only half of them.
    expect([...MISSED_LOBBY_STATUSES]).toEqual(['in_game', 'dropped']);
  });

  it('keeps the brief’s caps', () => {
    expect(MISSED_CAP).toBe(100);
    expect(CAPTURED_CAP).toBe(200);
  });
});

describe("the page's copy, byte for byte (brief 2026-09-09; developer words removed, M14.23)", () => {
  it('is the words in the brief and no others', () => {
    expect(GAMES_COPY).toEqual({
      heading: 'Recording',
      intro: 'Every game Kustom saw, and any it missed.',
      missed: 'Missed',
      missedIntro:
        'These lobbies started a game and no result ever came in. Kustom was closed before the game ended. It usually picks the game up the next day, and it drops off this list on its own.',
      missedEmpty: 'Nothing missing. Every game that started has a result.',
      captured: 'Captured',
      capturedIntro:
        'The games Kustom has for this group, newest first. Games picked up the next day count toward ratings by the next morning.',
      capturedEmpty: 'No games yet.',
      lobbyNeverClosed:
        'A result came in for this game, but its lobby never closed. Ratings are fine; only the lobby is stuck.',
    });
  });
});

describe('formatNightOf', () => {
  it('is `Tue 9 Sep`', () => {
    // 21:30 Cairo on Tuesday 8 September 2026 — inside the night that started that morning.
    expect(formatNightOf(new Date('2026-09-08T18:30:00Z'), CAIRO)).toBe('Tue 8 Sep');
  });

  it('dates a game played after midnight to the night it belongs to', () => {
    // 01:20 Cairo on Wednesday is still Tuesday's night: 06:00 to 06:00 (M2.5).
    expect(formatNightOf(new Date('2026-09-08T22:20:00Z'), CAIRO)).toBe('Tue 8 Sep');
    // …and 07:00 Cairo on Wednesday is a new one.
    expect(formatNightOf(new Date('2026-09-09T04:00:00Z'), CAIRO)).toBe('Wed 9 Sep');
  });

  it('cuts the four-letter September en-GB ICU prints', () => {
    expect(formatNightOf(new Date('2026-09-08T18:30:00Z'), CAIRO)).not.toContain('Sept');
  });
});

describe('formatClock', () => {
  it('is a 24-hour clock in the night’s own zone', () => {
    expect(formatClock(new Date('2026-09-08T18:30:00Z'), CAIRO)).toBe('21:30');
    // Midnight is 00, never 24.
    expect(formatClock(new Date('2026-09-08T21:00:00Z'), CAIRO)).toBe('00:00');
  });
});

describe('the Length column (M14.16 AC2, M14.39)', () => {
  it('is whole minutes, never a clock time', () => {
    expect(formatMinutes(2_052)).toBe('34 min');
    expect(formatMinutes(200)).toBe('3 min');
    expect(formatMinutes(42)).toBe('1 min');
  });
});

describe('shortPartyId', () => {
  it('is the first eight characters, and leaves a short one alone', () => {
    expect(shortPartyId('e3c69392-1a2b-4c3d-8e9f-000000000000')).toBe('e3c69392');
    expect(shortPartyId('abc')).toBe('abc');
  });
});

describe('why a game is not rated (M14.53)', () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({
    playerId: `p${index}`,
    side: (index < 5 ? 100 : 200) as 100 | 200,
    muAfter: null as number | null,
  }));
  const noRule = { rule: null, classTag: null, regionBlue: null, regionRed: null };
  const base: RatedReasonInput = {
    players: ten,
    durationS: 1_800,
    gameMode: 'CLASSIC',
    rated: true,
    rule: noRule,
    noDraw: false,
    startedAt: '2026-10-03T20:00:00.000Z',
    ratingsSince: null,
  };
  const label = (input: Partial<RatedReasonInput>) => ratedLabel(ratedReason({ ...base, ...input }));

  it('Yes once the fold wrote every row', () => {
    const folded = ten.map((player) => ({ ...player, muAfter: 26 }));
    expect(ratedReason({ ...base, players: folded })).toEqual({ kind: 'rated' });
    expect(label({ players: folded })).toBe('Yes');
  });

  it('Waiting to be counted: nothing refuses it and no fold has run (a backfilled game)', () => {
    expect(ratedReason(base)).toEqual({ kind: 'waiting' });
    expect(label({})).toBe('Waiting to be counted');
    // A missing mode is Rift (M5.26), so an old game waits too.
    expect(label({ gameMode: null })).toBe('Waiting to be counted');
  });

  it('before the ratings reset: the fold skips a game older than the epoch, so it never waits (M15.13)', () => {
    const since = '2026-10-04T00:00:00.000Z';
    expect(ratedReason({ ...base, ratingsSince: since })).toEqual({ kind: 'before-reset' });
    expect(label({ ratingsSince: since })).toBe('No · before the ratings reset');
    // At or after the epoch it counts, so a game with no fold yet still waits.
    expect(label({ ratingsSince: since, startedAt: since })).toBe('Waiting to be counted');
    expect(label({ ratingsSince: since, startedAt: '2026-10-04T20:00:00.000Z' })).toBe(
      'Waiting to be counted',
    );
    // A game rated before the reset keeps its stored columns: still Yes.
    const folded = ten.map((player) => ({ ...player, muAfter: 26 }));
    expect(label({ ratingsSince: since, players: folded })).toBe('Yes');
    // The gate comes first, as in the fold: an old ARAM is an ARAM, an old not-rated rule game names its rule.
    expect(label({ ratingsSince: since, gameMode: 'ARAM' })).toBe('No · ARAM');
    expect(
      label({ ratingsSince: since, rated: false, rule: { ...noRule, rule: 'class', classTag: 'Tank' } }),
    ).toBe('No · Tanks only');
  });

  it('ARAM, and one word for any other map', () => {
    expect(label({ gameMode: 'ARAM' })).toBe('No · ARAM');
    expect(label({ gameMode: 'URF' })).toBe('No · not Summoner’s Rift');
  });

  it('the rule that made it unrated, by name', () => {
    expect(label({ rated: false, rule: { ...noRule, rule: 'class', classTag: 'Tank' } })).toBe(
      'No · Tanks only',
    );
    expect(
      label({ rated: false, rule: { ...noRule, rule: 'region', regionBlue: 'ionia', regionRed: 'noxus' } }),
    ).toBe('No · Region wars');
  });

  it('region wars that could not be drawn is named, not `Rated was off` (M15.17)', () => {
    expect(ratedReason({ ...base, rated: false, noDraw: true })).toEqual({ kind: 'no-draw' });
    expect(label({ rated: false, noDraw: true })).toBe("No · Region wars couldn't be drawn");
    // The gate still comes first: a no-draw remake is short.
    expect(label({ rated: false, noDraw: true, durationS: 200 })).toBe('No · too short or not ten players');
    // An admin who switched Rated on for it: rated like any game once folded.
    expect(
      label({ rated: true, noDraw: true, players: ten.map((player) => ({ ...player, muAfter: 26 })) }),
    ).toBe('Yes');
  });

  it('one label per rule default (M15.17): region wars not rated, mirror rated, mirror with Rated off', () => {
    const folded = ten.map((player) => ({ ...player, muAfter: 26 }));
    expect(
      label({ rated: false, rule: { ...noRule, rule: 'region', regionBlue: 'ionia', regionRed: 'noxus' } }),
    ).toBe('No · Region wars');
    expect(label({ rated: true, rule: { ...noRule, rule: 'mirror' }, players: folded })).toBe('Yes');
    expect(label({ rated: false, rule: { ...noRule, rule: 'mirror' } })).toBe('No · Rated was off');
  });

  it('Rated was off: a standing-mode game, or a rule that is rated by default', () => {
    expect(label({ rated: false })).toBe('No · Rated was off');
    expect(label({ rated: false, rule: { ...noRule, rule: 'mirror' } })).toBe('No · Rated was off');
  });

  it('too short or not ten players: the fold’s own gate', () => {
    expect(label({ durationS: 200 })).toBe('No · too short or not ten players');
    expect(label({ players: ten.slice(0, 9) })).toBe('No · too short or not ten players');
    expect(label({ players: ten.map((player) => ({ ...player, side: 100 as const })) })).toBe(
      'No · too short or not ten players',
    );
    // The gate comes first, as in the fold: a short ARAM is short.
    expect(label({ durationS: 200, gameMode: 'ARAM' })).toBe('No · too short or not ten players');
  });

  it('never says Not yet', () => {
    const inputs: Partial<RatedReasonInput>[] = [
      {},
      { gameMode: 'ARAM' },
      { gameMode: 'KIWI' },
      { rated: false },
      { rated: false, rule: { ...noRule, rule: 'class', classTag: 'Mage' } },
      { durationS: 100 },
      { players: [] },
      { ratingsSince: '2026-10-04T00:00:00.000Z' },
      { rated: false, noDraw: true },
    ];
    for (const input of inputs) expect(label(input)).not.toMatch(/not yet/i);
  });
});
