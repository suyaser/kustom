import { describe, expect, it } from 'vitest';
import { type CheckSeat, checkMode } from './check';
import {
  AHRI,
  AMBESSA,
  ASHE,
  BRAUM,
  DARIUS,
  GAREN,
  JINX,
  LEONA,
  LUX,
  MALPHITE,
  ROSTER,
  RYZE,
  SMOLDER,
  SYNDRA,
  THRESH,
  ZED,
} from './testRoster';

const seat = (
  side: 100 | 200,
  championId: number | null,
  position: CheckSeat['position'] = null,
): CheckSeat => ({
  side,
  championId,
  position,
});

describe('checkMode: standing modes have nothing to check', () => {
  it('normal and fearless return none', () => {
    expect(checkMode({ id: 'normal' }, [seat(100, JINX)], ROSTER)).toEqual({ kind: 'none' });
    expect(checkMode({ id: 'fearless' }, [seat(100, JINX)], ROSTER)).toEqual({ kind: 'none' });
  });
});

describe('checkMode: class wars', () => {
  const tanks = { id: 'class', tag: 'Tank' } as const;

  it('the scene: Blue kept the rule, Red broke it with Jinx', () => {
    const seats = [
      seat(100, MALPHITE, 'top'),
      seat(100, GAREN, 'jungle'),
      seat(100, DARIUS, 'mid'),
      seat(100, LEONA, 'adc'),
      seat(100, BRAUM, 'support'),
      seat(200, MALPHITE, 'top'),
      seat(200, GAREN, 'jungle'),
      seat(200, DARIUS, 'mid'),
      seat(200, JINX, 'adc'),
      seat(200, LEONA, 'support'),
    ];
    expect(checkMode(tanks, seats, ROSTER)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [JINX], unknown: [] },
    });
  });

  it('any tag counts: Ashe keeps Supports only; several breakers listed in lane order', () => {
    const seats = [
      seat(100, ASHE, 'adc'),
      seat(100, THRESH, 'support'),
      seat(200, ZED, 'mid'),
      seat(200, JINX, 'top'),
    ];
    expect(checkMode({ id: 'class', tag: 'Support' }, seats, ROSTER)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [JINX, ZED], unknown: [] },
    });
  });

  it('an unknown champion is never broke; it is named, and the side still keeps the rule', () => {
    const seats = [seat(100, LEONA), seat(100, AMBESSA), seat(200, AMBESSA), seat(200, JINX)];
    expect(checkMode(tanks, seats, ROSTER)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [AMBESSA] },
      red: { side: 200, verdict: 'broke', broke: [JINX], unknown: [AMBESSA] },
    });
  });

  it("a side where nothing could be checked is couldn't check; an empty side too", () => {
    const table = new Map([[1, { tags: null, region: null }]]);
    expect(checkMode(tanks, [seat(100, AMBESSA), seat(100, 1), seat(100, null)], table)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'unknown', broke: [], unknown: [1, AMBESSA] },
      red: { side: 200, verdict: 'unknown', broke: [], unknown: [] },
    });
  });
});

describe('checkMode: region wars', () => {
  const ioniaVsDemacia = { id: 'region', blue: 'ionia', red: 'demacia' } as const;

  it("checks each side against its own region; an unaffiliated champion broke, a champion with no row couldn't check", () => {
    const seats = [
      seat(100, AHRI, 'mid'),
      seat(100, ZED, 'jungle'),
      seat(100, SYNDRA, 'support'),
      seat(200, LUX, 'mid'),
      seat(200, GAREN, 'top'),
      seat(200, RYZE, 'adc'),
      seat(200, SMOLDER, 'support'),
      seat(200, AHRI, 'jungle'),
    ];
    expect(checkMode(ioniaVsDemacia, seats, ROSTER)).toEqual({
      kind: 'sides',
      blue: { side: 100, verdict: 'kept', broke: [], unknown: [] },
      red: { side: 200, verdict: 'broke', broke: [AHRI, RYZE], unknown: [SMOLDER] },
    });
  });

  it("blue's region is not red's: Garen on blue breaks Ionia", () => {
    const result = checkMode(ioniaVsDemacia, [seat(100, GAREN, 'top')], ROSTER);
    expect(result).toMatchObject({ blue: { verdict: 'broke', broke: [GAREN] } });
  });
});

describe('checkMode: mirror match', () => {
  const lanes = (pairs: [number | null, number | null][]) =>
    (['top', 'jungle', 'mid', 'adc', 'support'] as const).flatMap((position, i) => [
      seat(100, pairs[i]?.[0] ?? null, position),
      seat(200, pairs[i]?.[1] ?? null, position),
    ]);

  it('kept in every lane', () => {
    const result = checkMode(
      { id: 'mirror' },
      lanes([
        [GAREN, GAREN],
        [ZED, ZED],
        [AHRI, AHRI],
        [JINX, JINX],
        [LEONA, LEONA],
      ]),
      ROSTER,
    );
    expect(result).toEqual({
      kind: 'lanes',
      kept: 5,
      lanes: [
        { lane: 'top', verdict: 'kept', blue: GAREN, red: GAREN },
        { lane: 'jungle', verdict: 'kept', blue: ZED, red: ZED },
        { lane: 'mid', verdict: 'kept', blue: AHRI, red: AHRI },
        { lane: 'adc', verdict: 'kept', blue: JINX, red: JINX },
        { lane: 'support', verdict: 'kept', blue: LEONA, red: LEONA },
      ],
    });
  });

  it('a lane where the champions differ is broke, with both champions; a champion newer than the pin still compares', () => {
    const result = checkMode(
      { id: 'mirror' },
      lanes([
        [AMBESSA, AMBESSA],
        [ZED, ZED],
        [AHRI, SYNDRA],
        [JINX, JINX],
        [LEONA, LEONA],
      ]),
      ROSTER,
    );
    expect(result).toMatchObject({ kept: 4 });
    expect(result.kind === 'lanes' && result.lanes[2]).toEqual({
      lane: 'mid',
      verdict: 'broke',
      blue: AHRI,
      red: SYNDRA,
    });
    expect(result.kind === 'lanes' && result.lanes[0]?.verdict).toBe('kept');
  });

  it("a seat with no position leaves its lane couldn't check, never broke", () => {
    const seats = [
      seat(100, AHRI, 'mid'),
      seat(200, SYNDRA, null),
      seat(100, JINX, 'adc'),
      seat(200, ASHE, 'adc'),
    ];
    const result = checkMode({ id: 'mirror' }, seats, ROSTER);
    expect(result.kind === 'lanes' && result.lanes.find((l) => l.lane === 'mid')).toEqual({
      lane: 'mid',
      verdict: 'unknown',
      blue: AHRI,
      red: null,
    });
    expect(result.kind === 'lanes' && result.lanes.find((l) => l.lane === 'adc')?.verdict).toBe('broke');
    expect(result).toMatchObject({ kept: 0 });
  });

  it("two seats of one side claiming one lane: that lane couldn't check", () => {
    const seats = [seat(100, AHRI, 'mid'), seat(100, ZED, 'mid'), seat(200, AHRI, 'mid')];
    const result = checkMode({ id: 'mirror' }, seats, ROSTER);
    expect(result.kind === 'lanes' && result.lanes.find((l) => l.lane === 'mid')).toEqual({
      lane: 'mid',
      verdict: 'unknown',
      blue: null,
      red: AHRI,
    });
  });

  it('a seat with no champion leaves its lane unknown', () => {
    const result = checkMode({ id: 'mirror' }, [seat(100, null, 'top'), seat(200, GAREN, 'top')], ROSTER);
    expect(result.kind === 'lanes' && result.lanes[0]?.verdict).toBe('unknown');
  });
});

describe('checkMode names champions, never players', () => {
  it('the output carries champion ids and sides only, whatever extra fields a seat has', () => {
    const withPuuid = { ...seat(200, JINX, 'adc'), puuid: 'omar-puuid', name: 'Omar' } as CheckSeat;
    const result = JSON.stringify([
      checkMode({ id: 'class', tag: 'Tank' }, [withPuuid], ROSTER),
      checkMode({ id: 'mirror' }, [withPuuid], ROSTER),
    ]);
    expect(result).not.toContain('omar');
    expect(result).not.toContain('Omar');
  });
});
