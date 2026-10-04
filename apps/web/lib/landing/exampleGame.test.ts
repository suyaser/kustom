import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLES } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { oddsOf } from '@/components/receipt/model';
import { ddragonChampionId } from '@/lib/champs/ddragon';
import { championName } from '@/lib/champs/names';
import { EXAMPLE_NAMES, EXAMPLE_SPLITS } from './example';
import { EXAMPLE_GAME } from './exampleGame';

/** The landing hero's example game fixture (05-design 12.2), held to the worked example and the files. */

const CHAMPIONS_DIR = fileURLToPath(new URL('../../components/landing/champions/', import.meta.url));
const split = EXAMPLE_SPLITS[0];
const seats = EXAMPLE_GAME.lanes.flatMap((lane) => [lane.blue, lane.red]);

describe('the example game', () => {
  it('has the five lanes in role order', () => {
    expect(EXAMPLE_GAME.lanes.map((lane) => lane.role)).toEqual([...ROLES]);
  });

  it("seats split 1's ten on their sides, with the worked example's names", () => {
    expect(split).toBeDefined();
    expect(EXAMPLE_GAME.lanes.map((lane) => ({ puuid: lane.blue.puuid, role: lane.role }))).toEqual(
      split?.blue,
    );
    expect(EXAMPLE_GAME.lanes.map((lane) => ({ puuid: lane.red.puuid, role: lane.role }))).toEqual(
      split?.red,
    );
    for (const seat of seats) expect(seat.name).toBe(EXAMPLE_NAMES[seat.puuid]);
    expect(EXAMPLE_GAME.lanes.map((lane) => lane.blue.name)).toEqual([
      'Hana',
      'Iris',
      'Karim',
      'Bilal',
      'Theo',
    ]);
    expect(EXAMPLE_GAME.lanes.map((lane) => lane.red.name)).toEqual([
      'Omar',
      'Rami',
      'Nadia',
      'Lena',
      'Yuki',
    ]);
  });

  it('red wins in 32:40 at split 1 odds (blue 54%)', () => {
    expect(EXAMPLE_GAME.winner).toBe(200);
    expect(EXAMPLE_GAME.duration).toBe('32:40');
    expect(EXAMPLE_GAME.blueWinProb).toBe(split?.blueWinProb);
    expect(oddsOf(EXAMPLE_GAME.blueWinProb)).toMatchObject({ bluePct: 54, redPct: 46 });
  });

  it("names each champion by a key the pin ships, whose Data Dragon id is the committed file's", () => {
    const files = readdirSync(CHAMPIONS_DIR)
      .filter((file) => file.endsWith('.webp'))
      .map((file) => file.replace(/\.webp$/, ''))
      .sort();
    for (const seat of seats) {
      expect(ddragonChampionId(seat.championKey)).toBe(seat.ddragonId);
      expect(championName(seat.championKey)).toBe(seat.championName);
    }
    expect(seats.map((seat) => seat.ddragonId).sort()).toEqual(files);
    expect(new Set(seats.map((seat) => seat.championKey)).size).toBe(10);
  });

  it('the 05-design 12.2 picks, lane by lane', () => {
    expect(EXAMPLE_GAME.lanes.map((lane) => [lane.blue.ddragonId, lane.red.ddragonId])).toEqual([
      ['Garen', 'Darius'],
      ['LeeSin', 'Amumu'],
      ['Ahri', 'Yasuo'],
      ['Jinx', 'Ezreal'],
      ['Thresh', 'Lux'],
    ]);
  });

  it('changes are whole and non-zero: the winners (red) gain, the losers (blue) lose', () => {
    for (const lane of EXAMPLE_GAME.lanes) {
      for (const seat of [lane.blue, lane.red]) {
        expect(Number.isInteger(seat.change)).toBe(true);
        expect(seat.change).not.toBe(0);
        expect(Math.abs(seat.change)).toBeLessThan(40);
      }
      expect(lane.blue.change).toBeLessThan(0);
      expect(lane.red.change).toBeGreaterThan(0);
    }
  });
});
