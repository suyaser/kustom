import { preGameOdds } from '@customs/core';
import type { LobbyKickoff } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { game4Identity } from '@/lib/testing/discordGame4';
import { resultOddsLine } from '../receipt/copy';
import {
  buildResultInput,
  type FoldedRow,
  foldBlueWinProb,
  type PlayedSplitRoles,
  type ResultSource,
  resultOddsOf,
} from './assemble';
import { resultEmbed } from './embeds';

/**
 * M21.14: the result post prints `gameReceiptOf`'s number for every game, so a game Kustom did not
 * pick (nobody rolled, or no lobby at all) gets its pre-game odds and `Upset!` by them, the same
 * number as Tonight and `/games`. The bot's teams keep the split's odds (M21.7), unchanged.
 */

const LANES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const BLUE = LANES.map((_, i) => `b${i}`);
const RED = LANES.map((_, i) => `r${i}`);
const AT = '2026-10-05T20:00:00.000Z';

const seatsOf = (
  blue: readonly string[],
  red: readonly string[],
  rBefore: (puuid: string) => number | null,
) => [
  ...blue.map((puuid) => ({ puuid, side: 100 as const, rBefore: rBefore(puuid) })),
  ...red.map((puuid) => ({ puuid, side: 200 as const, rBefore: rBefore(puuid) })),
];
/** Blue a little stronger: 1250 against 1150 each. */
const rOf = (puuid: string) => (puuid.startsWith('b') ? 1250 : 1150);
const SEATS = seatsOf(BLUE, RED, rOf);
const PRE_GAME = preGameOdds(
  BLUE.map((p) => ({ r: rOf(p) })),
  RED.map((p) => ({ r: rOf(p) })),
);

const split = (blueWinProb: number, rank = 1): PlayedSplitRoles => ({
  blue: BLUE.map((puuid, i) => ({ puuid, role: LANES[i] ?? 'top' })),
  red: RED.map((puuid, i) => ({ puuid, role: LANES[i] ?? 'top' })),
  blueWinProb,
  rank,
});

const unrolled = (
  blueWinProb: number,
  blue = BLUE,
  red = RED,
  kind: 'unrolled' | 'custom' = 'unrolled',
): LobbyKickoff => ({
  kind,
  blue: [...blue],
  red: [...red],
  at: AT,
  blueWinProb,
  oddsModel: 'kustom',
});

/** Rows the fold wrote: every row folded, blue's `fold_p` on blue rows. */
const folded = (blueP: number | null): FoldedRow[] =>
  SEATS.map((seat) => ({
    side: seat.side,
    rAfter: blueP === null ? null : 1200,
    foldP: blueP === null ? null : seat.side === 100 ? blueP : 1 - blueP,
  }));

const base = { aram: false, rated: true, seats: SEATS, chosen: null, kickoff: null, folded: folded(null) };

describe('resultOddsOf (M21.14)', () => {
  it("an unrolled game: the kickoff record's odds, the number Tonight and the Game on post showed", () => {
    expect(resultOddsOf({ ...base, kickoff: unrolled(0.82) })).toBe(0.82);
    // The kickoff record wins over the fold's number, as on the game page.
    expect(resultOddsOf({ ...base, kickoff: unrolled(0.82), folded: folded(0.8) })).toBe(0.82);
  });

  it("a game with no lobby: the fold's stored fold_p, else preGameOdds over the r_befores", () => {
    expect(resultOddsOf({ ...base, folded: folded(0.41) })).toBe(0.41);
    expect(PRE_GAME).not.toBeNull();
    expect(resultOddsOf(base)).toBe(PRE_GAME);
  });

  it('a kickoff record that is not the eog teams is ignored: the pre-game odds of the teams that played', () => {
    const moved = unrolled(0.82, [...BLUE.slice(1), RED[0] ?? ''], [BLUE[0] ?? '', ...RED.slice(1)]);
    expect(resultOddsOf({ ...base, kickoff: moved })).toBe(PRE_GAME);
  });

  it('one of the ten without a rating going in: no odds line', () => {
    const seats = seatsOf(BLUE, RED, (puuid) => (puuid === 'r4' ? null : rOf(puuid)));
    expect(resultOddsOf({ ...base, seats })).toBeNull();
  });

  it('a not-rated game and an ARAM the bot did not roll: none, as before', () => {
    expect(resultOddsOf({ ...base, rated: false, kickoff: unrolled(0.82), folded: folded(0.8) })).toBeNull();
    expect(resultOddsOf({ ...base, aram: true, kickoff: unrolled(0.82), folded: folded(0.8) })).toBeNull();
  });

  it("the bot's teams keep the split's odds (turned round on swapped sides), rated or not", () => {
    expect(resultOddsOf({ ...base, chosen: split(0.62), folded: folded(0.5) })).toBe(0.62);
    expect(resultOddsOf({ ...base, rated: false, chosen: split(0.62) })).toBe(0.62);
    const swapped = seatsOf(RED, BLUE, rOf);
    expect(resultOddsOf({ ...base, seats: swapped, chosen: split(0.62, 2) })).toBeCloseTo(0.38, 12);
  });

  it('teams changed after the roll: the custom kickoff odds, never the split', () => {
    const custom = unrolled(0.35, BLUE, RED, 'custom');
    // The split had b0 and r0 the other way round; they traded in the lobby.
    const rolled = split(0.62);
    const [b0, ...blueRest] = rolled.blue;
    const [r0, ...redRest] = rolled.red;
    if (b0 === undefined || r0 === undefined) throw new Error('empty split');
    const other = { ...rolled, blue: [r0, ...blueRest], red: [b0, ...redRest] };
    expect(resultOddsOf({ ...base, chosen: other, kickoff: custom })).toBe(0.35);
  });
});

describe('foldBlueWinProb', () => {
  it("blue's fold_p when all ten were folded, else null", () => {
    expect(foldBlueWinProb(folded(0.3))).toBe(0.3);
    expect(foldBlueWinProb(folded(null))).toBeNull();
    expect(foldBlueWinProb(folded(0.3).slice(1))).toBeNull();
  });
});

describe('the result post of an unrolled game', () => {
  const players = SEATS.map((seat, i) => ({
    puuid: seat.puuid,
    name: seat.puuid.toUpperCase(),
    side: seat.side,
    role: LANES[i % 5] ?? null,
    damage: 10_000 + i,
    rBefore: seat.rBefore,
    rAfter: (seat.rBefore ?? 0) + (seat.side === 200 ? 12 : -12),
    stats: {
      role: LANES[i % 5] ?? null,
      kills: 3,
      deaths: 3,
      assists: 3,
      damageToChamps: 10_000 + i,
      gold: 10_000,
      cs: 150,
      visionScore: 20,
      damageSelfMitigated: 10_000,
      damageToObjectives: 5_000,
    },
  }));
  const source: ResultSource = {
    winningSide: 200,
    durationS: 1_800,
    gameNumber: 12,
    blueWinProb: resultOddsOf({ ...base, kickoff: unrolled(0.82) }),
    endedAt: AT,
    rated: true,
    rift: true,
    rule: null,
    players,
  };
  const input = buildResultInput(source, { identity: game4Identity('https://customs.example') });
  if (input === null) throw new Error('no result input');
  const payload = resultEmbed(input);

  it('opens with the pre-game odds and Upset!, as Tonight says it', () => {
    const first = payload.embeds[0]?.description?.split('\n')[0];
    expect(first).toBe(resultOddsLine(0.82, 200));
    expect(first).toBe('Red was 18%. Red won. Upset!');
  });

  it('matches the snapshot', () => {
    expect(payload).toMatchSnapshot();
  });
});
