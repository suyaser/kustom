import { winProbability } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { classifyKickoff, type KickoffMember, kickoffTeamsOf } from './kickoff';

const BLUE = ['b1', 'b2', 'b3', 'b4', 'b5'];
const RED = ['r1', 'r2', 'r3', 'r4', 'r5'];
const at = new Date('2026-10-05T20:00:00.000Z');

function members(
  blue: readonly string[],
  red: readonly string[],
  extra: KickoffMember[] = [],
): KickoffMember[] {
  return [
    ...blue.map((puuid) => ({ puuid, side: 100, isSpectator: false })),
    ...red.map((puuid) => ({ puuid, side: 200, isSpectator: false })),
    ...extra,
  ];
}

const asSplit = (blue: readonly string[], red: readonly string[]) => ({
  blue: blue.map((puuid) => ({ puuid })),
  red: red.map((puuid) => ({ puuid })),
});

describe('kickoffTeamsOf (M21.4)', () => {
  it('five a side, sorted, whatever order the rows came in', () => {
    expect(kickoffTeamsOf(members([...BLUE].reverse(), RED))).toEqual({ ok: true, blue: BLUE, red: RED });
  });

  it('sitters and spectators are on no team (more than ten in the lobby)', () => {
    const teams = kickoffTeamsOf(
      members(BLUE, RED, [
        { puuid: 's1', side: null, isSpectator: true },
        { puuid: 's2', side: null, isSpectator: false },
        { puuid: 's3', side: 100, isSpectator: true },
      ]),
    );
    expect(teams).toEqual({ ok: true, blue: BLUE, red: RED });
  });

  it('a 2v2 to 4v4 is a kickoff too (M21.1 note b)', () => {
    for (const n of [2, 3, 4]) {
      expect(kickoffTeamsOf(members(BLUE.slice(0, n), RED.slice(0, n)))).toMatchObject({ ok: true });
    }
  });

  it('unequal sides (someone in the spectator slot among the ten) are no record', () => {
    expect(
      kickoffTeamsOf(members(BLUE, RED.slice(0, 4), [{ puuid: 'r5', side: null, isSpectator: true }])),
    ).toEqual({ ok: false, reason: 'unequal-sides', blue: 5, red: 4 });
  });

  it('an empty side or nobody sided is no record', () => {
    expect(kickoffTeamsOf(members(BLUE.slice(0, 3), []))).toMatchObject({ ok: false, reason: 'empty-side' });
    expect(kickoffTeamsOf([])).toMatchObject({ ok: false, reason: 'empty-side' });
  });

  it('more than five a side is no record', () => {
    expect(kickoffTeamsOf(members([...BLUE, 'b6'], [...RED, 'r6']))).toMatchObject({
      ok: false,
      reason: 'too-many',
    });
  });
});

describe('classifyKickoff (M21.4)', () => {
  const r = new Map<string, number>([
    ['b1', 1300],
    ['b2', 1250],
    ['r1', 1100],
  ]);
  const ratingOf = (puuid: string) => r.get(puuid) ?? 1200;

  it('rolled: the split on its own sides, no odds', () => {
    expect(
      classifyKickoff({ teams: { blue: BLUE, red: RED }, chosen: asSplit(BLUE, RED), ratingOf, at }),
    ).toEqual({ kind: 'rolled', blue: BLUE, red: RED, at: at.toISOString(), swapped: false });
  });

  it('rolled and swapped: the split on the other sides (M21.1 note a)', () => {
    expect(
      classifyKickoff({ teams: { blue: RED, red: BLUE }, chosen: asSplit(BLUE, RED), ratingOf, at }),
    ).toEqual({ kind: 'rolled', blue: RED, red: BLUE, at: at.toISOString(), swapped: true });
  });

  it("custom: two traded, odds are winProbability over the real sides' r", () => {
    const blue = ['r1', 'b2', 'b3', 'b4', 'b5'];
    const red = ['b1', 'r2', 'r3', 'r4', 'r5'];
    const record = classifyKickoff({ teams: { blue, red }, chosen: asSplit(BLUE, RED), ratingOf, at });
    expect(record).toEqual({
      kind: 'custom',
      blue,
      red,
      at: at.toISOString(),
      blueWinProb: winProbability(1100 + 1250 + 1200 * 3, 1300 + 1200 * 4),
      oddsModel: 'kustom',
    });
  });

  it('unrolled: no chosen split; an unknown player counts 1200', () => {
    const record = classifyKickoff({ teams: { blue: BLUE, red: RED }, chosen: null, ratingOf, at });
    expect(record).toMatchObject({
      kind: 'unrolled',
      blueWinProb: winProbability(1300 + 1250 + 1200 * 3, 1100 + 1200 * 4),
      oddsModel: 'kustom',
    });
  });

  it('a 3v3 against a five-a-side split is custom with odds', () => {
    const record = classifyKickoff({
      teams: { blue: BLUE.slice(0, 3), red: RED.slice(0, 3) },
      chosen: asSplit(BLUE, RED),
      ratingOf,
      at,
    });
    expect(record).toMatchObject({
      kind: 'custom',
      blueWinProb: winProbability(1300 + 1250 + 1200, 1100 + 2400),
    });
  });
});
